import type { Config, Universe, Weights } from "@/lib/domain";
import { buildPlan } from "@/lib/optimize";

/**
 * The frontier.
 *
 * The three balance axes and churn genuinely conflict, and the console refuses
 * to collapse them into a score. That refusal is only honest if the user can see
 * the tradeoff, so the weight vector is swept over a fixed grid and every
 * resulting plan is plotted. The weights are a *position*, never a rating.
 */

export type FrontierPoint = {
  weights: Weights;
  imbalance: { count: number; potential: number; pipeline: number };
  churnPipelineFraction: number;
  churnAccountsFraction: number;
  churnPipelineUsd: number;
  dominated: boolean;
};

export type FrontierResult = {
  universeId: string;
  granularity: number;
  points: FrontierPoint[];
};

/**
 * Thirty-two vectors: a potential-emphasis sweep crossed with a churn-emphasis
 * sweep, plus the eight corners worth having. Fixed rather than adaptive so the
 * picture is comparable between granularity levels and between runs.
 */
export function weightGrid(): Weights[] {
  const grid: Weights[] = [];
  for (const potential of [1, 2, 4]) {
    for (const churn of [0, 0.25, 0.5, 1, 2, 4, 8, 16]) {
      grid.push({ count: 1, potential, pipeline: 1, churn });
    }
  }
  grid.push(
    { count: 0, potential: 0, pipeline: 0, churn: 1 },
    { count: 0, potential: 1, pipeline: 0, churn: 0 },
    { count: 1, potential: 0, pipeline: 0, churn: 0 },
    { count: 0, potential: 0, pipeline: 1, churn: 0 },
    { count: 4, potential: 1, pipeline: 1, churn: 1 },
    { count: 1, potential: 1, pipeline: 4, churn: 1 },
    { count: 2, potential: 2, pipeline: 2, churn: 0.5 },
    { count: 1, potential: 8, pipeline: 1, churn: 2 },
  );
  return grid;
}

/**
 * A point is dominated if another point is at least as good on every reported
 * dimension and strictly better on one. Dominated points are kept and flagged
 * rather than discarded — seeing that two thirds of the grid is dominated is
 * itself informative about how sharply the axes trade.
 */
function markDominated(points: FrontierPoint[]): void {
  const dims = (p: FrontierPoint) => [
    p.imbalance.count,
    p.imbalance.potential,
    p.imbalance.pipeline,
    p.churnPipelineFraction,
  ];

  for (const point of points) {
    point.dominated = points.some((other) => {
      if (other === point) return false;
      const a = dims(other);
      const b = dims(point);
      const noWorse = a.every((value, i) => value <= b[i]! + 1e-12);
      const better = a.some((value, i) => value < b[i]! - 1e-9);
      return noWorse && better;
    });
  }
}

export function computeFrontier(universe: Universe, base: Config): FrontierResult {
  const points: FrontierPoint[] = [];

  for (const weights of weightGrid()) {
    const result = buildPlan(universe, { ...base, weights });
    if (result.kind !== "plan") continue;
    const plan = result.plan;
    points.push({
      weights,
      imbalance: { ...plan.imbalance },
      churnPipelineFraction: plan.churn.pipelineMovedFraction,
      churnAccountsFraction: plan.churn.accountsMovedFraction,
      churnPipelineUsd: plan.churn.pipelineMovedUsd,
      dominated: false,
    });
  }

  markDominated(points);
  return { universeId: universe.id, granularity: base.granularity, points };
}
