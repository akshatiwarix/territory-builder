import {
  AXES,
  dimensionsForLevel,
  stageAtLeast,
  type Account,
  type Axis,
  type Cell,
  type Config,
  type Infeasible,
  type PlanException,
  type RepId,
  type Universe,
} from "@/lib/domain";
import { buildCells } from "@/lib/cells";
import { AXIS_WEIGHT, emptyLoad, universeTotals } from "@/lib/measure";

/**
 * Everything both the bounds and the optimizer need, derived once from a config.
 *
 * This module sits *below* lib/bounds so that a bound never has to reach sideways
 * into the search to find out which cells exist. It is also where every
 * infeasibility is detected and named: a capacity nobody can satisfy is an
 * answer, and answering it with a crash or a silently dropped constraint would
 * be the same failure this repo spends its whole argument objecting to.
 */
export type Preparation = {
  kind: "prepared";
  universe: Universe;
  config: Config;
  cells: Cell[];
  exceptions: PlanException[];
  exceptionIds: Set<string>;
  protectedIds: Set<string>;
  /** Cell key -> the reps allowed to take it, after exclusions. */
  eligibility: Map<string, RepId[]>;
  /** Load each rep carries before the optimizer starts, from exceptions. */
  committed: Map<RepId, Record<Axis, number>>;
  /** Totals over the whole universe, exceptions included. */
  totals: Record<Axis, number>;
  accountById: Map<string, Account>;
};

export type PreparationResult = Preparation | Infeasible;

function infeasible(reason: Infeasible["reason"], detail: string): Infeasible {
  return { kind: "infeasible", reason, detail };
}

