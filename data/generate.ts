/**
 * Corpus generation.
 *
 * The universes here are synthetic, seeded and committed. That is a deliberate
 * choice, argued in PLAN.md: every claim this tool makes is about the *shape* of
 * an account universe — lumpiness, forced residual, estimate sensitivity — and
 * shape is not something a scrape would teach a reader more about. It would only
 * add third-party claims that can be wrong.
 *
 * Structure is planted in explicit, named passes rather than hoped for from a
 * distribution. Each pass corresponds to one pathology, each pathology is
 * asserted by a test, and a change that quietly flattens one fails the suite
 * instead of silently weakening every demo in the README.
 */
import {
  EMPLOYEE_BANDS,
  INDUSTRIES,
  REGIONS,
  SEGMENTS,
  type Account,
  type EmployeeBand,
  type Industry,
  type Region,
  type Rep,
  type Segment,
  type Stage,
  type Universe,
} from "@/lib/domain";
import { Rng, derive } from "@/lib/rng";

/* ------------------------------------------------------------------ *
 * Tunables. Every number below was set by measuring, not by taste; the
 * measured consequences are asserted in generate.test.ts.
 * ------------------------------------------------------------------ */

const INDUSTRY_WEIGHTS = [0.2, 0.15, 0.13, 0.12, 0.12, 0.11, 0.09, 0.08];
const REGION_WEIGHTS = [0.34, 0.26, 0.28, 0.12];
const SEGMENT_WEIGHTS = [0.52, 0.34, 0.14];

/** Median potential by segment, before lognormal spread. */
const POTENTIAL_MEDIAN: Record<Segment, number> = {
  SMB: 12_000,
  "Mid-Market": 78_000,
  Enterprise: 340_000,
};
const POTENTIAL_SIGMA: Record<Segment, number> = {
  SMB: 0.55,
  "Mid-Market": 0.5,
  Enterprise: 0.62,
};

/**
 * `THE REDUNDANT DIMENSION`. Employee band is drawn from segment with high
 * fidelity, so level 4 multiplies the cell count without buying a meaningfully
 * different carve. The 8% defiance rate is what keeps them merely near-collinear
 * rather than identical — a perfectly determined dimension would be a bug in the
 * corpus rather than a finding about the universe.
 */
const BAND_DEFIANCE = 0.08;
const BAND_BY_SEGMENT: Record<Segment, Array<[EmployeeBand, number]>> = {
  SMB: [
    ["1-50", 0.72],
    ["51-200", 0.28],
  ],
  "Mid-Market": [
    ["51-200", 0.34],
    ["201-1000", 0.56],
    ["1001-5000", 0.1],
  ],
  Enterprise: [
    ["1001-5000", 0.56],
    ["5000+", 0.44],
  ],
};

/**
 * `THE NOISY PROXY`. The estimate band is a property of *coverage*, not of size:
 * the vendor knows least about International, so that is where the error lives.
 * This is the uncomfortable version of the pathology — the noisy region also
 * contains real enterprise value, so the noise moves the balance claim instead
 * of hiding harmlessly in the tail.
 */
const BAND_BY_REGION: Record<Region, [number, number]> = {
  West: [0.08, 0.2],
  Central: [0.1, 0.22],
  East: [0.09, 0.21],
  International: [0.4, 0.6],
};

const OPEN_OPP_RATE = 0.22;
const STAGE_WEIGHTS: Array<[Stage, number]> = [
  ["discovery", 0.42],
  ["evaluation", 0.3],
  ["negotiation", 0.19],
  ["commit", 0.09],
];

/** `THE WHALE` — target share of total potential for one single cell. */
const WHALE_CELL = { industry: "SaaS", region: "West", segment: "Enterprise" } as const;
const WHALE_TARGET_SHARE = 0.155;

/**
 * `THE PROTECTED BOOK` — one rep, mid-quarter, holding a share of all in-flight
 * pipeline far above their fair share.
 *
 * Deliberately targeted on the *pipeline* axis rather than potential. Protection
 * lifts accounts out of the cell lattice as exceptions, so protecting the whale's
 * members would deflate the whale and tangle two pathologies into one number.
 * Late-stage deals are pipeline by definition, so this is also the honest place
 * for the constraint to bite.
 */
const PROTECTED_REP = "rep-03";
const PROTECTED_PIPELINE_SHARE = 0.18;
const PROTECTED_ACCOUNT_CAP = 40;

const NAMED_ACCOUNT_COUNT = 24;

/* ------------------------------------------------------------------ */

const COMPANY_STEMS = [
  "Northgate", "Vertex", "Halcyon", "Ironwood", "Bluepeak", "Cascade", "Lumen",
  "Sentinel", "Kestrel", "Fairmont", "Granite", "Harbor", "Juniper", "Meridian",
  "Nimbus", "Oakline", "Pinnacle", "Quarry", "Ridgeway", "Summit", "Tidewater",
  "Umbra", "Vanguard", "Westbrook", "Yarrow", "Zephyr", "Alder", "Beacon",
  "Cobalt", "Drayton", "Elmwood", "Foxglove", "Gearhart", "Hollis", "Inkwell",
  "Jasper", "Kirkwall", "Larkspur", "Marlowe", "Norwood", "Orchard", "Pembroke",
  "Quillon", "Rushmore", "Stonebridge", "Thornton", "Underhill", "Voss",
  "Whitfield", "Ashcroft",
];
const COMPANY_SUFFIX = [
  "Systems", "Industries", "Group", "Partners", "Labs", "Holdings", "Works",
  "Technologies", "Solutions", "Collective", "Dynamics", "Networks",
];

