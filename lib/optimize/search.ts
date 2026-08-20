import { AXES, type Axis, type Config, type RepId } from "@/lib/domain";
import { Rng, derive } from "@/lib/rng";
import type { Preparation } from "@/lib/setup";

/**
 * The search.
 *
 * Pure, synchronous, and budgeted in iterations rather than wall-clock, so a
 * permalink replays byte-identically on a laptop and in a Vercel function.
 * Every tie-break is total — (delta, cell index, rep index) — because a search
 * that breaks ties by iteration order is a search whose output depends on the
 * order a Map happened to hand things back.
 */

const SPREAD_WEIGHT = 0.25;

export type SearchResult = {
  assignment: Int32Array;
  loads: Float64Array;
  score: number;
  iterations: number;
  improved: number;
  restarts: number;
};

type Model = {
  repIds: RepId[];
  cellCount: number;
  repCount: number;
  /** cell -> axis -> weight, flattened */
  weight: Float64Array;
  /** rep -> axis -> committed load, flattened */
  base: Float64Array;
  /** cell -> rep -> pipeline that changes hands if this cell goes to that rep */
  churn: Float64Array;
  /** cell -> rep -> eligible */
  eligible: Uint8Array;
  eligibleReps: number[][];
  ideal: number[];
  totalPipeline: number;
  churnBase: number;
  weights: Config["weights"];
  capacity: { min: number; max: number } | null;
};

const AXIS_INDEX: Record<Axis, number> = { count: 0, potential: 1, pipeline: 2 };

export function buildModel(prep: Preparation): Model {
  const repIds = prep.universe.reps.map((r) => r.id);
  const repCount = repIds.length;
  const cellCount = prep.cells.length;

  const weight = new Float64Array(cellCount * 3);
  const churn = new Float64Array(cellCount * repCount);
  const eligible = new Uint8Array(cellCount * repCount);
  const eligibleReps: number[][] = [];

  for (let c = 0; c < cellCount; c++) {
    const cell = prep.cells[c]!;
    for (const axis of AXES) weight[c * 3 + AXIS_INDEX[axis]] = cell.weight[axis];

    // Pipeline that changes hands if this cell goes to rep r. Precomputed
    // because the inner loop asks for it a few million times.
    for (const accountId of cell.accountIds) {
      const account = prep.accountById.get(accountId);
      if (!account) continue;
      for (let r = 0; r < repCount; r++) {
        if (repIds[r] !== account.currentOwnerId) {
          churn[c * repCount + r] = (churn[c * repCount + r] ?? 0) + account.openPipelineUsd;
        }
      }
    }

    const allowed = new Set(prep.eligibility.get(cell.key) ?? []);
    const list: number[] = [];
    for (let r = 0; r < repCount; r++) {
      if (allowed.has(repIds[r]!)) {
        eligible[c * repCount + r] = 1;
        list.push(r);
      }
    }
    eligibleReps.push(list);
  }

  const base = new Float64Array(repCount * 3);
  for (let r = 0; r < repCount; r++) {
    const committed = prep.committed.get(repIds[r]!);
    if (!committed) continue;
    for (const axis of AXES) base[r * 3 + AXIS_INDEX[axis]] = committed[axis];
  }

  // Pinned accounts that leave their current owner are churn nobody can avoid,
  // and they are not in any cell, so they enter as a constant.
  let churnBase = 0;
  for (const exception of prep.exceptions) {
    if (exception.reason !== "pinned") continue;
    const account = prep.accountById.get(exception.accountId);
    if (account && account.currentOwnerId !== exception.repId) {
      churnBase += account.openPipelineUsd;
    }
  }

  return {
    repIds,
    cellCount,
    repCount,
    weight,
    base,
    churn,
    eligible,
    eligibleReps,
    ideal: AXES.map((axis) => prep.totals[axis] / repCount),
    totalPipeline: prep.totals.pipeline,
    churnBase,
    weights: prep.config.weights,
    capacity: prep.config.constraints.capacity,
  };
}

