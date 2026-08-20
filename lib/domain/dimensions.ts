/**
 * The declared dimensions of the account universe.
 *
 * These are the only axes a territory may be cut along, and the order of
 * `DIMENSION_ORDER` is load-bearing: granularity level `n` uses the first `n`
 * dimensions, so level `n+1` always *refines* level `n`. That refinement
 * relationship is what makes sweep invariant 9 (finer granularity never raises
 * the certified floor) true by construction rather than by luck.
 */

export const INDUSTRIES = [
  "SaaS",
  "Manufacturing",
  "Healthcare",
  "Financial Services",
  "Retail",
  "Logistics",
  "Education",
  "Energy",
] as const;

export const REGIONS = ["West", "Central", "East", "International"] as const;

export const SEGMENTS = ["SMB", "Mid-Market", "Enterprise"] as const;

export const EMPLOYEE_BANDS = [
  "1-50",
  "51-200",
  "201-1000",
  "1001-5000",
  "5000+",
] as const;

export type Industry = (typeof INDUSTRIES)[number];
export type Region = (typeof REGIONS)[number];
export type Segment = (typeof SEGMENTS)[number];
export type EmployeeBand = (typeof EMPLOYEE_BANDS)[number];

/**
 * Coarse to fine. Industry first because it is the dimension a rep is most
 * likely to have real expertise in, so a level-1 carve is at least a defensible
 * sentence ("you own Manufacturing") rather than an arbitrary one.
 *
 * Segment precedes employeeBand deliberately: the two are near-collinear in the
 * corpus, which is how `THE REDUNDANT DIMENSION` gets demonstrated — level 4
 * buys far less than its cell count suggests.
 */
export const DIMENSION_ORDER = [
  "industry",
  "region",
  "segment",
  "employeeBand",
] as const;

export type Dimension = (typeof DIMENSION_ORDER)[number];

export const DIMENSION_VALUES: Record<Dimension, readonly string[]> = {
  industry: INDUSTRIES,
  region: REGIONS,
  segment: SEGMENTS,
  employeeBand: EMPLOYEE_BANDS,
};

export const GRANULARITY_LEVELS = [1, 2, 3, 4] as const;
export type GranularityLevel = (typeof GRANULARITY_LEVELS)[number];

/** The dimensions in play at a given granularity level. */
export function dimensionsForLevel(
  level: GranularityLevel,
): readonly Dimension[] {
  return DIMENSION_ORDER.slice(0, level);
}

/**
 * Deal stages, ordered. `protectStage` names the earliest stage that earns an
 * account protection from being moved, so ordering is comparison-significant.
 */
export const STAGES = [
  "discovery",
  "evaluation",
  "negotiation",
  "commit",
] as const;

export type Stage = (typeof STAGES)[number];

export function stageAtLeast(stage: Stage, threshold: Stage): boolean {
  return STAGES.indexOf(stage) >= STAGES.indexOf(threshold);
}

/**
 * The three balance axes. They are reported separately, always. A composite of
 * them exists inside the optimizer because a search needs a total order; it does
 * not leave `lib/optimize/`.
 */
export const AXES = ["count", "potential", "pipeline"] as const;
export type Axis = (typeof AXES)[number];

export const AXIS_LABEL: Record<Axis, string> = {
  count: "Accounts",
  potential: "Potential",
  pipeline: "Open pipeline",
};