function companyName(rng: Rng, index: number): string {
  const stem = COMPANY_STEMS[index % COMPANY_STEMS.length] as string;
  const suffix = rng.pick(COMPANY_SUFFIX);
  const disambiguator = Math.floor(index / COMPANY_STEMS.length);
  return disambiguator === 0
    ? `${stem} ${suffix}`
    : `${stem} ${suffix} ${disambiguator + 1}`;
}

function lognormal(rng: Rng, median: number, sigma: number): number {
  return median * Math.exp(rng.normal() * sigma);
}

function round(value: number, to: number): number {
  return Math.round(value / to) * to;
}

function bandFor(rng: Rng, segment: Segment): EmployeeBand {
  if (rng.next() < BAND_DEFIANCE) return rng.pick(EMPLOYEE_BANDS);
  const table = BAND_BY_SEGMENT[segment];
  return rng.weighted(
    table.map(([band]) => band),
    table.map(([, weight]) => weight),
  );
}

function makeReps(count: number): Rep[] {
  const names = [
    "Dana Whitlock", "Priya Raman", "Marcus Bell", "Ines Ferreira",
    "Tomas Novak", "Alice Okonkwo", "Ruth Kaplan", "Sam Ortiz",
    "Elena Duarte", "Jonah Reed",
  ];
  return Array.from({ length: count }, (_, i) => ({
    id: `rep-${String(i + 1).padStart(2, "0")}`,
    name: names[i] ?? `Rep ${i + 1}`,
  }));
}

type Options = {
  id: string;
  label: string;
  accountCount: number;
  repCount: number;
  seed: number;
  /** The pathology passes are Meridian-only; Northwind is deliberately plain. */
  planted: boolean;
};

function basePopulation(options: Options, reps: Rep[]): Account[] {
  const rng = new Rng(derive(options.seed, `${options.id}:base`));
  const accounts: Account[] = [];

  for (let i = 0; i < options.accountCount; i++) {
    const industry = rng.weighted(INDUSTRIES, INDUSTRY_WEIGHTS) as Industry;
    const region = rng.weighted(REGIONS, REGION_WEIGHTS) as Region;
    const segment = rng.weighted(SEGMENTS, SEGMENT_WEIGHTS) as Segment;
    const employeeBand = bandFor(rng, segment);

    const potentialUsd = round(
      lognormal(rng, POTENTIAL_MEDIAN[segment], POTENTIAL_SIGMA[segment]),
      100,
    );

    const [bandLo, bandHi] = BAND_BY_REGION[region];
    const potentialBand = Number(rng.range(bandLo, bandHi).toFixed(3));

    const hasOpp = rng.next() < OPEN_OPP_RATE;
    const openOppStage = hasOpp
      ? rng.weighted(
          STAGE_WEIGHTS.map(([stage]) => stage),
          STAGE_WEIGHTS.map(([, weight]) => weight),
        )
      : null;
    const openPipelineUsd = hasOpp
      ? round(potentialUsd * rng.range(0.12, 0.55), 100)
      : 0;

    accounts.push({
      id: `acc-${String(i + 1).padStart(5, "0")}`,
      name: companyName(rng, i),
      industry,
      region,
      segment,
      employeeBand,
      potentialUsd,
      potentialBand,
      openPipelineUsd,
      openOppStage,
      // Overwritten by the legacy-carve pass for planted universes.
      currentOwnerId: reps[rng.int(reps.length)]!.id,
      tenureDays: Math.floor(rng.range(30, 2200)),
      lastActivityDays: Math.floor(lognormal(rng, 34, 1.05)),
      isNamed: false,
    });
  }

  return accounts;
}

/**
 * `THE LEGACY CARVE`. The book on the ground was cut by geography years ago and
 * never revisited: two reps per region, regardless of how much value sits in
 * each. It is genuinely bad — which is the point. Balance is fully available
 * here, and the tool's job is to show what buying it costs.
 */
function plantLegacyCarve(accounts: Account[], reps: Rep[], seed: number): void {
  const rng = new Rng(derive(seed, "legacy"));
  const byRegion: Record<Region, string[]> = {
    West: ["rep-01", "rep-02"],
    Central: ["rep-03", "rep-04"],
    East: ["rep-05", "rep-06"],
    International: ["rep-07", "rep-08"],
  };
  const known = new Set(reps.map((r) => r.id));
  for (const account of accounts) {
    const pair = byRegion[account.region].filter((id) => known.has(id));
    if (pair.length === 0) continue;
    account.currentOwnerId = pair[rng.int(pair.length)] as string;
  }
}