/**
 * The scalarized objective. Internal to this module by construction — nothing
 * exported from lib/optimize returns it, and no surface displays it.
 *
 * Imbalance is a max, which makes for a nearly flat landscape: moving a cell off
 * a rep who is not the busiest changes the reported number by exactly nothing,
 * so steepest descent has almost no gradient to follow. A small spread term is
 * added to break that flatness. It is a search aid, not a claim: the max term
 * dominates, the reported imbalance is still the max, and the certified floor is
 * untouched by any of it.
 */
function score(model: Model, loads: Float64Array, churnTotal: number): number {
  let total = 0;

  for (const axis of AXES) {
    const a = AXIS_INDEX[axis];
    const ideal = model.ideal[a]!;
    const weight = model.weights[axis];
    if (weight === 0 || ideal === 0) continue;

    let max = 0;
    let squares = 0;
    for (let r = 0; r < model.repCount; r++) {
      const load = loads[r * 3 + a]!;
      if (load > max) max = load;
      const deviation = (load - ideal) / ideal;
      squares += deviation * deviation;
    }
    const imbalance = (max - ideal) / ideal;
    const spread = Math.sqrt(squares / model.repCount);
    total += weight * (imbalance + SPREAD_WEIGHT * spread);
  }

  if (model.weights.churn > 0 && model.totalPipeline > 0) {
    total += model.weights.churn * (churnTotal / model.totalPipeline);
  }

  return total;
}

function applyCell(
  model: Model,
  loads: Float64Array,
  cell: number,
  rep: number,
  sign: number,
): void {
  for (let a = 0; a < 3; a++) {
    loads[rep * 3 + a] = (loads[rep * 3 + a] ?? 0) + sign * model.weight[cell * 3 + a]!;
  }
}

function withinCapacity(model: Model, loads: Float64Array, rep: number): boolean {
  const capacity = model.capacity;
  if (!capacity) return true;
  return loads[rep * 3]! <= capacity.max;
}

/**
 * LPT: heaviest cells first, each onto the eligible rep it hurts least.
 *
 * Restart 0 is pure deterministic LPT. Later restarts perturb only the *choice*
 * among near-equal candidates, never the rule — so every restart is still a
 * function of the seed alone.
 */
function seedAssignment(model: Model, rng: Rng, randomize: boolean): Int32Array {
  const order = Array.from({ length: model.cellCount }, (_, i) => i);
  const scaleOf = (cell: number) => {
    let total = 0;
    for (const axis of AXES) {
      const a = AXIS_INDEX[axis];
      const ideal = model.ideal[a]!;
      if (ideal === 0) continue;
      total += model.weights[axis] * (model.weight[cell * 3 + a]! / ideal);
    }
    return total;
  };
  const scale = order.map(scaleOf);
  order.sort((x, y) => scale[y]! - scale[x]! || x - y);

  const assignment = new Int32Array(model.cellCount).fill(-1);
  const loads = new Float64Array(model.base);
  let churnTotal = model.churnBase;

  for (const cell of order) {
    let bestRep = -1;
    let bestScore = Infinity;
    let runnerUp = -1;

    for (const rep of model.eligibleReps[cell]!) {
      applyCell(model, loads, cell, rep, 1);
      const ok = withinCapacity(model, loads, rep);
      const candidate = ok
        ? score(model, loads, churnTotal + model.churn[cell * model.repCount + rep]!)
        : Infinity;
      applyCell(model, loads, cell, rep, -1);

      if (candidate < bestScore) {
        runnerUp = bestRep;
        bestRep = rep;
        bestScore = candidate;
      }
    }

    if (bestRep === -1) bestRep = model.eligibleReps[cell]![0] ?? 0;
    if (randomize && runnerUp !== -1 && rng.next() < 0.3) bestRep = runnerUp;

    assignment[cell] = bestRep;
    applyCell(model, loads, cell, bestRep, 1);
    churnTotal += model.churn[cell * model.repCount + bestRep]!;
  }

  return assignment;
}

function loadsOf(model: Model, assignment: Int32Array): Float64Array {
  const loads = new Float64Array(model.base);
  for (let c = 0; c < model.cellCount; c++) {
    applyCell(model, loads, c, assignment[c]!, 1);
  }
  return loads;
}

function churnOf(model: Model, assignment: Int32Array): number {
  let total = model.churnBase;
  for (let c = 0; c < model.cellCount; c++) {
    total += model.churn[c * model.repCount + assignment[c]!]!;
  }
  return total;
}

