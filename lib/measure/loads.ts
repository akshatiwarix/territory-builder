import {
  AXES,
  type Account,
  type Axis,
  type Cell,
  type PlanException,
  type Rep,
  type RepId,
} from "@/lib/domain";

export type Owners = Map<string, RepId>;

/**
 * Resolves who owns each account: the cell assignment, then exceptions on top.
 *
 * Exceptions win, and they are the only thing that can win. That is what keeps
 * the rule renderable — every deviation from "the cell decides" is an
 * enumerable, displayable fact rather than a special case buried in the search.
 */
export function resolveOwners(
  cells: Cell[],
  cellAssignment: Record<string, RepId>,
  exceptions: PlanException[],
): Owners {
  const owners: Owners = new Map();
  for (const cell of cells) {
    const repId = cellAssignment[cell.key];
    if (repId === undefined) continue;
    for (const id of cell.accountIds) owners.set(id, repId);
  }
  for (const exception of exceptions) owners.set(exception.accountId, exception.repId);
  return owners;
}

export const AXIS_WEIGHT: Record<Axis, (a: Account) => number> = {
  count: () => 1,
  potential: (a) => a.potentialUsd,
  pipeline: (a) => a.openPipelineUsd,
};

export function emptyLoad(): Record<Axis, number> {
  return { count: 0, potential: 0, pipeline: 0 };
}

export function repLoads(
  accounts: Account[],
  owners: Owners,
  reps: Rep[],
): Map<RepId, Record<Axis, number>> {
  const loads = new Map<RepId, Record<Axis, number>>();
  for (const rep of reps) loads.set(rep.id, emptyLoad());

  for (const account of accounts) {
    const repId = owners.get(account.id);
    if (repId === undefined) continue;
    const load = loads.get(repId);
    if (!load) continue;
    for (const axis of AXES) load[axis] += AXIS_WEIGHT[axis](account);
  }
  return loads;
}

export function universeTotals(accounts: Account[]): Record<Axis, number> {
  const totals = emptyLoad();
  for (const account of accounts) {
    for (const axis of AXES) totals[axis] += AXIS_WEIGHT[axis](account);
  }
  return totals;
}

/**
 * Imbalance on an axis: how far the worst-loaded rep sits above an equal share.
 *
 *     I = (max_r load_r - ideal) / ideal        ideal = total / |reps|
 *
 * Max-side rather than max-minus-min for three reasons. It is always
 * non-negative, so a floor can be stated as a lower bound on it. Every bound in
 * lib/bounds bounds the *maximum* load, so it is directly certifiable against
 * this definition and nothing has to be translated. And it names the thing a rep
 * actually experiences: somebody is carrying too much.
 */
export function imbalanceOf(
  loads: Map<RepId, Record<Axis, number>>,
  totals: Record<Axis, number>,
  repCount: number,
): Record<Axis, number> {
  const result = emptyLoad();
  for (const axis of AXES) {
    const ideal = totals[axis] / repCount;
    if (ideal === 0) {
      result[axis] = 0;
      continue;
    }
    let max = 0;
    for (const load of loads.values()) max = Math.max(max, load[axis]);
    result[axis] = (max - ideal) / ideal;
  }
  return result;
}
