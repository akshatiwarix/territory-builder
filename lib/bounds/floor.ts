import {
  AXES,
  type Axis,
  type AxisBounds,
  type BoundName,
  type Config,
  type ConstraintCost,
  type ConstraintName,
  type Floor,
  type Universe,
} from "@/lib/domain";
import { prepare, type Preparation } from "@/lib/setup";
import { churnFloorOf } from "./churn";

/**
 * The certified floor.
 *
 * Everything in this file is arithmetic over cell weights. Nothing here runs a
 * search, and this module must never import lib/optimize — a bound that depends
 * on a search is not a bound, it is a result, and reporting one as the other is
 * the exact move this repo exists to refuse. Sweep invariant 1 checks the
 * relationship from the other side: no plan may ever come in under these
 * numbers.
 *
 * Each bound below is a lower bound on the *maximum* rep load, which is what
 * `imbalanceOf` measures, so no translation is needed between the two.
 */

/** Pigeonhole: somebody carries at least the mean. */
function idealBound(total: number, repCount: number): number {
  return total / repCount;
}

/**
 * Cells are indivisible, so the largest one lands on some rep whole — and that
 * rep is already carrying whatever their exceptions committed to them. Taking
 * the cheapest eligible rep keeps the bound sound while still using the
 * committed load, which matters when protection has loaded one rep heavily.
 */
function cellBound(prep: Preparation, axis: Axis): number {
  let best = 0;
  for (const cell of prep.cells) {
    const eligible = prep.eligibility.get(cell.key) ?? [];
    let cheapest = Infinity;
    for (const repId of eligible) {
      cheapest = Math.min(cheapest, prep.committed.get(repId)?.[axis] ?? 0);
    }
    if (!Number.isFinite(cheapest)) cheapest = 0;
    best = Math.max(best, cell.weight[axis] + cheapest);
  }
  return best;
}

/**
 * The m+1 largest cells cannot each have a rep to themselves, so two of them
 * share one. The tightest statement of that is the sum of the m-th and
 * (m+1)-th largest.
 */
function pairBound(prep: Preparation, axis: Axis, repCount: number): number {
  if (prep.cells.length <= repCount) return 0;
  const sorted = prep.cells.map((c) => c.weight[axis]).sort((a, b) => b - a);
  return (sorted[repCount - 1] ?? 0) + (sorted[repCount] ?? 0);
}

/**
 * What the constraints have already decided.
 *
 * Three separate sound statements, maxed:
 *
 *  - a rep's committed load from pins and protection is a floor under that rep;
 *  - if only rep set S may take cell set C, then C plus S's own commitments
 *    spread over |S| reps puts a floor under the busiest of them;
 *  - if every rep is capped at `max` accounts, the remaining reps cannot absorb
 *    more than (m-1) * max, so somebody carries at least the remainder.
 */
function forcedBound(
  prep: Preparation,
  axis: Axis,
  repCount: number,
  config: Config,
): number {
  let best = 0;

  for (const load of prep.committed.values()) best = Math.max(best, load[axis]);

  // One group per distinct exclusion pattern. Combinations of patterns would
  // give tighter bounds; single patterns are enough to make the point and every
  // one of them is individually sound.
  const patterns = new Map<string, { dimension: string; value: string }>();
  for (const exclusion of config.constraints.exclusions) {
    patterns.set(`${exclusion.dimension}=${exclusion.value}`, {
      dimension: exclusion.dimension,
      value: exclusion.value,
    });
  }

  for (const pattern of patterns.values()) {
    const restricted = prep.cells.filter(
      (cell) =>
        (cell.values as Record<string, string | undefined>)[pattern.dimension] ===
        pattern.value,
    );
    if (restricted.length === 0) continue;

    const eligibleReps = new Set<string>();
    for (const cell of restricted) {
      for (const repId of prep.eligibility.get(cell.key) ?? []) eligibleReps.add(repId);
    }
    if (eligibleReps.size === 0) continue;

    let weight = restricted.reduce((sum, cell) => sum + cell.weight[axis], 0);
    for (const repId of eligibleReps) {
      weight += prep.committed.get(repId)?.[axis] ?? 0;
    }
    best = Math.max(best, weight / eligibleReps.size);
  }

  const capacity = config.constraints.capacity;
  if (capacity && axis === "count") {
    best = Math.max(best, prep.totals.count - (repCount - 1) * capacity.max);
  }

  return best;
}

