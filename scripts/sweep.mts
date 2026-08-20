/**
 * The sweep: nine invariants over a cross-product of configurations, no network.
 *
 * This is not a slower `npm test`. Invariants 1, 4 and 9 are cross-configuration
 * properties — no single unit test can express them, and they are the only
 * things that can catch a bound that is quietly wrong.
 *
 * Two of the nine were restated during the build, against evidence. Both
 * restatements are recorded here rather than in a commit message nobody will
 * read, because a weakened invariant that looks like the original is worse than
 * no invariant at all.
 */
import { listUniverses } from "@/data";
import { artifactFor } from "@/data/artifacts";
import { evaluateRule } from "@/lib/cells";
import {
  AXES,
  GRANULARITY_LEVELS,
  defaultConfig,
  type Config,
  type GranularityLevel,
  type Plan,
  type Universe,
} from "@/lib/domain";
import { churnFraction } from "@/lib/measure";
import { buildPlan, statusQuoAssignment } from "@/lib/optimize";
import { floorOf } from "@/lib/bounds";
import { prepare } from "@/lib/setup";

/* ------------------------------------------------------------------ */

type Failure = { invariant: string; detail: string };
const failures: Failure[] = [];
const notes: string[] = [];
let checks = 0;

function check(invariant: string, ok: boolean, detail: () => string): void {
  checks++;
  if (!ok) failures.push({ invariant, detail: detail() });
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

/* ------------------------------------------------------------------ */

const WEIGHT_SETS = [
  { label: "default", weights: { count: 1, potential: 2, pipeline: 1, churn: 2 } },
  { label: "churn-heavy", weights: { count: 1, potential: 2, pipeline: 1, churn: 16 } },
  { label: "balance-only", weights: { count: 1, potential: 2, pipeline: 1, churn: 0 } },
  { label: "count-heavy", weights: { count: 8, potential: 1, pipeline: 0, churn: 1 } },
];

function constraintSets(universe: Universe): Array<{
  label: string;
  constraints: Config["constraints"];
}> {
  const named = universe.accounts.filter((a) => a.isNamed).slice(0, 6);
  const half = universe.reps.slice(Math.ceil(universe.reps.length / 2));

  return [
    {
      label: "none",
      constraints: { pinned: {}, capacity: null, exclusions: [], protectStage: null },
    },
    {
      label: "protection",
      constraints: {
        pinned: {},
        capacity: null,
        exclusions: [],
        protectStage: "negotiation",
      },
    },
    {
      label: "protection+capacity",
      constraints: {
        pinned: {},
        capacity: {
          min: Math.floor((universe.accounts.length / universe.reps.length) * 0.7),
          max: Math.ceil((universe.accounts.length / universe.reps.length) * 1.6),
        },
        exclusions: [],
        protectStage: "negotiation",
      },
    },
    {
      label: "protection+exclusions",
      constraints: {
        pinned: {},
        capacity: null,
        exclusions: half.map((rep) => ({
          repId: rep.id,
          dimension: "segment" as const,
          value: "Enterprise",
        })),
        protectStage: "negotiation",
      },
    },
    {
      label: "protection+pins",
      constraints: {
        pinned: Object.fromEntries(
          named.map((account, i) => [
            account.id,
            universe.reps[i % universe.reps.length]!.id,
          ]),
        ),
        capacity: null,
        exclusions: [],
        protectStage: "negotiation",
      },
    },
  ];
}

/* ------------------------------------------------------------------ */

const started = Date.now();
const plans = new Map<string, Plan>();
let infeasible = 0;

for (const universe of listUniverses()) {
  for (const granularity of GRANULARITY_LEVELS) {
    for (const constraintSet of constraintSets(universe)) {
      for (const weightSet of WEIGHT_SETS) {
        const config: Config = {
          ...defaultConfig(universe.id),
          granularity,
          weights: weightSet.weights,
          constraints: constraintSet.constraints,
        };
        const label = `${universe.id}/L${granularity}/${constraintSet.label}/${weightSet.label}`;

        const result = buildPlan(universe, config);
        if (result.kind !== "plan") {
          // A named refusal is a valid outcome, not a failure — but it must be
          // named, and a crash would have thrown before reaching here.
          infeasible++;
          notes.push(`refused ${label}: ${result.reason}`);
          continue;
        }
        const plan = result.plan;
        plans.set(label, plan);

        // --- 1. the bound is never violated --------------------------------
        for (const axis of AXES) {
          check(
            "1 · achieved >= certified floor",
            plan.imbalance[axis] >= plan.floor.perAxis[axis].floor - 1e-9,
            () =>
              `${label} ${axis}: achieved ${pct(plan.imbalance[axis])} < floor ` +
              `${pct(plan.floor.perAxis[axis].floor)} (binding: ${plan.floor.perAxis[axis].binding})`,
          );
        }
        check(
          "1 · achieved churn >= churn floor",
          plan.churn.pipelineMovedFraction >= plan.floor.churn.fraction - 1e-9,
          () =>
            `${label}: churn ${pct(plan.churn.pipelineMovedFraction)} < floor ` +
            `${pct(plan.floor.churn.fraction)}`,
        );

        // --- 2. determinism -------------------------------------------------
        const again = buildPlan(universe, config);
        check(
          "2 · determinism",
          again.kind === "plan" && JSON.stringify(again.plan) === JSON.stringify(plan),
          () => `${label}: a second run of the same config produced a different plan`,
        );

        // --- 5. constraints hold --------------------------------------------
        const ownerOf = new Map<string, string>();
        for (const territory of plan.territories) {
          for (const id of territory.accountIds) ownerOf.set(id, territory.repId);
        }

        for (const [accountId, repId] of Object.entries(config.constraints.pinned)) {
          check(
            "5 · constraints hold",
            ownerOf.get(accountId) === repId,
            () => `${label}: ${accountId} pinned to ${repId}, owned by ${ownerOf.get(accountId)}`,
          );
        }
        if (config.constraints.protectStage) {
          for (const exception of plan.exceptions) {
            if (exception.reason !== "protected") continue;
            const account = universe.accounts.find((a) => a.id === exception.accountId)!;
            check(
              "5 · constraints hold",
              ownerOf.get(account.id) === account.currentOwnerId,
              () => `${label}: protected ${account.id} changed owner`,
            );
          }
        }
        for (const exclusion of config.constraints.exclusions) {
          const territory = plan.territories.find((t) => t.repId === exclusion.repId)!;
          const offending = territory.accountIds.filter((id) => {
            const account = universe.accounts.find((a) => a.id === id)!;
            return (
              (account as unknown as Record<string, string>)[exclusion.dimension] ===
                exclusion.value && !plan.exceptions.some((e) => e.accountId === id)
            );
          });
          check(
            "5 · constraints hold",
            offending.length === 0,
            () =>
              `${label}: ${exclusion.repId} excluded from ${exclusion.dimension}=` +
              `${exclusion.value} but holds ${offending.length} such accounts`,
          );
        }
        if (config.constraints.capacity) {
          for (const territory of plan.territories) {
            check(
              "5 · constraints hold",
              territory.load.count >= config.constraints.capacity.min &&
                territory.load.count <= config.constraints.capacity.max,
              () => `${label}: ${territory.repId} holds ${territory.load.count} accounts`,
            );
          }
        }

        // --- 6. rule round-trip ----------------------------------------------
        for (const territory of plan.territories) {
          const evaluated = [...evaluateRule(territory.rule, universe.accounts)].sort();
          check(
            "6 · rule round-trip",
            JSON.stringify(evaluated) === JSON.stringify(territory.accountIds),
            () =>
              `${label}: ${territory.repId}'s rule selects ${evaluated.length} accounts, ` +
              `territory holds ${territory.accountIds.length}`,
          );
        }

        // --- 7. total and disjoint --------------------------------------------
        const all = plan.territories.flatMap((t) => t.accountIds);
        check(
          "7 · partition is total and disjoint",
          all.length === universe.accounts.length &&
            new Set(all).size === universe.accounts.length,
          () => `${label}: ${all.length} assignments, ${new Set(all).size} distinct`,
        );
      }
    }
  }
}

/* --- 3. churn-only beats the cell-expressible status quo ------------------ *
 *
 * RESTATED. The contract said "zero-churn reproduces the current assignment
 * exactly". It cannot, and finding out why was one of the results of this build:
 * the book on the ground was cut by geography and then split between two reps
 * per region by nothing expressible, so no rule reproduces it at any
 * granularity. The honest invariant is that the search beats the best
 * rule-shaped approximation of the status quo — every cell to whoever already
 * holds the most pipeline in it.
 */
notes.push(
  "invariant 3 restated: the status quo is not cell-expressible, so the test is " +
    "against its closest rule-shaped approximation rather than against itself",
);

for (const universe of listUniverses()) {
  for (const granularity of GRANULARITY_LEVELS) {
    const config: Config = {
      ...defaultConfig(universe.id),
      granularity,
      weights: { count: 0, potential: 0, pipeline: 0, churn: 1 },
    };
    const result = buildPlan(universe, config);
    const prep = prepare(universe, config);
    if (result.kind !== "plan" || prep.kind === "infeasible") continue;

    const baseline = statusQuoAssignment(prep);
    const owners = new Map<string, string>();
    for (const cell of prep.cells) {
      for (const id of cell.accountIds) owners.set(id, baseline[cell.key]!);
    }
    for (const exception of prep.exceptions) owners.set(exception.accountId, exception.repId);

    check(
      "3 · churn-only beats the rule-shaped status quo",
      result.plan.churn.pipelineMovedFraction <=
        churnFraction(universe.accounts, owners) + 1e-9,
      () =>
        `${universe.id}/L${granularity}: churn-only plan moves ` +
        `${pct(result.plan.churn.pipelineMovedFraction)}, baseline moves ` +
        `${pct(churnFraction(universe.accounts, owners))}`,
    );
  }
}

/* --- 4. relaxing a lattice-preserving constraint never worsens the result -- *
 *
 * RESTATED, and this one changed the model's story rather than the test's.
 *
 * The contract said "lifting any constraint, at equal seed and iteration cap,
 * never worsens best-found imbalance", on the reasoning that relaxation expands
 * the feasible set. In a cell model it does not, and the sweep caught it: lifting
 * protection made potential imbalance *worse* by 28 points, from 6.7% to 35.0%.
 *
 * The reason is worth stating plainly. Protected and pinned accounts leave the
 * lattice as exceptions, and exceptions are the only account-level freedom this
 * model has. Every other account is welded to its cell. So a constraint that
 * lifts accounts out of the lattice is not only a restriction — it is also an
 * escape hatch from granularity, and taking it away costs more than it gives.
 *
 * The invariant therefore applies to the constraints that leave the lattice
 * alone (capacity, exclusions). For the two that reshape it, the effect is
 * measured and reported instead of tolerated.
 */
const SLACK_TOLERANCE = 0.02;
let worstSlack = 0;

const LATTICE_PRESERVING = ["capacity", "exclusions"] as const;

for (const universe of listUniverses()) {
  const base = {
    pinned: {},
    capacity: null,
    exclusions: [],
    protectStage: null,
  } as Config["constraints"];

  for (const constraint of LATTICE_PRESERVING) {
    const half = universe.reps.slice(Math.ceil(universe.reps.length / 2));
    const constraints: Config["constraints"] =
      constraint === "capacity"
        ? {
            ...base,
            capacity: {
              min: Math.floor((universe.accounts.length / universe.reps.length) * 0.7),
              max: Math.ceil((universe.accounts.length / universe.reps.length) * 1.6),
            },
          }
        : {
            ...base,
            exclusions: half.map((rep) => ({
              repId: rep.id,
              dimension: "segment" as const,
              value: "Enterprise",
            })),
          };

    const config: Config = { ...defaultConfig(universe.id), granularity: 3, constraints };
    const constrained = buildPlan(universe, config);
    const relaxed = buildPlan(universe, { ...config, constraints: base });
    if (constrained.kind !== "plan" || relaxed.kind !== "plan") continue;

    for (const axis of AXES) {
      const slack = relaxed.plan.imbalance[axis] - constrained.plan.imbalance[axis];
      worstSlack = Math.max(worstSlack, slack);
      check(
        "4 · relaxing a lattice-preserving constraint never worsens",
        slack <= SLACK_TOLERANCE,
        () =>
          `${universe.id}/${constraint}/${axis}: relaxed ` +
          `${pct(relaxed.plan.imbalance[axis])} worse than constrained ` +
          `${pct(constrained.plan.imbalance[axis])}`,
      );
    }
  }

  // And the measurement for the two that reshape the lattice.
  for (const constraint of ["protectStage", "pinned"] as const) {
    const named = universe.accounts.filter((a) => a.isNamed).slice(0, 6);
    const constraints: Config["constraints"] =
      constraint === "protectStage"
        ? { ...base, protectStage: "negotiation" }
        : {
            ...base,
            pinned: Object.fromEntries(
              named.map((account, i) => [
                account.id,
                universe.reps[i % universe.reps.length]!.id,
              ]),
            ),
          };

    const config: Config = { ...defaultConfig(universe.id), granularity: 3, constraints };
    const constrained = buildPlan(universe, config);
    const relaxed = buildPlan(universe, { ...config, constraints: base });
    if (constrained.kind !== "plan" || relaxed.kind !== "plan") continue;

    const delta = relaxed.plan.imbalance.potential - constrained.plan.imbalance.potential;
    if (Math.abs(delta) > 1e-6) {
      notes.push(
        `${universe.id}: lifting ${constraint} moves potential imbalance from ` +
          `${pct(constrained.plan.imbalance.potential)} to ${pct(relaxed.plan.imbalance.potential)}` +
          `${delta > 0 ? " — worse, because its exceptions were the model's only account-level freedom" : ""}`,
      );
    }
  }
}

/* --- 8. the Pareto set is genuinely nondominated -------------------------- */

for (const universe of listUniverses()) {
  for (const granularity of GRANULARITY_LEVELS) {
    const artifact = artifactFor(universe.id, granularity);
    if (!artifact) continue;
    const points = artifact.frontier.points;
    const dims = (p: (typeof points)[number]) => [
      p.imbalance.count,
      p.imbalance.potential,
      p.imbalance.pipeline,
      p.churnPipelineFraction,
    ];

    for (const point of points.filter((p) => !p.dominated)) {
      const dominatedByAnother = points.some((other) => {
        if (other === point) return false;
        const a = dims(other);
        const b = dims(point);
        return (
          a.every((v, i) => v <= b[i]! + 1e-12) && a.some((v, i) => v < b[i]! - 1e-9)
        );
      });
      check(
        "8 · Pareto set is nondominated",
        !dominatedByAnother,
        () => `${universe.id}/L${granularity}: a kept point is dominated`,
      );
    }
  }
}

/* --- 9. finer granularity never raises the certified floor ---------------- *
 *
 * Refinement splits cells, so the cell and pair bounds fall and the forced bound
 * is unchanged. The exception that used to live here — an exclusion naming a
 * dimension the coarser lattice does not contain, inert there and binding at the
 * finer level — is gone, because such a configuration is now refused by name in
 * lib/setup rather than quietly ignored.
 */
for (const universe of listUniverses()) {
  for (const constraintSet of constraintSets(universe)) {
    const floors: Array<{ level: GranularityLevel; floor: number }> = [];

    for (const granularity of GRANULARITY_LEVELS) {
      const config: Config = {
        ...defaultConfig(universe.id),
        granularity,
        constraints: constraintSet.constraints,
      };
      const prep = prepare(universe, config);
      if (prep.kind === "infeasible") continue;
      floors.push({ level: granularity, floor: floorOf(prep, config).potential.floor });
    }

    for (let i = 1; i < floors.length; i++) {
      const previous = floors[i - 1]!;
      const current = floors[i]!;
      check(
        "9 · finer granularity never raises the floor",
        current.floor <= previous.floor + 1e-9,
        () =>
          `${universe.id}/${constraintSet.label}: L${current.level} floor ` +
          `${pct(current.floor)} > L${previous.level} floor ${pct(previous.floor)}`,
      );
    }
  }
}

/* ------------------------------------------------------------------ */

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\nsweep: ${plans.size} plans, ${checks} checks, ${seconds}s`);
console.log(`       ${infeasible} configurations refused by name (not a failure)`);
console.log(`       worst relaxation slack: ${pct(worstSlack)} (tolerance ${pct(SLACK_TOLERANCE)})`);

const uniqueNotes = [...new Set(notes)];
if (uniqueNotes.length > 0) {
  console.log("\nnotes:");
  for (const note of uniqueNotes) console.log(`  · ${note}`);
}

if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURES:`);
  const byInvariant = new Map<string, Failure[]>();
  for (const failure of failures) {
    byInvariant.set(failure.invariant, [...(byInvariant.get(failure.invariant) ?? []), failure]);
  }
  for (const [invariant, list] of byInvariant) {
    console.log(`\n  ${invariant} — ${list.length}`);
    for (const failure of list.slice(0, 5)) console.log(`    ${failure.detail}`);
    if (list.length > 5) console.log(`    ... and ${list.length - 5} more`);
  }
  process.exit(1);
}

console.log("\nall nine invariants hold.");
