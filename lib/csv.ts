import type { Plan, Universe } from "@/lib/domain";

function escape(value: string | number | boolean): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The assignment as a CSV.
 *
 * The actual buyer of this output pastes it into a CRM, and a territory tool
 * whose result cannot leave the browser is a demo rather than a tool. The moved
 * flag and the exception reason are columns rather than a summary, because the
 * person importing this needs to be able to sort by "what changed" and defend
 * each row.
 */
export function planToCsv(universe: Universe, plan: Plan): string {
  const ownerOf = new Map<string, string>();
  for (const territory of plan.territories) {
    for (const id of territory.accountIds) ownerOf.set(id, territory.repId);
  }
  const exceptionOf = new Map(plan.exceptions.map((e) => [e.accountId, e.reason]));
  const repName = new Map(universe.reps.map((rep) => [rep.id, rep.name]));

  const header = [
    "account_id",
    "account_name",
    "industry",
    "region",
    "segment",
    "employee_band",
    "potential_usd",
    "potential_band",
    "open_pipeline_usd",
    "open_opp_stage",
    "current_owner_id",
    "current_owner_name",
    "proposed_owner_id",
    "proposed_owner_name",
    "moved",
    "exception_reason",
  ];

  const rows = universe.accounts.map((account) => {
    const proposed = ownerOf.get(account.id) ?? "";
    return [
      account.id,
      account.name,
      account.industry,
      account.region,
      account.segment,
      account.employeeBand,
      account.potentialUsd,
      account.potentialBand,
      account.openPipelineUsd,
      account.openOppStage ?? "",
      account.currentOwnerId,
      repName.get(account.currentOwnerId) ?? "",
      proposed,
      repName.get(proposed) ?? "",
      proposed !== account.currentOwnerId,
      exceptionOf.get(account.id) ?? "",
    ].map(escape);
  });

  return [header.join(","), ...rows.map((row) => row.join(","))].join("\n") + "\n";
}
