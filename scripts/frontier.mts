/**
 * Precomputes and commits the frontier, the stability analysis and the random
 * baseline for every universe at every granularity level, using the default
 * weights and constraints.
 *
 * Committed rather than computed on request because the frontier is thirty-two
 * optimizer runs and the stability analysis is sixty-four more: a first paint
 * that waits on ninety-six searches is a demo nobody scrolls past. Anything the
 * user changes away from the defaults is recomputed live, and the console says
 * which numbers came from here.
 */
import { writeFileSync } from "node:fs";
import { listUniverses } from "@/data";
import { defaultConfig, GRANULARITY_LEVELS, type Config } from "@/lib/domain";
import { buildPlan } from "@/lib/optimize";
import { computeFrontier } from "@/lib/analysis/frontier";
import { analyseStability } from "@/lib/analysis/stability";
import { randomBaseline } from "@/lib/analysis/baseline";

const started = Date.now();

for (const universe of listUniverses()) {
  const artifact: Record<string, unknown> = { universeId: universe.id, levels: {} };
  const levels = artifact.levels as Record<string, unknown>;

  for (const granularity of GRANULARITY_LEVELS) {
    const config: Config = { ...defaultConfig(universe.id), granularity };
    const result = buildPlan(universe, config);
    if (result.kind !== "plan") {
      console.log(`  ${universe.id} L${granularity}: infeasible (${result.reason})`);
      continue;
    }

    const frontier = computeFrontier(universe, config);
    const stability = analyseStability(universe, config, result.plan);
    const baseline = randomBaseline(universe, config);

    levels[granularity] = { frontier, stability, baseline };

    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    console.log(
      `  ${universe.id} L${granularity}: ` +
        `potential ${pct(result.plan.imbalance.potential)} ` +
        `(floor ${pct(result.plan.floor.perAxis.potential.floor)}, ` +
        `random ${pct(baseline.medianPotentialImbalance)}) · ` +
        `churn ${pct(result.plan.churn.pipelineMovedFraction)} ` +
        `(floor ${pct(result.plan.floor.churn.fraction)}) · ` +
        `retention ${pct(stability.ownerRetention)} · ` +
        `frontier ${frontier.points.filter((p) => !p.dominated).length}/${frontier.points.length}`,
    );
  }

  const path = `data/artifacts/${universe.id}.json`;
  writeFileSync(path, JSON.stringify(artifact) + "\n");
  console.log(`${path} written`);
}

console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
