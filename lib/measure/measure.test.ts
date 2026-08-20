import { describe, expect, it } from "vitest";
import { requireUniverse } from "@/data";
import { buildCells } from "@/lib/cells";
import type { Account, Rep } from "@/lib/domain";
import { computeChurn, churnFraction, equityOf } from "./churn";
import { imbalanceOf, repLoads, resolveOwners, universeTotals } from "./loads";

const meridian = requireUniverse("meridian");

const reps: Rep[] = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
];

function account(over: Partial<Account>): Account {
  return {
    id: "acc-1",
    name: "Test",
    industry: "SaaS",
    region: "West",
    segment: "SMB",
    employeeBand: "1-50",
    potentialUsd: 100,
    potentialBand: 0.1,
    openPipelineUsd: 0,
    openOppStage: null,
    currentOwnerId: "a",
    tenureDays: 365,
    lastActivityDays: 10,
    isNamed: false,
    ...over,
  };
}

describe("imbalance", () => {
  it("is the worst rep's overshoot of an equal share", () => {
    const accounts = [
      account({ id: "1", potentialUsd: 300, currentOwnerId: "a" }),
      account({ id: "2", potentialUsd: 100, currentOwnerId: "b" }),
    ];
    const owners = new Map([
      ["1", "a"],
      ["2", "b"],
    ]);
    const loads = repLoads(accounts, owners, reps);
    const result = imbalanceOf(loads, universeTotals(accounts), reps.length);

    // ideal = 200, max = 300 => 50% over.
    expect(result.potential).toBeCloseTo(0.5, 10);
    expect(result.count).toBeCloseTo(0, 10);
  });

  it("is zero for a perfect split and never negative", () => {
    const accounts = [
      account({ id: "1", potentialUsd: 200, currentOwnerId: "a" }),
      account({ id: "2", potentialUsd: 200, currentOwnerId: "b" }),
    ];
    const owners = new Map([
      ["1", "a"],
      ["2", "b"],
    ]);
    const result = imbalanceOf(
      repLoads(accounts, owners, reps),
      universeTotals(accounts),
      reps.length,
    );
    expect(result.potential).toBeCloseTo(0, 10);
  });

  it("treats an empty axis as balanced rather than dividing by zero", () => {
    const accounts = [account({ id: "1", openPipelineUsd: 0 })];
    const owners = new Map([["1", "a"]]);
    const result = imbalanceOf(
      repLoads(accounts, owners, reps),
      universeTotals(accounts),
      reps.length,
    );
    expect(result.pipeline).toBe(0);
  });
});

describe("ownership resolution", () => {
  it("lets exceptions override the cell, and nothing else", () => {
    const cells = buildCells(meridian.accounts, 2);
    const assignment: Record<string, string> = {};
    for (const [index, cell] of cells.entries()) {
      assignment[cell.key] = index % 2 === 0 ? "a" : "b";
    }
    const stolen = cells[0]!.accountIds[0]!;
    const owners = resolveOwners(cells, assignment, [
      { accountId: stolen, repId: "b", reason: "pinned" },
    ]);

    expect(owners.get(stolen)).toBe("b");
    expect(owners.size).toBe(meridian.accounts.length);
  });
});

describe("churn", () => {
  it("prices a live negotiation above four hundred dormant accounts", () => {
    const live = account({
      id: "live",
      openPipelineUsd: 400_000,
      tenureDays: 900,
      lastActivityDays: 5,
    });
    const dormant = Array.from({ length: 400 }, (_, i) =>
      account({ id: `d${i}`, openPipelineUsd: 0, lastActivityDays: 400 }),
    );

    const movedLive = computeChurn(
      [live, ...dormant],
      new Map([["live", "b"], ...dormant.map((d) => [d.id, "a"] as const)]),
      new Set(),
    );
    const movedDormant = computeChurn(
      [live, ...dormant],
      new Map([["live", "a"], ...dormant.map((d) => [d.id, "b"] as const)]),
      new Set(),
    );

    // The count metric says the second plan is 400x worse. The metric this tool
    // leads with says the first one is the expensive one, and it is right.
    expect(movedDormant.accountsMoved).toBeGreaterThan(movedLive.accountsMoved);
    expect(movedLive.pipelineMovedUsd).toBeGreaterThan(movedDormant.pipelineMovedUsd);
    expect(movedDormant.pipelineMovedUsd).toBe(0);
  });

  it("weighs a long, recently-worked relationship above a cold new one", () => {
    const established = account({ tenureDays: 900, lastActivityDays: 5, openPipelineUsd: 1000 });
    const cold = account({ tenureDays: 40, lastActivityDays: 300, openPipelineUsd: 1000 });
    expect(equityOf(established)).toBeGreaterThan(equityOf(cold) * 4);
  });

  it("is zero when nothing moves", () => {
    const owners = new Map(meridian.accounts.map((a) => [a.id, a.currentOwnerId]));
    const churn = computeChurn(meridian.accounts, owners, new Set());
    expect(churn.accountsMoved).toBe(0);
    expect(churn.pipelineMovedUsd).toBe(0);
    expect(churnFraction(meridian.accounts, owners)).toBe(0);
  });

  it("is total when everything moves", () => {
    const other = (id: string) => (id === "rep-01" ? "rep-02" : "rep-01");
    const owners = new Map(
      meridian.accounts.map((a) => [a.id, other(a.currentOwnerId)]),
    );
    const churn = computeChurn(meridian.accounts, owners, new Set());
    expect(churn.accountsMoved).toBe(meridian.accounts.length);
    expect(churn.pipelineMovedFraction).toBeCloseTo(1, 10);
  });
});
