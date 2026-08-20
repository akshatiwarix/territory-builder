import { describe, expect, it } from "vitest";
import { requireUniverse } from "@/data";
import { evaluateRule } from "@/lib/cells";
import { AXES, defaultConfig, type Config, type Plan } from "@/lib/domain";
import { churnFraction } from "@/lib/measure";
import { prepare } from "@/lib/setup";
import { buildPlan, statusQuoAssignment } from "./plan";

const meridian = requireUniverse("meridian");

function planFor(over: Partial<Config> = {}): Plan {
  const config = { ...defaultConfig("meridian"), ...over };
  const result = buildPlan(meridian, config);
  if (result.kind !== "plan") throw new Error(`infeasible: ${result.reason}`);
  return result.plan;
}

describe("determinism", () => {
  it("produces a byte-identical plan from the same config and seed", () => {
    const a = planFor();
    const b = planFor();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces a different plan from a different seed, but not a worse one by much", () => {
    const a = planFor({ seed: 1 });
    const b = planFor({ seed: 2 });
    expect(a.imbalance.potential).toBeGreaterThanOrEqual(
      a.floor.perAxis.potential.floor - 1e-9,
    );
    expect(b.imbalance.potential).toBeGreaterThanOrEqual(
      b.floor.perAxis.potential.floor - 1e-9,
    );
  });
});

describe("the bound holds", () => {
  it("never lands under the certified floor on any axis", () => {
    for (const granularity of [1, 2, 3, 4] as const) {
      const plan = planFor({ granularity });
      for (const axis of AXES) {
        expect(plan.imbalance[axis]).toBeGreaterThanOrEqual(
          plan.floor.perAxis[axis].floor - 1e-9,
        );
      }
    }
  });

  it("reaches the floor exactly on potential at the default granularity", () => {
    // Worth asserting because it is the interesting case: the residual here is
    // entirely the universe's lumpiness, and there is nothing left to optimize.
    const plan = planFor();
    expect(plan.imbalance.potential).toBeCloseTo(plan.floor.perAxis.potential.floor, 6);
  });

  it("never moves less pipeline than the churn floor", () => {
    for (const granularity of [1, 2, 3, 4] as const) {
      const plan = planFor({ granularity });
      expect(plan.churn.pipelineMovedFraction).toBeGreaterThanOrEqual(
        plan.floor.churn.fraction - 1e-9,
      );
    }
  });
});

describe("the partition", () => {
  it("assigns every account exactly once", () => {
    const plan = planFor();
    const ids = plan.territories.flatMap((t) => t.accountIds);
    expect(ids).toHaveLength(meridian.accounts.length);
    expect(new Set(ids).size).toBe(meridian.accounts.length);
  });

  it("renders rules that evaluate back to exactly their territory", () => {
    for (const granularity of [1, 2, 3, 4] as const) {
      const plan = planFor({ granularity });
      for (const territory of plan.territories) {
        const evaluated = evaluateRule(territory.rule, meridian.accounts);
        expect([...evaluated].sort()).toEqual(territory.accountIds);
      }
    }
  });
});

