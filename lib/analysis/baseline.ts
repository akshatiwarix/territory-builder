import type { Config, Universe } from "@/lib/domain";
import { imbalanceOf, repLoads, resolveOwners } from "@/lib/measure";
import { prepare } from "@/lib/setup";
import { Rng, derive } from "@/lib/rng";

/**
 * What a carve looks like when nobody optimized anything.
 *
 * `THE FREE BALANCE` is the pathology this exists for. On a universe with no
 * lumps, almost any assignment lands near the target — so a tool that prints the
 * same triumphant "balanced to 3%" there as on a hard universe is not measuring
 * its own contribution, it is measuring the universe and taking the credit.
 *
 * The random baseline is the denominator that makes the achieved number mean
 * something. Where the median random carve is already better than the target,
 * the console says the target was free.
 */
export type Baseline = {
  draws: number;
  medianPotentialImbalance: number;
  bestPotentialImbalance: number;
  medianCountImbalance: number;
};

const DRAWS = 200;

export function randomBaseline(universe: Universe, config: Config): Baseline {
  const prep = prepare(universe, config);
  if (prep.kind === "infeasible") {
    throw new Error(`baseline on an infeasible config: ${prep.reason}`);
  }

  const potentials: number[] = [];
  const counts: number[] = [];

  for (let draw = 0; draw < DRAWS; draw++) {
    const rng = new Rng(derive(config.seed, `baseline:${draw}`));
    const assignment: Record<string, string> = {};
    for (const cell of prep.cells) {
      const eligible = prep.eligibility.get(cell.key) ?? [];
      assignment[cell.key] = eligible[rng.int(eligible.length)] ?? eligible[0]!;
    }

    const owners = resolveOwners(prep.cells, assignment, prep.exceptions);
    const loads = repLoads(universe.accounts, owners, universe.reps);
    const imbalance = imbalanceOf(loads, prep.totals, universe.reps.length);
    potentials.push(imbalance.potential);
    counts.push(imbalance.count);
  }

  potentials.sort((a, b) => a - b);
  counts.sort((a, b) => a - b);

  return {
    draws: DRAWS,
    medianPotentialImbalance: potentials[Math.floor(DRAWS / 2)] ?? 0,
    bestPotentialImbalance: potentials[0] ?? 0,
    medianCountImbalance: counts[Math.floor(DRAWS / 2)] ?? 0,
  };
}
