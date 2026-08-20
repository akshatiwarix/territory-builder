import {
  AXES,
  dimensionsForLevel,
  type Account,
  type Axis,
  type Cell,
  type Dimension,
  type GranularityLevel,
} from "@/lib/domain";

/**
 * A cell key is derived, stable and order-fixed, so it can serve as a tie-break
 * in the optimizer. Every tie-break in this repo has to be total, or determinism
 * is a claim we cannot make.
 */
export function cellKey(
  values: Partial<Record<Dimension, string>>,
  dimensions: readonly Dimension[],
): string {
  return dimensions.map((d) => values[d] ?? "*").join(" | ");
}

const AXIS_OF: Record<Axis, (a: Account) => number> = {
  count: () => 1,
  potential: (a) => a.potentialUsd,
  pipeline: (a) => a.openPipelineUsd,
};

/**
 * Builds the occupied cells of the lattice at a granularity level.
 *
 * `excluded` are the accounts lifted out as exceptions (pinned or protected).
 * They are removed *before* cells are weighed, which is the only correct
 * ordering: a protected account is not available to the optimizer, so counting
 * its value inside a cell would inflate a bound with weight nobody can move.
 *
 * Empty cells are never built. The lattice addresses 480 tuples at level 4 and
 * the corpus occupies 278 of them; a bound computed over phantom cells would be
 * a bound about a universe that does not exist.
 */
export function buildCells(
  accounts: Account[],
  level: GranularityLevel,
  excluded: ReadonlySet<string> = new Set(),
): Cell[] {
  const dimensions = dimensionsForLevel(level);
  const byKey = new Map<string, Cell>();

  for (const account of accounts) {
    if (excluded.has(account.id)) continue;

    const values: Partial<Record<Dimension, string>> = {};
    for (const d of dimensions) values[d] = account[d];
    const key = cellKey(values, dimensions);

    let cell = byKey.get(key);
    if (!cell) {
      cell = {
        key,
        values,
        accountIds: [],
        weight: { count: 0, potential: 0, pipeline: 0 },
      };
      byKey.set(key, cell);
    }
    cell.accountIds.push(account.id);
    for (const axis of AXES) cell.weight[axis] += AXIS_OF[axis](account);
  }

  // Sorted by key so the cell list is deterministic independent of the account
  // order it was built from.
  return [...byKey.values()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
}

export function totalWeight(cells: Cell[]): Record<Axis, number> {
  const total: Record<Axis, number> = { count: 0, potential: 0, pipeline: 0 };
  for (const cell of cells) {
    for (const axis of AXES) total[axis] += cell.weight[axis];
  }
  return total;
}