function capacityOk(model: Model, loads: Float64Array): boolean {
  const capacity = model.capacity;
  if (!capacity) return true;
  for (let r = 0; r < model.repCount; r++) {
    const count = loads[r * 3]!;
    if (count < capacity.min || count > capacity.max) return false;
  }
  return true;
}

/**
 * Steepest descent over single-cell moves, then over swaps.
 *
 * Moves first because they are the cheap neighbourhood and they resolve most of
 * the imbalance. Swaps are then restricted to cells held by the busiest rep on
 * each axis: the full pairwise neighbourhood is ~77,000 candidates per step on
 * the demo corpus, and the ones that matter are the ones touching whoever is
 * over the line.
 */
function localSearch(
  model: Model,
  assignment: Int32Array,
  iterationCap: number,
): { score: number; iterations: number; improved: number } {
  const loads = loadsOf(model, assignment);
  let churnTotal = churnOf(model, assignment);
  let current = score(model, loads, churnTotal);
  let iterations = 0;
  let improved = 0;

  while (iterations < iterationCap) {
    iterations++;

    let bestDelta = -1e-12;
    let bestCell = -1;
    let bestRep = -1;
    let bestSwap = -1;

    // --- moves ---
    for (let c = 0; c < model.cellCount; c++) {
      const from = assignment[c]!;
      applyCell(model, loads, c, from, -1);
      const churnWithout = churnTotal - model.churn[c * model.repCount + from]!;

      for (const to of model.eligibleReps[c]!) {
        if (to === from) continue;
        applyCell(model, loads, c, to, 1);
        const churnWith = churnWithout + model.churn[c * model.repCount + to]!;
        const candidate =
          capacityOkFor(model, loads, from, to)
            ? score(model, loads, churnWith)
            : Infinity;
        applyCell(model, loads, c, to, -1);

        const delta = candidate - current;
        if (delta < bestDelta) {
          bestDelta = delta;
          bestCell = c;
          bestRep = to;
          bestSwap = -1;
        }
      }

      applyCell(model, loads, c, from, 1);
    }

    // --- swaps, restricted to the reps who are over the line ---
    const hot = new Set<number>();
    for (let a = 0; a < 3; a++) {
      let max = -Infinity;
      let arg = 0;
      for (let r = 0; r < model.repCount; r++) {
        if (loads[r * 3 + a]! > max) {
          max = loads[r * 3 + a]!;
          arg = r;
        }
      }
      hot.add(arg);
    }

    for (let c1 = 0; c1 < model.cellCount; c1++) {
      const r1 = assignment[c1]!;
      if (!hot.has(r1)) continue;

      for (let c2 = 0; c2 < model.cellCount; c2++) {
        const r2 = assignment[c2]!;
        if (r1 === r2) continue;
        if (model.eligible[c1 * model.repCount + r2] === 0) continue;
        if (model.eligible[c2 * model.repCount + r1] === 0) continue;

        applyCell(model, loads, c1, r1, -1);
        applyCell(model, loads, c2, r2, -1);
        applyCell(model, loads, c1, r2, 1);
        applyCell(model, loads, c2, r1, 1);

        const churnSwap =
          churnTotal -
          model.churn[c1 * model.repCount + r1]! -
          model.churn[c2 * model.repCount + r2]! +
          model.churn[c1 * model.repCount + r2]! +
          model.churn[c2 * model.repCount + r1]!;
        const candidate = capacityOkFor(model, loads, r1, r2)
          ? score(model, loads, churnSwap)
          : Infinity;

        applyCell(model, loads, c1, r2, -1);
        applyCell(model, loads, c2, r1, -1);
        applyCell(model, loads, c1, r1, 1);
        applyCell(model, loads, c2, r2, 1);

        const delta = candidate - current;
        if (delta < bestDelta) {
          bestDelta = delta;
          bestCell = c1;
          bestRep = r2;
          bestSwap = c2;
        }
      }
    }

    if (bestCell === -1) break;

    const from = assignment[bestCell]!;
    applyCell(model, loads, bestCell, from, -1);
    applyCell(model, loads, bestCell, bestRep, 1);
    churnTotal +=
      model.churn[bestCell * model.repCount + bestRep]! -
      model.churn[bestCell * model.repCount + from]!;
    assignment[bestCell] = bestRep;

    if (bestSwap !== -1) {
      const other = assignment[bestSwap]!;
      applyCell(model, loads, bestSwap, other, -1);
      applyCell(model, loads, bestSwap, from, 1);
      churnTotal +=
        model.churn[bestSwap * model.repCount + from]! -
        model.churn[bestSwap * model.repCount + other]!;
      assignment[bestSwap] = from;
    }

    current = score(model, loads, churnTotal);
    improved++;
  }

  return { score: current, iterations, improved };
}