/**
 * `THE WHALE`. One cell is grown until it holds a share of total potential
 * larger than any single rep's fair share, which puts a floor under the biggest
 * book that no optimizer can get beneath. The residual is then a property of the
 * universe, and reporting it as an optimizer failure would be a lie.
 */
function plantWhale(accounts: Account[], seed: number): void {
  const rng = new Rng(derive(seed, "whale"));
  const inCell = accounts.filter(
    (a) =>
      a.industry === WHALE_CELL.industry &&
      a.region === WHALE_CELL.region &&
      a.segment === WHALE_CELL.segment,
  );
  if (inCell.length === 0) return;

  // Grow the cell's own members rather than moving outsiders in: the cell should
  // be heavy because its accounts are large, which is what a real whale cell
  // looks like, not because the generator stuffed it.
  for (let pass = 0; pass < 60; pass++) {
    const total = accounts.reduce((sum, a) => sum + a.potentialUsd, 0);
    const cellTotal = inCell.reduce((sum, a) => sum + a.potentialUsd, 0);
    if (cellTotal / total >= WHALE_TARGET_SHARE) break;
    for (const account of inCell) {
      account.potentialUsd = round(account.potentialUsd * rng.range(1.06, 1.14), 100);
      if (account.openPipelineUsd > 0) {
        account.openPipelineUsd = round(account.openPipelineUsd * 1.08, 100);
      }
    }
  }
}

/**
 * `THE PROTECTED BOOK`. Late-stage deals are not spread evenly across a sales
 * floor — one rep is always mid-quarter with half the negotiations open. Because
 * late-stage accounts are protected from moving, that rep's book is partly
 * decided before the optimizer starts, and the imbalance it causes belongs to
 * the protection rule by name rather than to the carve.
 */
function plantProtectedBook(accounts: Account[], seed: number): void {
  const rng = new Rng(derive(seed, "protected"));

  // The largest deals in a book are the ones that reach negotiation, so the
  // protected set is the top of the rep's book rather than a random slice.
  const owned = accounts
    .filter((a) => a.currentOwnerId === PROTECTED_REP)
    .sort((a, b) => b.potentialUsd - a.potentialUsd)
    .slice(0, PROTECTED_ACCOUNT_CAP);

  for (const account of owned) {
    account.openOppStage = rng.next() < 0.62 ? "negotiation" : "commit";
    account.openPipelineUsd = round(account.potentialUsd * rng.range(0.28, 0.62), 100);
    account.lastActivityDays = Math.floor(rng.range(1, 21));
    account.tenureDays = Math.max(account.tenureDays, Math.floor(rng.range(500, 2200)));
  }

  // Scale the protected book until it holds the target share of all in-flight
  // pipeline. Solved rather than sampled: the pathology is a stated quantity and
  // a generator that only approached it would make the tests flaky.
  const protectedTotal = () =>
    owned.reduce((sum, a) => sum + a.openPipelineUsd, 0);
  const restTotal =
    accounts.reduce((sum, a) => sum + a.openPipelineUsd, 0) - protectedTotal();
  const target = (PROTECTED_PIPELINE_SHARE * restTotal) / (1 - PROTECTED_PIPELINE_SHARE);
  const scale = target / Math.max(protectedTotal(), 1);
  for (const account of owned) {
    account.openPipelineUsd = round(account.openPipelineUsd * scale, 100);
  }
}

/** Strategic accounts, used by the pinning preset. */
function plantNamedAccounts(accounts: Account[]): void {
  const ranked = [...accounts].sort((a, b) => b.potentialUsd - a.potentialUsd);
  for (const account of ranked.slice(0, NAMED_ACCOUNT_COUNT)) {
    account.isNamed = true;
  }
}

export function generateUniverse(options: Options): Universe {
  const reps = makeReps(options.repCount);
  const accounts = basePopulation(options, reps);

  if (options.planted) {
    plantLegacyCarve(accounts, reps, options.seed);
    plantWhale(accounts, options.seed);
    plantProtectedBook(accounts, options.seed);
    plantNamedAccounts(accounts);
  }

  return { id: options.id, label: options.label, accounts, reps };
}

export const UNIVERSE_SPECS: Options[] = [
  {
    id: "meridian",
    label: "Meridian Software — 2,000 accounts, 8 reps",
    accountCount: 2000,
    repCount: 8,
    seed: 20_260_816,
    planted: true,
  },
  /**
   * `THE FREE BALANCE`. Northwind is deliberately plain: no whale, no legacy
   * geography, no protected book. Its floor is near zero and almost any carve
   * lands near the target. A tool that reported the same triumphant "±3%
   * balanced" here as on Meridian would be measuring nothing, so the console
   * compares against a random-carve baseline and declines the credit.
   */
  {
    id: "northwind",
    label: "Northwind Logistics — 900 accounts, 6 reps",
    accountCount: 900,
    repCount: 6,
    seed: 771_143,
    planted: false,
  },
];

export function generateAll(): Universe[] {
  return UNIVERSE_SPECS.map(generateUniverse);
}
