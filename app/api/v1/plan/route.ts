import { getUniverse } from "@/data";
import { configSchema, type Config } from "@/lib/domain";
import { buildPlan } from "@/lib/optimize";

/**
 * POST /api/v1/plan
 *
 * Config in, full plan out: the assignment, all three imbalance axes, all three
 * churn measures, the certified floor with its four bounds itemised, the churn
 * floor, and what each constraint costs.
 *
 * A configuration that cannot be satisfied returns 422 with a machine-readable
 * `reason` and a sentence a person can act on. It is an answer, not an error,
 * and it is the only kind of failure this endpoint has.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid-json", detail: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const parsed = configSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid-config", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const config = parsed.data as Config;
  const universe = getUniverse(config.universeId);
  if (!universe) {
    return Response.json(
      { error: "unknown-universe", detail: `No universe with id ${config.universeId}.` },
      { status: 404 },
    );
  }

  const started = Date.now();
  const result = buildPlan(universe, config);

  if (result.kind === "infeasible") {
    return Response.json(
      { kind: "infeasible", reason: result.reason, detail: result.detail },
      { status: 422 },
    );
  }

  return Response.json({
    kind: "plan",
    universe: { id: universe.id, label: universe.label, reps: universe.reps },
    plan: result.plan,
    elapsedMs: Date.now() - started,
  });
}