function capacityOkFor(
  model: Model,
  loads: Float64Array,
  a: number,
  b: number,
): boolean {
  const capacity = model.capacity;
  if (!capacity) return true;
  return (
    loads[a * 3]! <= capacity.max &&
    loads[b * 3]! <= capacity.max &&
    loads[a * 3]! >= 0 &&
    loads[b * 3]! >= 0
  );
}

/**
 * Repairs a minimum-capacity violation by moving the lightest cell from the
 * fullest rep to the emptiest, repeatedly.
 *
 * The minimum can be unreachable at coarse granularity even when it is globally
 * satisfiable — eight reps and eight cells cannot give everyone forty accounts
 * if one cell holds twelve. That is a real property of the cell model rather
 * than a solver failure, and it gets its own named refusal.
 */
function repairMinimum(model: Model, assignment: Int32Array): boolean {
  const capacity = model.capacity;
  if (!capacity || capacity.min === 0) return true;

  for (let attempt = 0; attempt < model.cellCount * 4; attempt++) {
    const loads = loadsOf(model, assignment);
    if (capacityOk(model, loads)) return true;

    let needy = -1;
    let lowest = Infinity;
    for (let r = 0; r < model.repCount; r++) {
      if (loads[r * 3]! < lowest) {
        lowest = loads[r * 3]!;
        needy = r;
      }
    }
    if (needy === -1 || lowest >= capacity.min) return true;

    let donorCell = -1;
    let donorSize = Infinity;
    for (let c = 0; c < model.cellCount; c++) {
      const owner = assignment[c]!;
      if (owner === needy) continue;
      if (model.eligible[c * model.repCount + needy] === 0) continue;
      const size = model.weight[c * 3]!;
      const remaining = loads[owner * 3]! - size;
      if (remaining < capacity.min) continue;
      if (size < donorSize) {
        donorSize = size;
        donorCell = c;
      }
    }

    if (donorCell === -1) return false;
    assignment[donorCell] = needy;
  }

  return capacityOk(model, loadsOf(model, assignment));
}

export function search(prep: Preparation): SearchResult | "capacity-min-unreachable" {
  const model = buildModel(prep);
  const config = prep.config;

  let best: Int32Array | null = null;
  let bestScore = Infinity;
  let iterations = 0;
  let improved = 0;
  let anyFeasible = false;

  for (let restart = 0; restart < config.restarts; restart++) {
    const rng = new Rng(derive(config.seed, `restart:${restart}`));
    const assignment = seedAssignment(model, rng, restart > 0);
    const result = localSearch(model, assignment, config.iterationCap);
    iterations += result.iterations;
    improved += result.improved;

    if (!repairMinimum(model, assignment)) continue;
    if (!capacityOk(model, loadsOf(model, assignment))) continue;
    anyFeasible = true;

    const finalScore = score(model, loadsOf(model, assignment), churnOf(model, assignment));
    // Ties broken by assignment content, so the winner never depends on which
    // restart happened to run first.
    if (
      finalScore < bestScore - 1e-12 ||
      (Math.abs(finalScore - bestScore) <= 1e-12 && best !== null && lexLess(assignment, best))
    ) {
      bestScore = finalScore;
      best = Int32Array.from(assignment);
    }
  }

  if (!best || !anyFeasible) return "capacity-min-unreachable";

  return {
    assignment: best,
    loads: loadsOf(model, best),
    score: bestScore,
    iterations,
    improved,
    restarts: config.restarts,
  };
}

function lexLess(a: Int32Array, b: Int32Array): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  }
  return false;
}

export { AXIS_INDEX };