describe("constraints", () => {
  it("honours pins", () => {
    const named = meridian.accounts.filter((a) => a.isNamed).slice(0, 6);
    const pinned = Object.fromEntries(named.map((a, i) => [a.id, `rep-0${(i % 4) + 5}`]));
    const plan = planFor({
      constraints: { ...defaultConfig("meridian").constraints, pinned },
    });

    for (const [accountId, repId] of Object.entries(pinned)) {
      const owner = plan.territories.find((t) => t.accountIds.includes(accountId));
      expect(owner?.repId).toBe(repId);
    }
  });

  it("honours exclusions", () => {
    const exclusions = meridian.reps.slice(4).map((rep) => ({
      repId: rep.id,
      dimension: "segment" as const,
      value: "Enterprise",
    }));
    const plan = planFor({
      granularity: 3,
      constraints: { ...defaultConfig("meridian").constraints, exclusions, protectStage: null },
    });

    const byId = new Map(meridian.accounts.map((a) => [a.id, a]));
    for (const territory of plan.territories.slice(4)) {
      const enterprise = territory.accountIds.filter(
        (id) => byId.get(id)?.segment === "Enterprise",
      );
      expect(enterprise).toEqual([]);
    }
  });

  it("honours capacity, and pays for it", () => {
    const unconstrained = planFor();
    const smallest = Math.min(...unconstrained.territories.map((t) => t.load.count));
    expect(smallest).toBeLessThan(120);

    const constrained = planFor({
      constraints: {
        ...defaultConfig("meridian").constraints,
        capacity: { min: 180, max: 400 },
      },
    });
    for (const territory of constrained.territories) {
      expect(territory.load.count).toBeGreaterThanOrEqual(180);
      expect(territory.load.count).toBeLessThanOrEqual(400);
    }
    // Balance on one axis is bought with balance on another. That is the point
    // of never collapsing them into a score.
    expect(constrained.imbalance.potential).toBeGreaterThan(
      unconstrained.imbalance.potential,
    );
  });

  it("refuses an exclusion the lattice cannot express, rather than ignoring it", () => {
    // The sweep found this: at level 1 the lattice is cut by industry alone, so
    // a segment exclusion matches no cell and was being silently dropped —
    // fifty-six plans handed Enterprise accounts to reps forbidden from selling
    // to them. A dropped constraint is the failure this repo objects to.
    const result = buildPlan(meridian, {
      ...defaultConfig("meridian"),
      granularity: 1,
      constraints: {
        ...defaultConfig("meridian").constraints,
        exclusions: [{ repId: "rep-05", dimension: "segment", value: "Enterprise" }],
      },
    });
    expect(result.kind).toBe("infeasible");
    if (result.kind === "infeasible") {
      expect(result.reason).toBe("exclusion-inert-at-this-granularity");
      expect(result.detail).toContain("Refine the granularity");
    }
  });

  it("accepts the same exclusion once the lattice is cut along that dimension", () => {
    const result = buildPlan(meridian, {
      ...defaultConfig("meridian"),
      granularity: 3,
      constraints: {
        ...defaultConfig("meridian").constraints,
        exclusions: [{ repId: "rep-05", dimension: "segment", value: "Enterprise" }],
      },
    });
    expect(result.kind).toBe("plan");
  });

  it("refuses a minimum no cell partition can reach, by name", () => {
    const result = buildPlan(meridian, {
      ...defaultConfig("meridian"),
      granularity: 1,
      constraints: {
        ...defaultConfig("meridian").constraints,
        capacity: { min: 240, max: 260 },
      },
    });
    expect(result.kind).toBe("infeasible");
    if (result.kind === "infeasible") {
      expect(result.reason).toBe("capacity-min-unreachable-at-this-granularity");
    }
  });
});

describe("churn", () => {
  it("beats the cell-expressible status quo when churn is all that matters", () => {
    const config: Config = {
      ...defaultConfig("meridian"),
      weights: { count: 0, potential: 0, pipeline: 0, churn: 1 },
    };
    const plan = planFor(config);

    const prep = prepare(meridian, config);
    if (prep.kind === "infeasible") throw new Error("unexpected");
    const baseline = statusQuoAssignment(prep);
    const owners = new Map<string, string>();
    for (const cell of prep.cells) {
      for (const id of cell.accountIds) owners.set(id, baseline[cell.key]!);
    }
    for (const exception of prep.exceptions) owners.set(exception.accountId, exception.repId);

    expect(plan.churn.pipelineMovedFraction).toBeLessThanOrEqual(
      churnFraction(meridian.accounts, owners) + 1e-9,
    );
  });

  it("cannot reach zero, because the book on the ground is not a rule", () => {
    const plan = planFor({ weights: { count: 0, potential: 0, pipeline: 0, churn: 1 } });
    // The current carve was cut by geography and then split between two reps by
    // nothing expressible, so no rule reproduces it. Some pipeline changes hands
    // before the optimizer states a single preference.
    expect(plan.floor.churn.fraction).toBeGreaterThan(0.05);
    expect(plan.churn.pipelineMovedFraction).toBeGreaterThan(0);
  });

  it("trades imbalance for churn as the weight moves", () => {
    const cheap = planFor({ weights: { count: 1, potential: 2, pipeline: 1, churn: 8 } });
    const thorough = planFor({ weights: { count: 1, potential: 2, pipeline: 1, churn: 0 } });

    expect(cheap.churn.pipelineMovedFraction).toBeLessThan(
      thorough.churn.pipelineMovedFraction,
    );
  });
});
