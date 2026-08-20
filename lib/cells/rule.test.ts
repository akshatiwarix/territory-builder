import { describe, expect, it } from "vitest";
import { requireUniverse } from "@/data";
import { GRANULARITY_LEVELS, type GranularityLevel } from "@/lib/domain";
import { Rng } from "@/lib/rng";
import { buildCells } from "./lattice";
import { evaluateRule, formatRule, renderRule } from "./rule";

const meridian = requireUniverse("meridian");

/**
 * Splits the occupied cells into `repCount` arbitrary-but-deterministic groups
 * and renders each as a rule. Arbitrary is the point: a round-trip that only
 * holds for tidy partitions is not a guarantee.
 */
function partitionAndRoundTrip(level: GranularityLevel, repCount: number, seed: number) {
  const cells = buildCells(meridian.accounts, level);
  const occupied = cells.map((c) => c.values);
  const rng = new Rng(seed);

  const groups: (typeof cells)[] = Array.from({ length: repCount }, () => []);
  for (const cell of cells) groups[rng.int(repCount)]!.push(cell);

  for (const group of groups) {
    const rule = renderRule({
      cellValues: group.map((c) => c.values),
      occupiedCellValues: occupied,
      level,
      plus: [],
      minus: [],
    });
    const expected = new Set(group.flatMap((c) => c.accountIds));
    const actual = evaluateRule(rule, meridian.accounts);
    expect([...actual].sort()).toEqual([...expected].sort());
  }
}

describe("the lattice", () => {
  it("builds only occupied cells, and more of them as granularity rises", () => {
    const counts = GRANULARITY_LEVELS.map(
      (level) => buildCells(meridian.accounts, level).length,
    );
    expect(counts).toEqual([8, 32, 96, 278]);
    for (const cells of GRANULARITY_LEVELS.map((l) => buildCells(meridian.accounts, l))) {
      expect(cells.every((c) => c.accountIds.length > 0)).toBe(true);
    }
  });

  it("partitions the universe exactly, at every level", () => {
    for (const level of GRANULARITY_LEVELS) {
      const cells = buildCells(meridian.accounts, level);
      const ids = cells.flatMap((c) => c.accountIds);
      expect(new Set(ids).size).toBe(meridian.accounts.length);
      expect(ids).toHaveLength(meridian.accounts.length);
    }
  });

  it("excludes exception accounts before weighing, not after", () => {
    const excluded = new Set(meridian.accounts.slice(0, 50).map((a) => a.id));
    const cells = buildCells(meridian.accounts, 3, excluded);
    const ids = new Set(cells.flatMap((c) => c.accountIds));
    for (const id of excluded) expect(ids.has(id)).toBe(false);

    // The weight has to leave with the account. A protected account's value is
    // not available to the optimizer, so leaving it in a cell would inflate
    // every bound computed from that cell.
    const potential = cells.reduce((s, c) => s + c.weight.potential, 0);
    const expected = meridian.accounts
      .filter((a) => !excluded.has(a.id))
      .reduce((s, a) => s + a.potentialUsd, 0);
    expect(potential).toBeCloseTo(expected, 6);
  });
});

describe("rule round-trip", () => {
  it("holds for arbitrary partitions at every granularity level", () => {
    for (const level of GRANULARITY_LEVELS) {
      partitionAndRoundTrip(level, 8, 4242 + level);
    }
  });

  it("holds for lopsided partitions, including a rep who owns everything", () => {
    const cells = buildCells(meridian.accounts, 2);
    const rule = renderRule({
      cellValues: cells.map((c) => c.values),
      occupiedCellValues: cells.map((c) => c.values),
      level: 2,
      plus: [],
      minus: [],
    });
    // Owning every occupied cell collapses all the way to a single wildcard.
    expect(rule.include).toEqual([{}]);
    expect(evaluateRule(rule, meridian.accounts).size).toBe(meridian.accounts.length);
  });

  it("holds when exceptions move accounts across rules", () => {
    const cells = buildCells(meridian.accounts, 3);
    const occupied = cells.map((c) => c.values);
    const mine = cells.filter((c) => c.values.industry === "SaaS");
    const theirs = cells.filter((c) => c.values.industry !== "SaaS");

    const stolen = theirs[0]!.accountIds[0]!;
    const surrendered = mine[0]!.accountIds[0]!;

    const rule = renderRule({
      cellValues: mine.map((c) => c.values),
      occupiedCellValues: occupied,
      level: 3,
      plus: [stolen],
      minus: [surrendered],
    });

    const actual = evaluateRule(rule, meridian.accounts);
    expect(actual.has(stolen)).toBe(true);
    expect(actual.has(surrendered)).toBe(false);

    const expected = new Set(mine.flatMap((c) => c.accountIds));
    expected.delete(surrendered);
    expected.add(stolen);
    expect([...actual].sort()).toEqual([...expected].sort());
  });
});

describe("rule collapse", () => {
  it("says Manufacturing once rather than four times", () => {
    const cells = buildCells(meridian.accounts, 2);
    const manufacturing = cells.filter((c) => c.values.industry === "Manufacturing");
    expect(manufacturing.length).toBe(4);

    const rule = renderRule({
      cellValues: manufacturing.map((c) => c.values),
      occupiedCellValues: cells.map((c) => c.values),
      level: 2,
      plus: [],
      minus: [],
    });

    expect(rule.include).toEqual([{ industry: "Manufacturing" }]);
    expect(formatRule(rule, 2)).toBe("Manufacturing");
  });

  it("refuses to widen when a value is missing", () => {
    const cells = buildCells(meridian.accounts, 2);
    const partial = cells.filter(
      (c) => c.values.industry === "Manufacturing" && c.values.region !== "International",
    );

    const rule = renderRule({
      cellValues: partial.map((c) => c.values),
      occupiedCellValues: cells.map((c) => c.values),
      level: 2,
      plus: [],
      minus: [],
    });

    expect(rule.include).toHaveLength(3);
    const ids = evaluateRule(rule, meridian.accounts);
    expect(
      meridian.accounts
        .filter((a) => ids.has(a.id))
        .every((a) => a.region !== "International"),
    ).toBe(true);
  });
});
