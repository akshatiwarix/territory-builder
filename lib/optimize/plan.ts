import {
  AXES,
  type Axis,
  type Config,
  type Plan,
  type PlanResult,
  type RepId,
  type Territory,
  type Universe,
} from "@/lib/domain";
import { cellKey, evaluateRule, renderRule } from "@/lib/cells";
import { computeFloor } from "@/lib/bounds";
import { computeChurn, imbalanceOf, repLoads, resolveOwners } from "@/lib/measure";
import { prepare, type Preparation } from "@/lib/setup";
import { search } from "./search";

/**
 * Assembles the territories and, in the process, guarantees the round-trip.
 *
 * The rule is rendered from cells, evaluated back against the universe, and any
 * difference between what it selects and what the plan intends is folded into
 * `plus` and `minus`. That ordering matters: it makes "the rule describes exactly
 * this territory" true by construction rather than by argument, including in the
 * awkward cases — a cell all of whose accounts are protected does not exist in
 * the lattice at all, so a collapsed term can widen across it.
 */
function buildTerritories(prep: Preparation, assignment: Int32Array): Territory[] {
  const repIds = prep.universe.reps.map((r) => r.id);
  const occupied = prep.cells.map((c) => c.values);

  const cellsByRep = new Map<RepId, number[]>();
  for (let c = 0; c < prep.cells.length; c++) {
    const repId = repIds[assignment[c]!]!;
    cellsByRep.set(repId, [...(cellsByRep.get(repId) ?? []), c]);
  }

  const exceptionsByRep = new Map<RepId, string[]>();
  for (const exception of prep.exceptions) {
    exceptionsByRep.set(exception.repId, [
      ...(exceptionsByRep.get(exception.repId) ?? []),
      exception.accountId,
    ]);
  }

  return prep.universe.reps.map((rep) => {
    const cellIndexes = cellsByRep.get(rep.id) ?? [];
    const cells = cellIndexes.map((i) => prep.cells[i]!);
    const intended = new Set<string>();
    for (const cell of cells) for (const id of cell.accountIds) intended.add(id);
    for (const id of exceptionsByRep.get(rep.id) ?? []) intended.add(id);

    const bare = renderRule({
      cellValues: cells.map((c) => c.values),
      occupiedCellValues: occupied,
      level: prep.config.granularity,
      plus: [],
      minus: [],
    });
    const selected = evaluateRule(bare, prep.universe.accounts);

    const plus: string[] = [];
    const minus: string[] = [];
    for (const id of intended) if (!selected.has(id)) plus.push(id);
    for (const id of selected) if (!intended.has(id)) minus.push(id);

    const rule = renderRule({
      cellValues: cells.map((c) => c.values),
      occupiedCellValues: occupied,
      level: prep.config.granularity,
      plus,
      minus,
    });

    const load = { count: 0, potential: 0, pipeline: 0 } as Record<Axis, number>;
    for (const id of intended) {
      const account = prep.accountById.get(id);
      if (!account) continue;
      load.count += 1;
      load.potential += account.potentialUsd;
      load.pipeline += account.openPipelineUsd;
    }

    return {
      repId: rep.id,
      cellKeys: cells.map((c) => c.key),
      accountIds: [...intended].sort(),
      rule,
      load,
    };
  });
}

export function buildPlan(universe: Universe, config: Config): PlanResult {
  const prep = prepare(universe, config);
  if (prep.kind === "infeasible") return prep;

  const result = search(prep);
  if (result === "capacity-min-unreachable") {
    return {
      kind: "infeasible",
      reason: "capacity-min-unreachable-at-this-granularity",
      detail:
        `No assignment of ${prep.cells.length} cells gives every rep at least ` +
        `${config.constraints.capacity?.min ?? 0} accounts. Cells are indivisible, ` +
        `so a finer granularity may make this reachable.`,
    };
  }

  const repIds = universe.reps.map((r) => r.id);
  const cellAssignment: Record<string, RepId> = {};
  for (let c = 0; c < prep.cells.length; c++) {
    cellAssignment[prep.cells[c]!.key] = repIds[result.assignment[c]!]!;
  }

  const territories = buildTerritories(prep, result.assignment);
  const owners = resolveOwners(prep.cells, cellAssignment, prep.exceptions);
  const loads = repLoads(universe.accounts, owners, universe.reps);
  const imbalance = imbalanceOf(loads, prep.totals, universe.reps.length);

  const plan: Plan = {
    config,
    cellAssignment,
    exceptions: prep.exceptions,
    territories,
    imbalance,
    churn: computeChurn(universe.accounts, owners, prep.protectedIds),
    floor: computeFloor(universe, prep),
    search: {
      restarts: result.restarts,
      iterations: result.iterations,
      improved: result.improved,
    },
  };

  return { kind: "plan", plan };
}

/**
 * The cell-expressible approximation of the book on the ground: every cell to
 * whoever already holds the most pipeline in it.
 *
 * Not a plan the tool would propose — it optimizes nothing. It exists as the
 * baseline the churn floor is measured against, and as the honest answer to
 * "what if we just left everything alone?", which turns out not to be an
 * available option.
 */
export function statusQuoAssignment(prep: Preparation): Record<string, RepId> {
  const assignment: Record<string, RepId> = {};
  for (const cell of prep.cells) {
    const eligible = new Set(prep.eligibility.get(cell.key) ?? []);
    const byOwner = new Map<RepId, number>();
    for (const id of cell.accountIds) {
      const account = prep.accountById.get(id);
      if (!account || !eligible.has(account.currentOwnerId)) continue;
      byOwner.set(
        account.currentOwnerId,
        (byOwner.get(account.currentOwnerId) ?? 0) + account.openPipelineUsd + 1e-6,
      );
    }
    let best: RepId | undefined;
    let bestValue = -1;
    for (const [repId, value] of [...byOwner].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (value > bestValue) {
        bestValue = value;
        best = repId;
      }
    }
    assignment[cell.key] = best ?? [...eligible].sort()[0]!;
  }
  return assignment;
}

export function totalsFor(
  universe: Universe,
  owners: Map<string, RepId>,
): Record<Axis, number> {
  const totals = { count: 0, potential: 0, pipeline: 0 } as Record<Axis, number>;
  for (const account of universe.accounts) {
    if (!owners.has(account.id)) continue;
    for (const axis of AXES) {
      totals[axis] +=
        axis === "count"
          ? 1
          : axis === "potential"
            ? account.potentialUsd
            : account.openPipelineUsd;
    }
  }
  return totals;
}

export { cellKey };
