import { z } from "zod";
import { listUniverses } from "@/data";
import { configSchema, defaultConfig } from "@/lib/domain";

/**
 * GET /api/schema
 *
 * Rendered from the same zod schema the endpoint validates with, so it cannot
 * drift from the implementation the way a hand-written schema page does.
 */
export async function GET() {
  return Response.json({
    endpoint: "POST /api/v1/plan",
    request: z.toJSONSchema(configSchema),
    example: defaultConfig("meridian"),
    universes: listUniverses().map((universe) => ({
      id: universe.id,
      label: universe.label,
      accounts: universe.accounts.length,
      reps: universe.reps.length,
    })),
    notes: [
      "The plan is a pure function of this config. Same config, same seed, byte-identical plan.",
      "A configuration that cannot be satisfied returns 422 with a named reason, never a silently dropped constraint.",
      "imbalance = (max rep load - ideal) / ideal, reported per axis and never summed.",
      "floor.perAxis[axis].floor is a certified lower bound on that imbalance, derived arithmetically and never from a search.",
      "floor.churn is the pipeline that changes hands before the optimizer expresses any preference, because the current carve is not expressible as a rule.",
      "The gap between floor and achieved is unknown. It is not a claim of near-optimality.",
    ],
  });
}
