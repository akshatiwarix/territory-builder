import type { Account, Config, Plan, RepId, Universe } from "@/lib/domain";
import { imbalanceOf, repLoads, resolveOwners, universeTotals } from "@/lib/measure";
import { buildPlan } from "@/lib/optimize";
import { prepare } from "@/lib/setup";
import { Rng, derive } from "@/lib/rng";

/**
 * What the balance claim is worth.
 *
 * `potentialUsd` is a model output with a stated error band, and a plan balanced
 * to a point number on top of it has distributed the estimation error evenly and
 * called that fairness. Two questions get asked here, and they are different
 * questions:
 *
 *  - **Intervals**: hold the plan fixed, wobble the estimates within their own
 *    bands, and watch the reported imbalance move. Cheap. Answers "is the number
 *    on screen a number?"
 *  - **Stability**: re-run the whole optimization under each wobble and count how
 *    many accounts keep their owner. Expensive. Answers the harder question —
 *    whether this plan was a decision or one sample from a distribution of plans.
 *
 * A plan that reshuffles half the book when the estimates move inside their own
 * error bars was never a plan, and the second number is the only one that says so.
 */

const INTERVAL_DRAWS = 200;
const STABILITY_DRAWS = 64;

export type Interval = { p5: number; p50: number; p95: number };

export type StabilityResult = {
  draws: { intervals: number; stability: number };
  /** Imbalance on the potential axis, as an interval rather than a point. */
  potentialImbalance: Interval;
  /** How often the same rep is the worst-loaded one. */
  worstRepSurvival: number;
  worstRepId: RepId;
  /** Mean fraction of accounts that keep their owner when the plan is re-run. */
  ownerRetention: number;
  retentionRange: Interval;
};

/**
 * A multiplicative lognormal draw, scaled so the *mean* is preserved. A
 * perturbation that quietly inflated every estimate would produce a stability
 * number about the drift rather than about the noise.
 */
function perturb(universe: Universe, rng: Rng): Universe {
  const accounts: Account[] = universe.accounts.map((account) => {
    const sigma = account.potentialBand;
    const factor = Math.exp(sigma * rng.normal() - (sigma * sigma) / 2);
    return { ...account, potentialUsd: account.potentialUsd * factor };
  });
  return { ...universe, accounts };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  const weight = index - lo;
  return (sorted[lo] ?? 0) * (1 - weight) + (sorted[hi] ?? 0) * weight;
}

function intervalOf(values: number[]): Interval {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p5: quantile(sorted, 0.05),
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
  };
}

function worstRepOf(
  universe: Universe,
  owners: Map<string, RepId>,
): RepId {
  const loads = repLoads(universe.accounts, owners, universe.reps);
  let worst = universe.reps[0]!.id;
  let max = -Infinity;
  for (const [repId, load] of [...loads].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (load.potential > max) {
      max = load.potential;
      worst = repId;
    }
  }
  return worst;
}

export function analyseStability(
  universe: Universe,
  config: Config,
  plan: Plan,
): StabilityResult {
  const prep = prepare(universe, config);
  if (prep.kind === "infeasible") {
    throw new Error(`stability on an infeasible config: ${prep.reason}`);
  }

  const owners = resolveOwners(prep.cells, plan.cellAssignment, plan.exceptions);
  const baselineWorst = worstRepOf(universe, owners);

  // --- intervals: the same plan, re-scored ---------------------------------
  const imbalances: number[] = [];
  let worstSurvived = 0;

  for (let draw = 0; draw < INTERVAL_DRAWS; draw++) {
    const rng = new Rng(derive(config.seed, `interval:${draw}`));
    const wobbled = perturb(universe, rng);
    const loads = repLoads(wobbled.accounts, owners, wobbled.reps);
    const totals = universeTotals(wobbled.accounts);
    imbalances.push(imbalanceOf(loads, totals, wobbled.reps.length).potential);
    if (worstRepOf(wobbled, owners) === baselineWorst) worstSurvived++;
  }

  // --- stability: the whole optimization, re-run ---------------------------
  const retentions: number[] = [];
  const cheaper: Config = { ...config, restarts: Math.min(config.restarts, 2) };

  for (let draw = 0; draw < STABILITY_DRAWS; draw++) {
    const rng = new Rng(derive(config.seed, `stability:${draw}`));
    const wobbled = perturb(universe, rng);
    const result = buildPlan(wobbled, cheaper);
    if (result.kind !== "plan") continue;

    const redone = new Map<string, RepId>();
    for (const territory of result.plan.territories) {
      for (const id of territory.accountIds) redone.set(id, territory.repId);
    }

    let kept = 0;
    for (const account of universe.accounts) {
      if (redone.get(account.id) === owners.get(account.id)) kept++;
    }
    retentions.push(kept / universe.accounts.length);
  }

  const retentionMean =
    retentions.length === 0
      ? 1
      : retentions.reduce((sum, value) => sum + value, 0) / retentions.length;

  return {
    draws: { intervals: INTERVAL_DRAWS, stability: retentions.length },
    potentialImbalance: intervalOf(imbalances),
    worstRepSurvival: worstSurvived / INTERVAL_DRAWS,
    worstRepId: baselineWorst,
    ownerRetention: retentionMean,
    retentionRange: intervalOf(retentions),
  };
}
