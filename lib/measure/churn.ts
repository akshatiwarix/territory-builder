import type { Account, Churn } from "@/lib/domain";
import type { Owners } from "./loads";

/**
 * Relationship equity destroyed by moving an account.
 *
 * The constants below are arbitrary. They are stated here, in the README, and on
 * screen, precisely because they are arbitrary — the claim this repo makes is
 * not that this formula is right, it is that scoring churn by account count is
 * definitely wrong, and that a weighting the user can see and disagree with
 * beats one they cannot.
 *
 * Two years of ownership is treated as full weight, and an account touched in
 * the last month is worth half again as much to move as one nobody has called
 * since the spring.
 */
export function equityOf(account: Account): number {
  const tenureFactor = Math.min(Math.max(account.tenureDays / 730, 0.25), 1.5);
  const recencyFactor =
    account.lastActivityDays < 30 ? 1.5 : account.lastActivityDays < 90 ? 1.0 : 0.5;
  return account.openPipelineUsd * tenureFactor * recencyFactor;
}

function safeFraction(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

/**
 * Churn measured against the book on the ground.
 *
 * Reported three ways because the three disagree, and the disagreement is the
 * information. Moving four hundred dormant accounts is nearly free; moving one
 * account with a live negotiation is not. A plan scored on `accountsMoved` alone
 * will happily trade the second for the first, which is how territory plans get
 * overruled in the room.
 */
export function computeChurn(
  accounts: Account[],
  owners: Owners,
  protectedIds: ReadonlySet<string>,
): Churn {
  let accountsMoved = 0;
  let pipelineMovedUsd = 0;
  let equityMoved = 0;
  let totalPipeline = 0;
  let totalEquity = 0;

  for (const account of accounts) {
    const equity = equityOf(account);
    totalPipeline += account.openPipelineUsd;
    totalEquity += equity;

    const owner = owners.get(account.id);
    if (owner === undefined || owner === account.currentOwnerId) continue;

    accountsMoved += 1;
    pipelineMovedUsd += account.openPipelineUsd;
    equityMoved += equity;
  }

  return {
    accountsMoved,
    accountsMovedFraction: safeFraction(accountsMoved, accounts.length),
    pipelineMovedUsd,
    pipelineMovedFraction: safeFraction(pipelineMovedUsd, totalPipeline),
    equityMoved,
    equityMovedFraction: safeFraction(equityMoved, totalEquity),
    protectedHeld: protectedIds.size,
  };
}

/**
 * The optimizer's internal view of churn: one fraction, in pipeline dollars.
 *
 * Pipeline rather than account count because that is the cost the tool claims is
 * real, and a search that optimized a different quantity from the one displayed
 * would be answering a question nobody asked.
 */
export function churnFraction(accounts: Account[], owners: Owners): number {
  let moved = 0;
  let total = 0;
  for (const account of accounts) {
    total += account.openPipelineUsd;
    const owner = owners.get(account.id);
    if (owner !== undefined && owner !== account.currentOwnerId) {
      moved += account.openPipelineUsd;
    }
  }
  return safeFraction(moved, total);
}
