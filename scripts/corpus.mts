/**
 * Regenerates the committed corpus. The output is checked in, so nobody needs
 * to run this to reproduce a result — but running it must produce a byte-
 * identical file, which is what makes "fixed seed" a claim rather than a hope.
 */
import { writeFileSync } from "node:fs";
import { generateAll } from "@/data/generate";

for (const universe of generateAll()) {
  const path = `data/universes/${universe.id}.json`;
  writeFileSync(path, JSON.stringify(universe) + "\n");
  const potential = universe.accounts.reduce((s, a) => s + a.potentialUsd, 0);
  const pipeline = universe.accounts.reduce((s, a) => s + a.openPipelineUsd, 0);
  console.log(
    `${path}  ${universe.accounts.length} accounts  ${universe.reps.length} reps  ` +
      `potential $${(potential / 1e6).toFixed(1)}M  pipeline $${(pipeline / 1e6).toFixed(1)}M`,
  );
}