export function prepare(universe: Universe, config: Config): PreparationResult {
  const reps = universe.reps;
  if (reps.length < 2) {
    return infeasible("no-reps", "A carve needs at least two reps.");
  }

  const accountById = new Map(universe.accounts.map((a) => [a.id, a]));

  // --- capacity feasibility, before anything expensive ----------------------
  const capacity = config.constraints.capacity;
  if (capacity) {
    if (capacity.min * reps.length > universe.accounts.length) {
      return infeasible(
        "capacity-min-too-high",
        `A minimum of ${capacity.min} accounts across ${reps.length} reps needs ` +
          `${capacity.min * reps.length} accounts; the universe has ${universe.accounts.length}.`,
      );
    }
    if (capacity.max * reps.length < universe.accounts.length) {
      return infeasible(
        "capacity-max-too-low",
        `A maximum of ${capacity.max} accounts across ${reps.length} reps holds ` +
          `${capacity.max * reps.length} accounts; the universe has ${universe.accounts.length}.`,
      );
    }
  }

  // --- exclusions the lattice cannot express --------------------------------
  //
  // An exclusion names a dimension; a cell can only be restricted by a dimension
  // the lattice actually contains. Ask for "rep-05 never sells Enterprise" at a
  // granularity built from industry alone and there is nothing to match on — so
  // the rule does nothing, and rep-05 gets Enterprise accounts anyway.
  //
  // That is a silently dropped constraint, which is the failure this whole repo
  // objects to, so it is refused by name instead. The sweep found this: 56 plans
  // violated an exclusion that the tool had quietly ignored.
  const activeDimensions = new Set<string>(dimensionsForLevel(config.granularity));
  const inert = config.constraints.exclusions.find(
    (exclusion) => !activeDimensions.has(exclusion.dimension),
  );
  if (inert) {
    return infeasible(
      "exclusion-inert-at-this-granularity",
      `${inert.repId} is excluded from ${inert.dimension} = ${inert.value}, but the ` +
        `level-${config.granularity} lattice is not cut along ${inert.dimension}, so no ` +
        `cell can honour it. Refine the granularity or drop the rule.`,
    );
  }

  // --- exceptions -----------------------------------------------------------
  const protectStage = config.constraints.protectStage;
  const protectedIds = new Set<string>();
  if (protectStage) {
    for (const account of universe.accounts) {
      if (account.openOppStage && stageAtLeast(account.openOppStage, protectStage)) {
        protectedIds.add(account.id);
      }
    }
  }

  const exclusionsByRep = new Map<RepId, Array<{ dimension: string; value: string }>>();
  for (const exclusion of config.constraints.exclusions) {
    exclusionsByRep.set(exclusion.repId, [
      ...(exclusionsByRep.get(exclusion.repId) ?? []),
      { dimension: exclusion.dimension, value: exclusion.value },
    ]);
  }

  const exceptions: PlanException[] = [];
  const pinnedIds = new Set<string>();

  for (const [accountId, repId] of Object.entries(config.constraints.pinned)) {
    const account = accountById.get(accountId);
    if (!account) continue;
    if (!reps.some((r) => r.id === repId)) continue;

    // A pin and an exclusion are both explicit instructions about the same
    // account, and they contradict. Picking a winner here would be inventing a
    // policy the user never stated, so the tool refuses by name instead.
    const blocked = (exclusionsByRep.get(repId) ?? []).find(
      (e) => (account as unknown as Record<string, string>)[e.dimension] === e.value,
    );
    if (blocked) {
      return infeasible(
        "pin-conflicts-with-exclusion",
        `${account.name} is pinned to ${repId}, who is excluded from ` +
          `${blocked.dimension} = ${blocked.value}.`,
      );
    }

    pinnedIds.add(accountId);
    exceptions.push({ accountId, repId, reason: "pinned" });
  }

  for (const accountId of protectedIds) {
    // A pin beats protection: protection is a blanket policy and a pin is a
    // specific instruction about a specific account. Recorded here rather than
    // discovered later in the diff.
    if (pinnedIds.has(accountId)) continue;
    const account = accountById.get(accountId);
    if (!account) continue;
    exceptions.push({
      accountId,
      repId: account.currentOwnerId,
      reason: "protected",
    });
  }

  exceptions.sort((a, b) => (a.accountId < b.accountId ? -1 : 1));
  const exceptionIds = new Set(exceptions.map((e) => e.accountId));

  // --- cells and eligibility ------------------------------------------------
  const cells = buildCells(universe.accounts, config.granularity, exceptionIds);

  const eligibility = new Map<string, RepId[]>();
  for (const cell of cells) {
    const eligible = reps
      .filter((rep) => {
        const rules = exclusionsByRep.get(rep.id);
        if (!rules) return true;
        return !rules.some(
          (rule) =>
            (cell.values as Record<string, string | undefined>)[rule.dimension] ===
            rule.value,
        );
      })
      .map((rep) => rep.id);

    if (eligible.length === 0) {
      return infeasible(
        "cell-has-no-eligible-rep",
        `No rep may take ${cell.key} — every rep is excluded from part of it.`,
      );
    }
    eligibility.set(cell.key, eligible);
  }

  // --- committed load -------------------------------------------------------
  const committed = new Map<RepId, Record<Axis, number>>();
  for (const rep of reps) committed.set(rep.id, emptyLoad());
  for (const exception of exceptions) {
    const account = accountById.get(exception.accountId);
    const load = committed.get(exception.repId);
    if (!account || !load) continue;
    for (const axis of AXES) load[axis] += AXIS_WEIGHT[axis](account);
  }

  return {
    kind: "prepared",
    universe,
    config,
    cells,
    exceptions,
    exceptionIds,
    protectedIds,
    eligibility,
    committed,
    totals: universeTotals(universe.accounts),
    accountById,
  };
}

/**
 * The exclusions a given granularity cannot express. `prepare` refuses when this
 * is non-empty; the console uses it to say which control to change before the
 * user has to read an error.
 */
export function inertExclusions(config: Config): Config["constraints"]["exclusions"] {
  const active = new Set<string>(
    (["industry", "region", "segment", "employeeBand"] as const).slice(
      0,
      config.granularity,
    ),
  );
  return config.constraints.exclusions.filter((e) => !active.has(e.dimension));
}
