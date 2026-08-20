import type { ChurnFloor } from "@/lib/domain";
import type { Preparation } from "@/lib/setup";

/**
 * The churn floor: how much of the book cannot stay where it is.
 *
 * This bound exists because of something the tool discovered about its own demo
 * corpus and would have hidden otherwise. **The current carve is not
 * expressible as a rule.** It was cut by geography years ago and then split
 * between two reps per region by nothing in particular, so at any granularity
 * that does not encode "which of the two", some cells contain accounts belonging
 * to different owners — and a cell goes to one rep.
 *
 * So before the optimizer expresses a single preference, before any balance is
 * bought, some pipeline has already changed hands. Reporting a churn number
 * without that floor next to it invites the same mistake the imbalance floor
 * exists to prevent: treating a structural residual as something the plan chose.
 *
 * For each cell, the cheapest owner to keep is the eligible rep already holding
 * the most pipeline in it; everything else in that cell moves. Pinned accounts
 * held by a different rep move by instruction. Both are unavoidable, so their
 * sum is a sound lower bound.
 */
export function churnFloorOf(prep: Preparation): ChurnFloor {
  let minPipelineMoved = 0;
  let minAccountsMoved = 0;
  let totalPipeline = 0;

  for (const account of prep.universe.accounts) {
    totalPipeline += account.openPipelineUsd;
  }

  for (const cell of prep.cells) {
    const eligible = new Set(prep.eligibility.get(cell.key) ?? []);
    const pipelineByOwner = new Map<string, number>();
    const countByOwner = new Map<string, number>();
    let cellPipeline = 0;

    for (const accountId of cell.accountIds) {
      const account = prep.accountById.get(accountId);
      if (!account) continue;
      cellPipeline += account.openPipelineUsd;
      if (!eligible.has(account.currentOwnerId)) continue;
      pipelineByOwner.set(
        account.currentOwnerId,
        (pipelineByOwner.get(account.currentOwnerId) ?? 0) + account.openPipelineUsd,
      );
      countByOwner.set(
        account.currentOwnerId,
        (countByOwner.get(account.currentOwnerId) ?? 0) + 1,
      );
    }

    const keptPipeline = Math.max(0, ...pipelineByOwner.values());
    const keptCount = Math.max(0, ...countByOwner.values());
    minPipelineMoved += cellPipeline - keptPipeline;
    minAccountsMoved += cell.accountIds.length - keptCount;
  }

  // Pins move by instruction, and they left the lattice, so they are not
  // counted above.
  for (const exception of prep.exceptions) {
    if (exception.reason !== "pinned") continue;
    const account = prep.accountById.get(exception.accountId);
    if (!account || account.currentOwnerId === exception.repId) continue;
    minPipelineMoved += account.openPipelineUsd;
    minAccountsMoved += 1;
  }

  return {
    minPipelineMovedUsd: minPipelineMoved,
    fraction: totalPipeline === 0 ? 0 : minPipelineMoved / totalPipeline,
    minAccountsMoved,
  };
}
