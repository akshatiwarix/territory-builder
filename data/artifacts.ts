import meridian from "./artifacts/meridian.json";
import northwind from "./artifacts/northwind.json";
import type { FrontierResult } from "@/lib/analysis/frontier";
import type { StabilityResult } from "@/lib/analysis/stability";
import type { Baseline } from "@/lib/analysis/baseline";
import type { GranularityLevel } from "@/lib/domain";

export type LevelArtifact = {
  frontier: FrontierResult;
  stability: StabilityResult;
  baseline: Baseline;
};

type Artifact = {
  universeId: string;
  levels: Record<string, LevelArtifact>;
};

const ARTIFACTS = [meridian, northwind] as unknown as Artifact[];

/**
 * Precomputed analysis, valid only for the default weights and constraints.
 *
 * The caller has to know that, so it is not hidden behind a convenience: every
 * surface that shows one of these numbers also says it was computed with the
 * default constraint set, and stops showing it when the user changes one.
 */
export function artifactFor(
  universeId: string,
  granularity: GranularityLevel,
): LevelArtifact | undefined {
  return ARTIFACTS.find((a) => a.universeId === universeId)?.levels[
    String(granularity)
  ];
}
