export const pct = (value: number, digits = 1) =>
  `${(value * 100).toFixed(digits)}%`;

export function usd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}

export const count = (value: number) => value.toLocaleString("en-US");

export const AXIS_TITLE = {
  count: "Accounts",
  potential: "Potential",
  pipeline: "Pipeline",
} as const;

export const BOUND_TITLE = {
  ideal: "ideal",
  cell: "largest cell",
  pair: "top pair",
  forced: "forced",
} as const;

/** Read under the bar, so it has to be a sentence rather than a bound's name. */
export const BINDING_PHRASE = {
  ideal: "nothing forced this — all of it is the plan's",
  cell: "forced by one indivisible cell",
  pair: "forced by the two largest cells having to share a rep",
  forced: "forced by the constraints, not by the universe",
} as const;

export const BOUND_CLAIM = {
  ideal: "Somebody carries at least the mean.",
  cell: "A cell is indivisible, so the largest one lands on one rep whole.",
  pair: "The m+1 largest cells cannot each have a rep, so two share.",
  forced: "The constraints already decided this much.",
} as const;

export const CONSTRAINT_TITLE = {
  pinned: "Pinned accounts",
  capacity: "Rep capacity",
  exclusions: "Rep exclusions",
  protectStage: "Late-stage protection",
} as const;

export const REFUSAL_TITLE: Record<string, string> = {
  "capacity-min-too-high": "That minimum needs more accounts than exist",
  "capacity-max-too-low": "That maximum cannot hold the universe",
  "capacity-min-unreachable-at-this-granularity":
    "No cell partition reaches that minimum",
  "cell-has-no-eligible-rep": "A cell has no rep allowed to take it",
  "pin-conflicts-with-exclusion": "A pin contradicts an exclusion",
  "exclusion-inert-at-this-granularity": "This lattice cannot express that exclusion",
  "no-reps": "A carve needs at least two reps",
};
