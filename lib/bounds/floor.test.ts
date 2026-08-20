import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { requireUniverse } from "@/data";
import { defaultConfig, GRANULARITY_LEVELS, type Config } from "@/lib/domain";
import { prepare, type Preparation } from "@/lib/setup";
import { computeFloor, floorOf } from "./floor";

const meridian = requireUniverse("meridian");
const northwind = requireUniverse("northwind");

function prepared(config: Config, universe = meridian): Preparation {
  const result = prepare(universe, config);
  if (result.kind === "infeasible") throw new Error(result.detail);
  return result;
}

const plain = (over: Partial<Config> = {}): Config => ({
  ...defaultConfig("meridian"),
  constraints: {
    pinned: {},
    capacity: null,
    exclusions: [],
    protectStage: null,
  },
  ...over,
});

describe("the architectural rule", () => {
  it("keeps lib/bounds free of any import from lib/optimize", () => {
    // Stated in PLAN.md and in CLAUDE.md; asserted here so it survives contact
    // with a future refactor. A bound that can see the search is a result.
    for (const file of readdirSync("lib/bounds")) {
      const source = readFileSync(`lib/bounds/${file}`, "utf8");
      expect(source).not.toMatch(/from ["']@\/lib\/optimize/);
    }
  });
});

describe("each bound, on a case computed by hand", () => {
  it("ideal is the mean", () => {
    const prep = prepared(plain({ granularity: 4 }));
    const bounds = floorOf(prep, prep.config);
    const total = meridian.accounts.reduce((s, a) => s + a.potentialUsd, 0);
    expect(bounds.potential.ideal).toBeCloseTo(total / 8, 6);
  });

  it("cell is the largest indivisible block", () => {
    const prep = prepared(plain({ granularity: 3 }));
    const bounds = floorOf(prep, prep.config);
    const largest = Math.max(...prep.cells.map((c) => c.weight.potential));
    // No exceptions in this config, so no rep carries committed load and the
    // bound is exactly the largest cell.
    expect(bounds.potential.bounds.cell).toBeCloseTo(largest, 6);
    expect(bounds.potential.binding).toBe("cell");
  });

  it("pair is the m-th plus the (m+1)-th largest cell", () => {
    const prep = prepared(plain({ granularity: 3 }));
    const bounds = floorOf(prep, prep.config);
    const sorted = prep.cells.map((c) => c.weight.potential).sort((a, b) => b - a);
    expect(bounds.potential.bounds.pair).toBeCloseTo(sorted[7]! + sorted[8]!, 6);
  });

  it("pair is inert when there are no more cells than reps", () => {
    const prep = prepared(plain({ granularity: 1 }));
    const bounds = floorOf(prep, prep.config);
    expect(prep.cells).toHaveLength(8);
    expect(bounds.potential.bounds.pair).toBe(0);
  });

  it("forced picks up a rep's committed load from protection", () => {
    const prep = prepared(plain({ constraints: { pinned: {}, capacity: null, exclusions: [], protectStage: "negotiation" } }));
    const bounds = floorOf(prep, prep.config);
    const worst = Math.max(...[...prep.committed.values()].map((l) => l.pipeline));
    expect(bounds.pipeline.bounds.forced).toBeGreaterThanOrEqual(worst);
    expect(worst).toBeGreaterThan(0);
  });

  it("forced picks up a capacity cap on the count axis", () => {
    const config = plain({
      constraints: { pinned: {}, capacity: { min: 0, max: 300 }, exclusions: [], protectStage: null },
    });
    const prep = prepared(config);
    const bounds = floorOf(prep, prep.config);
    // 2000 accounts, seven reps capped at 300 absorb 2100 — so the cap is not
    // binding here, and the bound must not pretend otherwise.
    expect(bounds.count.bounds.forced).toBeLessThanOrEqual(bounds.count.ideal);
  });

  it("forced binds when an eligibility rule restricts a large segment", () => {
    const excluded = meridian.reps.slice(4).map((rep) => ({
      repId: rep.id,
      dimension: "segment" as const,
      value: "Enterprise",
    }));
    const config = plain({
      granularity: 3,
      constraints: { pinned: {}, capacity: null, exclusions: excluded, protectStage: null },
    });
    const prep = prepared(config);
    const bounds = floorOf(prep, prep.config);

    // Enterprise carries two-thirds of all potential; letting only half the
    // floor touch it forces a residual no carve can escape.
    expect(bounds.potential.binding).toBe("forced");
    expect(bounds.potential.floor).toBeGreaterThan(0.3);
  });
});

describe("THE WHALE and THE GRANULARITY TRAP", () => {
  it("falls as the lattice refines, and never rises", () => {
    const floors = GRANULARITY_LEVELS.map((granularity) => {
      const prep = prepared(plain({ granularity }));
      return floorOf(prep, prep.config).potential.floor;
    });

    for (let i = 1; i < floors.length; i++) {
      expect(floors[i]!).toBeLessThanOrEqual(floors[i - 1]! + 1e-9);
    }
    // Readable rules at level 1 cost more than a hundred points of imbalance
    // that no optimizer can recover. That is the trap.
    expect(floors[0]!).toBeGreaterThan(1.0);
    expect(floors[3]!).toBeLessThan(0.05);
  });

  it("is driven by one indivisible cell at the default granularity", () => {
    const prep = prepared(plain({ granularity: 3 }));
    const bounds = floorOf(prep, prep.config);
    expect(bounds.potential.binding).toBe("cell");
    expect(bounds.potential.floor).toBeGreaterThan(0.2);
  });
});

describe("THE PROTECTED BOOK", () => {
  it("keeps a floor under pipeline that refining the lattice cannot remove", () => {
    const withProtection = GRANULARITY_LEVELS.map((granularity) => {
      const prep = prepared(
        plain({
          granularity,
          constraints: { pinned: {}, capacity: null, exclusions: [], protectStage: "negotiation" },
        }),
      );
      return floorOf(prep, prep.config).pipeline.floor;
    });

    // The curve stops falling: past a point the residual is no longer the
    // universe's lumpiness, it is the protection rule, and no amount of
    // refinement touches it.
    expect(withProtection[3]!).toBeGreaterThan(0.4);
    expect(
      prepared(
        plain({
          granularity: 4,
          constraints: { pinned: {}, capacity: null, exclusions: [], protectStage: "negotiation" },
        }),
      ),
    ).toBeTruthy();
  });

  it("is charged to protection by the cost attribution, by name", () => {
    const config = plain({
      granularity: 4,
      constraints: { pinned: {}, capacity: null, exclusions: [], protectStage: "negotiation" },
    });
    const prep = prepared(config);
    const floor = computeFloor(meridian, prep);
    const protection = floor.costs.find((c) => c.constraint === "protectStage")!;

    expect(protection.active).toBe(true);
    expect(protection.cost.pipeline).toBeGreaterThan(0.3);
    expect(protection.floorWithout.pipeline).toBeLessThan(protection.floorWith.pipeline);
  });

  it("charges nothing to a constraint the universe was already forcing", () => {
    // At level 1 the lattice alone forces a huge pipeline residual, so
    // protection is free there. Billing it anyway would be arithmetic theatre.
    const config = plain({
      granularity: 1,
      constraints: { pinned: {}, capacity: null, exclusions: [], protectStage: "negotiation" },
    });
    const prep = prepared(config);
    const floor = computeFloor(meridian, prep);
    const protection = floor.costs.find((c) => c.constraint === "protectStage")!;
    expect(protection.cost.pipeline).toBe(0);
  });
});

describe("THE FREE BALANCE", () => {
  it("reports a floor of zero on a universe with no lumps", () => {
    const config: Config = {
      ...plain({ granularity: 3 }),
      universeId: "northwind",
    };
    const prep = prepared(config, northwind);
    const bounds = floorOf(prep, prep.config);
    for (const axis of ["count", "potential", "pipeline"] as const) {
      expect(bounds[axis].floor).toBe(0);
      expect(bounds[axis].binding).toBe("ideal");
    }
  });
});
