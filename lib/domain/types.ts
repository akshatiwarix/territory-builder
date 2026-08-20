import type {
  Axis,
  Dimension,
  EmployeeBand,
  GranularityLevel,
  Industry,
  Region,
  Segment,
  Stage,
} from "./dimensions";

export type RepId = string;

/**
 * One account in the universe.
 *
 * Note the asymmetry between the two money fields, because it is the whole
 * argument of the stability section: `openPipelineUsd` is a fact recorded in a
 * CRM, and `potentialUsd` is a model output with error. Only the second carries
 * a band. Code that treats them symmetrically has erased the point.
 */
export type Account = {
  id: string;
  name: string;

  // dimensions — the axes cells can be cut along
  industry: Industry;
  region: Region;
  segment: Segment;
  employeeBand: EmployeeBand;

  // weights — the axes balance is measured on
  /** Estimated annual potential. An estimate. */
  potentialUsd: number;
  /** Relative 1σ of that estimate, 0.05–0.60. */
  potentialBand: number;
  /** In-flight pipeline. A fact. */
  openPipelineUsd: number;
  openOppStage: Stage | null;

  // current state — what makes a diff possible at all
  currentOwnerId: RepId;
  /** Days the current owner has held this account. */
  tenureDays: number;
  lastActivityDays: number;
  isNamed: boolean;
};

export type Rep = {
  id: RepId;
  name: string;
};

/**
 * Constraints live on `Config`, not on `Rep`: they are inputs to a plan, not
 * properties of a person.
 */
export type Universe = {
  id: string;
  label: string;
  accounts: Account[];
  reps: Rep[];
};

/**
 * A tuple in the dimension lattice, assigned whole to one rep.
 *
 * Indivisible. That indivisibility is what turns the imbalance floor from a
 * hand-wave into arithmetic, and what makes every territory a readable rule
 * instead of a list of account IDs.
 */
export type Cell = {
  key: string;
  values: Partial<Record<Dimension, string>>;
  accountIds: string[];
  weight: Record<Axis, number>;
};

export type Exclusion = {
  repId: RepId;
  dimension: Dimension;
  value: string;
};

export type Constraints = {
  /** accountId → rep. Overrides whatever the cell says. */
  pinned: Record<string, RepId>;
  capacity: { min: number; max: number } | null;
  exclusions: Exclusion[];
  /** Accounts at or past this stage never change owner. `null` disables. */
  protectStage: Stage | null;
};

export type Weights = {
  count: number;
  potential: number;
  pipeline: number;
  churn: number;
};

/**
 * The entire input to a plan. The permalink encodes this and nothing else — the
 * plan itself is always recomputed, never transported. Two people opening the
 * same link see the same plan because they ran the same deterministic function.
 */
export type Config = {
  universeId: string;
  granularity: GranularityLevel;
  weights: Weights;
  constraints: Constraints;
  seed: number;
  restarts: number;
  iterationCap: number;
};

export type ExceptionReason = "pinned" | "protected";

export type PlanException = {
  accountId: string;
  repId: RepId;
  reason: ExceptionReason;
};

/**
 * A rendered territory rule. `include` is the cell set; `plus`/`minus` are the
 * exceptions, shown rather than smuggled in. A rule that hid its exceptions
 * would break the round-trip guarantee and, with it, the premise that a
 * territory is defensible to the rep who lost an account.
 */
export type TerritoryRule = {
  include: Array<Partial<Record<Dimension, string>>>;
  plus: string[];
  minus: string[];
};

export type Territory = {
  repId: RepId;
  cellKeys: string[];
  accountIds: string[];
  rule: TerritoryRule;
  load: Record<Axis, number>;
};

export type Churn = {
  accountsMoved: number;
  accountsMovedFraction: number;
  /** The headline. Open pipeline that changes owner mid-flight. */
  pipelineMovedUsd: number;
  pipelineMovedFraction: number;
  /** Relationship equity destroyed. Openly arbitrary weighting; see PLAN.md. */
  equityMoved: number;
  equityMovedFraction: number;
  protectedHeld: number;
};

export type BoundName = "ideal" | "cell" | "pair" | "forced";

/**
 * The four certified lower bounds on the maximum rep load, and the floor they
 * imply. `binding` names which one is doing the work — that is often more
 * informative than the number, because it says *why* the residual exists.
 */
export type AxisBounds = {
  ideal: number;
  bounds: Record<BoundName, number>;
  binding: BoundName;
  /** max of the four bounds */
  minMaxLoad: number;
  /** (minMaxLoad − ideal) / ideal */
  floor: number;
};

export type ConstraintName =
  | "pinned"
  | "capacity"
  | "exclusions"
  | "protectStage";

/** What lifting one constraint would do to the floor, in imbalance points. */
export type ConstraintCost = {
  constraint: ConstraintName;
  active: boolean;
  floorWith: Record<Axis, number>;
  floorWithout: Record<Axis, number>;
  cost: Record<Axis, number>;
};

export type Floor = {
  perAxis: Record<Axis, AxisBounds>;
  costs: ConstraintCost[];
};

export type Plan = {
  config: Config;
  cellAssignment: Record<string, RepId>;
  exceptions: PlanException[];
  territories: Territory[];
  /** Achieved imbalance per axis. Never summed for display. */
  imbalance: Record<Axis, number>;
  churn: Churn;
  floor: Floor;
  /** How much of the search budget was actually spent. Diagnostics only. */
  search: { restarts: number; iterations: number; improved: number };
};

/**
 * A configuration that cannot be satisfied produces one of these, by name, and
 * never a crash or a silently dropped constraint.
 */
export type Infeasible = {
  kind: "infeasible";
  reason:
    | "capacity-min-too-high"
    | "capacity-max-too-low"
    | "cell-has-no-eligible-rep"
    | "pin-conflicts-with-exclusion"
    | "no-reps";
  detail: string;
};

export type PlanResult = { kind: "plan"; plan: Plan } | Infeasible;
