import { describe, expect, it } from "vitest";
import { requireUniverse } from "@/data";
import { defaultConfig, type Config } from "@/lib/domain";
import { planToCsv } from "./csv";
import { buildPlan } from "./optimize";
import { decodeConfig, encodeConfig } from "./permalink";

const meridian = requireUniverse("meridian");

describe("the permalink", () => {
  it("round-trips a config", () => {
    const config: Config = {
      ...defaultConfig("meridian"),
      granularity: 4,
      weights: { count: 3, potential: 1, pipeline: 0, churn: 7.5 },
      constraints: {
        pinned: { "acc-00001": "rep-04" },
        capacity: { min: 100, max: 400 },
        exclusions: [{ repId: "rep-02", dimension: "industry", value: "SaaS" }],
        protectStage: "commit",
      },
    };
    expect(decodeConfig(encodeConfig(config))).toEqual(config);
  });

  it("is URL-safe", () => {
    expect(encodeConfig(defaultConfig("meridian"))).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns null rather than a half-built config for anything unreadable", () => {
    expect(decodeConfig(null)).toBeNull();
    expect(decodeConfig("")).toBeNull();
    expect(decodeConfig("not-base64-$$$")).toBeNull();
    expect(decodeConfig(btoa("{}"))).toBeNull();
    expect(decodeConfig(btoa(JSON.stringify({ granularity: 9 })))).toBeNull();
  });

  it("carries the config and not the plan", () => {
    // If the plan travelled in the link it would become a second source of
    // truth that can disagree with the search. It does not travel.
    const encoded = encodeConfig(defaultConfig("meridian"));
    expect(atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))).not.toContain(
      "territories",
    );
  });
});

describe("the CSV", () => {
  it("carries every account, with what changed", () => {
    const result = buildPlan(meridian, defaultConfig("meridian"));
    if (result.kind !== "plan") throw new Error("infeasible");
    const csv = planToCsv(meridian, result.plan);
    const lines = csv.trim().split("\n");

    expect(lines).toHaveLength(meridian.accounts.length + 1);
    expect(lines[0]).toContain("proposed_owner_id");
    expect(lines[0]).toContain("moved");
    expect(lines[0]).toContain("exception_reason");

    const moved = lines.slice(1).filter((line) => line.includes(",true,"));
    expect(moved.length).toBe(result.plan.churn.accountsMoved);
  });

  it("escapes names that contain a comma or a quote", () => {
    const hostile = {
      ...meridian,
      accounts: meridian.accounts.map((account, index) =>
        index === 0 ? { ...account, name: 'Acme, "The" Corp' } : account,
      ),
    };
    const result = buildPlan(hostile, defaultConfig("meridian"));
    if (result.kind !== "plan") throw new Error("infeasible");
    expect(planToCsv(hostile, result.plan)).toContain('"Acme, ""The"" Corp"');
  });
});
