import { describe, expect, it } from "vitest";
import { artifactFor } from "@/data/artifacts";
import { requireUniverse } from "@/data";
import { defaultConfig, GRANULARITY_LEVELS } from "@/lib/domain";
import { buildPlan } from "@/lib/optimize";
import { randomBaseline } from "./baseline";
import { weightGrid } from "./frontier";
import { analyseStability } from "./stability";

const meridian = requireUniverse("meridian");
const northwind = requireUniverse("northwind");

describe("the frontier", () => {
  it("sweeps a fixed grid of thirty-two vectors", () => {
    expect(weightGrid()).toHaveLength(32);
  });

  it("marks domination correctly in the committed artifacts", () => {
    for (const universeId of ["meridian", "northwind"]) {
      for (const granularity of GRANULARITY_LEVELS) {
        const points = artifactFor(universeId, granularity)!.frontier.points;
        const dims = (p: (typeof points)[number]) => [
          p.imbalance.count,
          p.imbalance.potential,
          p.imbalance.pipeline,
          p.churnPipelineFraction,
        ];

        for (const point of points.filter((p) => !p.dominated)) {
          for (const other of points) {
            if (other === point) continue;
            const a = dims(other);
            const b = dims(point);
            const dominates =
              a.every((v, i) => v <= b[i]! + 1e-12) && a.some((v, i) => v < b[i]! - 1e-9);
            expect(dominates).toBe(false);
          }
        }
      }
    }
  });

  it("shows the tradeoff it exists to show", () => {
    const points = artifactFor("meridian", 3)!.frontier.points;
    const cheap = points.filter((p) => p.weights.churn >= 8);
    const thorough = points.filter((p) => p.weights.churn === 0);

    const minChurn = Math.min(...cheap.map((p) => p.churnPipelineFraction));
    const maxChurn = Math.max(...thorough.map((p) => p.churnPipelineFraction));
    expect(minChurn).toBeLessThan(maxChurn);
  });
});

describe("stability", () => {
  it("is deterministic", () => {
    const config = { ...defaultConfig("northwind"), granularity: 1 as const };
    const result = buildPlan(northwind, config);
    if (result.kind !== "plan") throw new Error("infeasible");

    const a = analyseStability(northwind, config, result.plan);
    const b = analyseStability(northwind, config, result.plan);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("reports the number that undermines the plan on screen", () => {
    // The headline result of this build. At the default granularity, wobbling
    // the potential estimates inside their own stated error bands reshuffles
    // most of the book — the plan is a sample, not a decision.
    const stability = artifactFor("meridian", 3)!.stability;
    expect(stability.ownerRetention).toBeLessThan(0.6);
    expect(stability.draws.stability).toBe(64);
  });

  it("finds coarse lattices more stable precisely because they are worse", () => {
    const coarse = artifactFor("meridian", 1)!.stability.ownerRetention;
    const fine = artifactFor("meridian", 4)!.stability.ownerRetention;
    expect(coarse).toBeGreaterThan(fine);

    // Eight cells and eight reps leave nothing to be uncertain about, and the
    // plan is correspondingly useless: 107% imbalance, forced by the lattice.
    expect(coarse).toBeGreaterThan(0.95);
  });

  it("widens the imbalance claim into an interval", () => {
    const stability = artifactFor("meridian", 3)!.stability;
    expect(stability.potentialImbalance.p95).toBeGreaterThan(
      stability.potentialImbalance.p5,
    );
  });
});

describe("the random baseline", () => {
  it("shows that hitting the target took work on a hard universe", () => {
    const config = defaultConfig("meridian");
    const baseline = randomBaseline(meridian, config);
    const result = buildPlan(meridian, config);
    if (result.kind !== "plan") throw new Error("infeasible");

    expect(baseline.medianPotentialImbalance).toBeGreaterThan(
      result.plan.imbalance.potential * 5,
    );
  });

  it("and that on the easy universe the target itself was free", () => {
    // THE FREE BALANCE. Not that any carve works — random carves are bad
    // everywhere — but that the floor is zero, so hitting a target says nothing
    // about the universe, and the plan that hits it is correspondingly
    // arbitrary: three accounts in ten keep their owner when it is re-run.
    const result = buildPlan(northwind, defaultConfig("northwind"));
    if (result.kind !== "plan") throw new Error("infeasible");
    expect(result.plan.floor.perAxis.potential.floor).toBe(0);

    const stability = artifactFor("northwind", 3)!.stability;
    expect(stability.ownerRetention).toBeLessThan(0.5);
  });
});
