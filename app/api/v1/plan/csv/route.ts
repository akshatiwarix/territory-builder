import { getUniverse } from "@/data";
import { planToCsv } from "@/lib/csv";
import { buildPlan } from "@/lib/optimize";
import { decodeConfig } from "@/lib/permalink";

/**
 * GET /api/v1/plan/csv?c=<permalink>
 *
 * The same plan the console is showing, as a file. Driven by the permalink so
 * the export and the screen cannot disagree.
 */
export async function GET(request: Request) {
  const encoded = new URL(request.url).searchParams.get("c");
  const config = decodeConfig(encoded);
  if (!config) {
    return Response.json(
      { error: "invalid-config", detail: "The ?c= parameter is missing or unreadable." },
      { status: 400 },
    );
  }

  const universe = getUniverse(config.universeId);
  if (!universe) {
    return Response.json({ error: "unknown-universe" }, { status: 404 });
  }

  const result = buildPlan(universe, config);
  if (result.kind === "infeasible") {
    return Response.json(
      { kind: "infeasible", reason: result.reason, detail: result.detail },
      { status: 422 },
    );
  }

  return new Response(planToCsv(universe, result.plan), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${universe.id}-territories.csv"`,
    },
  });
}
