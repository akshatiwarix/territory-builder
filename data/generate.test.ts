import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { generateAll, generateUniverse, UNIVERSE_SPECS } from "./generate";
import { listUniverses, requireUniverse } from "./index";
import type { Account } from "@/lib/domain";

const meridian = requireUniverse("meridian");
const northwind = requireUniverse("northwind");

const sum = (accounts: Account[], f: (a: Account) => number) =>
  accounts.reduce((total, a) => total + f(a), 0);

const potential = (accounts: Account[]) => sum(accounts, (a) => a.potentialUsd);
const pipeline = (accounts: Account[]) => sum(accounts, (a) => a.openPipelineUsd);

const isProtected = (a: Account) =>
  a.openOppStage === "negotiation" || a.openOppStage === "commit";

describe("the committed corpus", () => {
  it("is byte-identical to what the generator produces", () => {
    // The seed claim is only worth something if it is checked. Without this,
    // "regenerate from a fixed seed" degrades into "there is a file".
    for (const universe of generateAll()) {
      const committed = readFileSync(`data/universes/${universe.id}.json`, "utf8");
      expect(JSON.stringify(universe) + "\n").toBe(committed);
    }
  });

  it("generates identically twice", () => {
    const spec = UNIVERSE_SPECS[0]!;
    expect(JSON.stringify(generateUniverse(spec))).toBe(
      JSON.stringify(generateUniverse(spec)),
    );
  });

  it("passes its own schema on load", () => {
    expect(listUniverses().map((u) => u.id)).toEqual(["meridian", "northwind"]);
    expect(meridian.accounts).toHaveLength(2000);
    expect(meridian.reps).toHaveLength(8);
  });
});

describe("THE WHALE", () => {
  it("puts one cell above any rep's fair share of potential", () => {
    const cell = meridian.accounts.filter(
      (a) =>
        a.industry === "SaaS" && a.region === "West" && a.segment === "Enterprise",
    );
    const share = potential(cell) / potential(meridian.accounts);
    const fairShare = 1 / meridian.reps.length;

    expect(share).toBeGreaterThan(0.15);
    // This is the whole pathology: one indivisible cell is bigger than the
    // largest book any perfectly balanced plan would hand out.
    expect(share).toBeGreaterThan(fairShare);
  });
});

describe("THE LEGACY CARVE", () => {
  it("is geographic — every rep's book sits in exactly one region", () => {
    const regionsPerRep = new Map<string, Set<string>>();
    for (const a of meridian.accounts) {
      const set = regionsPerRep.get(a.currentOwnerId) ?? new Set<string>();
      set.add(a.region);
      regionsPerRep.set(a.currentOwnerId, set);
    }
    for (const [, regions] of regionsPerRep) expect(regions.size).toBe(1);
  });

  it("is badly imbalanced, so balance is available but has to be bought", () => {
    const byRep = new Map<string, number>();
    for (const a of meridian.accounts) {
      byRep.set(a.currentOwnerId, (byRep.get(a.currentOwnerId) ?? 0) + a.potentialUsd);
    }
    const ideal = potential(meridian.accounts) / meridian.reps.length;
    const imbalance = (Math.max(...byRep.values()) - ideal) / ideal;
    expect(imbalance).toBeGreaterThan(1.0);
  });
});

describe("THE PROTECTED BOOK", () => {
  it("concentrates in-flight pipeline on a single rep", () => {
    const held = meridian.accounts.filter(
      (a) => isProtected(a) && a.currentOwnerId === "rep-03",
    );
    const share = pipeline(held) / pipeline(meridian.accounts);
    const fairShare = 1 / meridian.reps.length;

    expect(share).toBeGreaterThan(0.18);
    // Three times a fair share, locked in place before the optimizer starts.
    expect(share).toBeGreaterThan(fairShare * 1.4);
  });

  it("does not overlap the whale, so the two floors stay separable", () => {
    const held = meridian.accounts.filter((a) => isProtected(a) && a.currentOwnerId === "rep-03");
    expect(held.every((a) => a.region !== "West")).toBe(true);
  });
});

describe("THE NOISY PROXY", () => {
  it("puts the wide estimate bands where coverage is worst, not where value is small", () => {
    const mean = (region: string) => {
      const rows = meridian.accounts.filter((a) => a.region === region);
      return sum(rows, (a) => a.potentialBand) / rows.length;
    };
    expect(mean("International")).toBeGreaterThan(0.45);
    for (const region of ["West", "Central", "East"]) {
      expect(mean(region)).toBeLessThan(0.25);
    }

    // And the noisy region carries real value, so the noise reaches the claim
    // instead of hiding harmlessly in the tail.
    const intl = meridian.accounts.filter((a) => a.region === "International");
    expect(potential(intl) / potential(meridian.accounts)).toBeGreaterThan(0.1);
  });
});

describe("THE REDUNDANT DIMENSION", () => {
  it("makes employee band nearly determined by segment", () => {
    const expected: Record<string, string[]> = {
      SMB: ["1-50", "51-200"],
      "Mid-Market": ["51-200", "201-1000", "1001-5000"],
      Enterprise: ["1001-5000", "5000+"],
    };
    const consistent = meridian.accounts.filter((a) =>
      expected[a.segment]!.includes(a.employeeBand),
    ).length;
    const rate = consistent / meridian.accounts.length;

    expect(rate).toBeGreaterThan(0.92);
    // Near-collinear, not identical. A perfectly determined dimension would be a
    // bug in the generator rather than a fact about the universe.
    expect(rate).toBeLessThan(0.995);
  });
});

describe("THE EXCLUDED REP", () => {
  it("leaves enough value inside one segment for an eligibility rule to bind", () => {
    const enterprise = meridian.accounts.filter((a) => a.segment === "Enterprise");
    // Restricting Enterprise to half the floor only forces a residual if
    // Enterprise carries well over half the potential. It does.
    expect(potential(enterprise) / potential(meridian.accounts)).toBeGreaterThan(0.6);
  });
});

describe("THE FREE BALANCE", () => {
  it("has no whale and no geographic carve", () => {
    const cells = new Map<string, number>();
    for (const a of northwind.accounts) {
      const key = `${a.industry}|${a.region}|${a.segment}`;
      cells.set(key, (cells.get(key) ?? 0) + a.potentialUsd);
    }
    const ideal = potential(northwind.accounts) / northwind.reps.length;
    expect(Math.max(...cells.values())).toBeLessThan(ideal);

    const regionsPerRep = new Map<string, Set<string>>();
    for (const a of northwind.accounts) {
      const set = regionsPerRep.get(a.currentOwnerId) ?? new Set<string>();
      set.add(a.region);
      regionsPerRep.set(a.currentOwnerId, set);
    }
    for (const [, regions] of regionsPerRep) expect(regions.size).toBeGreaterThan(1);
  });
});