export function axisBounds(
  prep: Preparation,
  axis: Axis,
  config: Config,
): AxisBounds {
  const repCount = prep.universe.reps.length;
  const total = prep.totals[axis];
  const ideal = idealBound(total, repCount);

  const bounds: Record<BoundName, number> = {
    ideal,
    cell: cellBound(prep, axis),
    pair: pairBound(prep, axis, repCount),
    forced: forcedBound(prep, axis, repCount, config),
  };

  let binding: BoundName = "ideal";
  let minMaxLoad = bounds.ideal;
  for (const name of ["cell", "pair", "forced"] as BoundName[]) {
    if (bounds[name] > minMaxLoad) {
      minMaxLoad = bounds[name];
      binding = name;
    }
  }

  return {
    ideal,
    bounds,
    binding,
    minMaxLoad,
    floor: ideal === 0 ? 0 : Math.max(0, (minMaxLoad - ideal) / ideal),
  };
}

export function floorOf(prep: Preparation, config: Config): Record<Axis, AxisBounds> {
  const result = {} as Record<Axis, AxisBounds>;
  for (const axis of AXES) result[axis] = axisBounds(prep, axis, config);
  return result;
}

const CONSTRAINT_NAMES: ConstraintName[] = [
  "pinned",
  "capacity",
  "exclusions",
  "protectStage",
];

function withoutConstraint(config: Config, constraint: ConstraintName): Config {
  const constraints = { ...config.constraints };
  if (constraint === "pinned") constraints.pinned = {};
  if (constraint === "capacity") constraints.capacity = null;
  if (constraint === "exclusions") constraints.exclusions = [];
  if (constraint === "protectStage") constraints.protectStage = null;
  return { ...config, constraints };
}

function isActive(config: Config, constraint: ConstraintName): boolean {
  const c = config.constraints;
  if (constraint === "pinned") return Object.keys(c.pinned).length > 0;
  if (constraint === "capacity") return c.capacity !== null;
  if (constraint === "exclusions") return c.exclusions.length > 0;
  return c.protectStage !== null;
}

/**
 * What each constraint costs, in imbalance points, measured by lifting it and
 * recomputing the floor.
 *
 * This is what lets someone say "protection is costing us thirty points of
 * pipeline imbalance and we chose that" in the room, instead of finding it out
 * in a hallway six weeks later. Note that a constraint can cost nothing while
 * being active — if the universe's own lumpiness already forces a larger
 * residual, the constraint is free at that granularity, and saying so is more
 * useful than charging it for something it did not do.
 */
export function constraintCosts(
  universe: Universe,
  config: Config,
  withAll: Record<Axis, AxisBounds>,
): ConstraintCost[] {
  const costs: ConstraintCost[] = [];

  for (const constraint of CONSTRAINT_NAMES) {
    const active = isActive(config, constraint);
    const floorWith = {} as Record<Axis, number>;
    for (const axis of AXES) floorWith[axis] = withAll[axis].floor;

    if (!active) {
      costs.push({
        constraint,
        active,
        floorWith,
        floorWithout: floorWith,
        cost: { count: 0, potential: 0, pipeline: 0 },
      });
      continue;
    }

    const lifted = prepare(universe, withoutConstraint(config, constraint));
    if (lifted.kind === "infeasible") {
      costs.push({
        constraint,
        active,
        floorWith,
        floorWithout: floorWith,
        cost: { count: 0, potential: 0, pipeline: 0 },
      });
      continue;
    }

    const without = floorOf(lifted, lifted.config);
    const floorWithout = {} as Record<Axis, number>;
    const cost = {} as Record<Axis, number>;
    for (const axis of AXES) {
      floorWithout[axis] = without[axis].floor;
      cost[axis] = Math.max(0, floorWith[axis] - floorWithout[axis]);
    }

    costs.push({ constraint, active, floorWith, floorWithout, cost });
  }

  return costs;
}

export function computeFloor(universe: Universe, prep: Preparation): Floor {
  const perAxis = floorOf(prep, prep.config);
  return {
    perAxis,
    costs: constraintCosts(universe, prep.config, perAxis),
    churn: churnFloorOf(prep),
  };
}
