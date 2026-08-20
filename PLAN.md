# Day 016 — Territory Builder — Implementation Plan

> This file is the contract. It was settled before any code was written, through a
> structured grilling session, and it is not a starting point to improve on. If the
> code contradicts this file, the code is wrong. If this file needs to change, it
> changes here first, in writing, with the reason.

**Repo:** `territory-builder` · **Day:** 016 of 100 · **Time limit:** one day
**Brief (fixed by the master plan):** *A system for turning an account universe into
balanced sales territories using configurable criteria.*
**Portfolio angle:** assignment logic, optimization, GTM operations.

---

## Problem

Territory design is the highest-stakes recurring decision in go-to-market, and it is
made with the worst tooling of any decision at its level. Once a year somebody opens
a spreadsheet, sorts the account list, cuts it into as many pieces as there are reps,
and declares the result balanced. A slide says **±4%**. The carve ships. Half the
sales floor believes it got robbed, and there is no artifact anywhere that can tell
them whether they did.

Four things are wrong with that number, and they compound.

**1. The plan is presented as an assignment when it is actually a change.** Nobody
carves territories into a vacuum. There is always a current book. Every account that
moves takes with it a relationship someone spent two years building, an open deal
someone was about to close, and context that does not transfer in a CRM record. The
`±4%` says nothing about how much of that was destroyed to get there. A tool that
shows you a carve without showing you the churn it costs has hidden the entire price
of its own recommendation.

**2. Perfect balance is arithmetically impossible, and nobody says so.** Account
universes are lumpy. One account, or one indivisible group of accounts, can be large
enough that *no* assignment reaches the target — the residual is forced by the
structure of the universe, not by the quality of the optimizer. Commercial tools
never report this, which produces two failures at once: teams chase targets that were
never reachable and burn churn doing it, and teams celebrate hitting targets that
every possible carve would have hit. **Both are the same missing number.**

**3. Balance is measured on an estimate and reported as a fact.** You do not balance
on revenue; you balance on *estimated potential*, which is a model output with error
bars that nobody prints. If the estimate is noisy, a plan balanced to ±4% has
distributed the estimation error evenly and called it fairness. Worse: if a 10%
wobble in the estimates reshuffles 40% of the book, the plan was never a plan — it
was one sample from a distribution of plans, and you shipped it to humans whose
income depends on it.

**4. The objectives conflict and get collapsed into one score.** Equal account count,
equal potential, equal in-flight pipeline and low disruption cannot be maximised
together. Every tool that emits a single "balance score" has chosen the tradeoff on
your behalf and then hidden the choice inside a weighted sum.

This repo's subject is those four gaps. The carve itself is the easy part.

### What this repo is not

- **Not a CRM integration.** No HubSpot, no Salesforce, no OAuth. The input is an
  account universe; the output is an assignment and a CSV.
- **Not a mapping product.** Geography is available as a *dimension*. It is never a
  *topology*. Contiguity is not a constraint and there is no map solver.
- **Not an AI product.** Zero model calls. Territory assignment is combinatorial;
  a language model would be strictly worse at it and unverifiable besides. Every
  number this tool prints is reproducible from a seed.
- **Not a quota or comp planner.** Territories in, territories out. Quota setting
  is a different problem with different politics.
- **Not an exact solver.** It does not claim optimality. It claims a *certified lower
  bound*, a best-found plan, and the honest gap between them.

---

## Intended user

A RevOps lead or sales-ops analyst carving 6–12 territories out of a few thousand
accounts, who has to walk into a room and defend the result to the reps who lost
accounts. Their real deliverable is not the carve — it is the *justification*. They
need to be able to say, out loud, three things:

1. "Here is the rule that defines your territory" — not a list of 240 account IDs.
2. "Here is what it cost to move you, and here is what we protected."
3. "Here is why we stopped at 9% instead of 4% — 8.2% of it was not available to us."

Secondary user: an interviewer or engineer reading the repo, who should be able to
see the optimizer, the bound, and the invariants without running anything.

---

## User journey

1. Land on the console. A 2,000-account universe is already loaded with an existing
   territory assignment and a plan already computed. No upload, no sign-up, no key.
2. Read the **Carve**: eight reps, each with a rendered rule, three imbalance bars,
   and their book size.
3. Read the **Diff**: what changed from the current carve — accounts moved, pipeline
   dollars that changed hands, which accounts were protected from moving.
4. Read the **Floor**: the certified lower bound, the achieved imbalance, and the
   gap between them labelled as unknown. Below it, the cost attribution: how much of
   the residual each constraint is responsible for.
5. Open the **Frontier**: ~32 plans on a churn-vs-imbalance scatter. Click one. The
   whole console reloads on that plan. The tradeoff is now something they have seen
   with their own eyes rather than a sentence in a doc.
6. Change the **granularity**: coarser cells make the rules readable and the floor
   rise. This is the second tradeoff, and it is also visible.
7. Read the **Stability**: imbalance as an interval instead of a point, and the
   percentage of accounts that keep their owner when the potential estimates are
   perturbed within their stated bands.
8. Export CSV. Copy the permalink. Both replay byte-identically.

---

## MVP scope

**In:**

- Seeded synthetic corpus: ~2,000 accounts, 8 reps, an existing assignment, eight
  named pathologies, committed to the repo as JSON.
- Cell lattice over declared dimensions with four granularity levels.
- Three balance axes (count, potential, in-flight pipeline) reported separately,
  plus churn as a fourth axis. **No composite score is ever displayed.**
- Four hard constraints: pinned accounts, rep capacity, rep exclusions, late-stage
  protection.
- Certified floor from four arithmetic lower bounds, plus per-constraint cost
  attribution.
- LPT-seeded steepest-descent local search with multi-start, deterministic.
- Precomputed Pareto frontier of ~32 weight vectors.
- Perturbation analysis: intervals on the same plan, and re-optimized plan stability.
- Territory rule rendering with a round-trip guarantee.
- Console: five sections, single page, permalink-driven.
- `POST /api/v1/plan`, `GET /api/schema`, CSV export.
- `npm run sweep`: nine invariants over a cross-product, no network.

**Out (explicitly):**

- Uploading your own account file. The corpus is the demo; a file picker is a day of
  CSV-schema-guessing that teaches the reader nothing.
- Any persistence, account system, or database.
- Contiguity, drive-time, or any spatial constraint.
- Quota, comp, capacity planning, headcount recommendation.
- Multi-tier territories (overlay/specialist/hierarchy).
- Any model call.

---

## Stack

Identical to the sibling repos, deliberately — the point of the challenge is the
subject, not the stack.

- **Next.js 16.3.1** (App Router), **React 19.2.8**, **TypeScript** strict with
  `noUncheckedIndexedAccess`.
- **Tailwind CSS 4**.
- **zod 4** for every boundary — API input, corpus load, permalink decode.
- **vitest 4** for unit tests, **vite-node** for the sweep, corpus and frontier
  scripts.
- **Vercel** for deployment.
- No optimization library, no solver dependency, no charting library. The optimizer
  is ~300 lines and the charts are SVG, and both are more legible written out than
  imported.

---

## Data sources

**A single committed synthetic corpus**, generated by `data/generate.ts` from a
fixed seed, checked into the repo as JSON so results are reproducible without
running the generator.

Real firmographic data was considered and rejected. This tool's claims are about
*assignment structure* — lumpiness, forced residual, estimate sensitivity — and
those are properties of the shape of a universe, not of whose logo is on it.
Committing scraped company data would add legal surface and third-party claims
(Day 013's problem) while teaching the reader nothing about territory design. The
generator is committed, the seed is fixed, and the pathologies are planted on
purpose and named, so the corpus is *auditable* in a way a scrape would not be.

---

## System / architecture

Five layers. The boundaries are load-bearing and the dependency arrows only point
downward.

```
data/          corpus generation + committed JSON + zod load schema
  ↓
lib/domain/    Account, Rep, Cell, Assignment, Plan, Config — types + schemas
  ↓
lib/cells/     lattice construction, granularity levels, rule render + parse
  ↓
lib/measure/   axis loads, imbalance, churn, per-constraint cost attribution
  ↓
lib/bounds/    the four certified lower bounds; pure arithmetic, no search
  ↓
lib/optimize/  LPT seed, local search, multi-start, exception resolution
  ↓
lib/analysis/  Pareto frontier sweep, perturbation intervals, plan stability
  ↓
app/           console (RSC where possible) + /api/v1/plan
```

### Rules of the architecture

1. **`lib/bounds/` never calls `lib/optimize/`.** A bound that depends on a search is
   not a bound. This separation is the technical expression of the whole thesis and
   is enforced by a sweep invariant, not by good intentions.
2. **`lib/optimize/` is pure and synchronous.** Same input plus same seed produces a
   byte-identical plan. No `Date.now()`, no `Math.random()`, no wall-clock budget —
   the search budget is counted in *iterations*, so a permalink replays identically
   on a laptop and on a Vercel function.
3. **Nothing below `app/` knows about React, HTTP or the DOM.**
4. **Every measurement is computed once, in `lib/measure/`.** The console does not
   recompute an imbalance for display. If a number appears twice on screen it came
   from the same call.

---

## Data model

### Account

```ts
type Account = {
  id: string;
  name: string;
  // dimensions — the axes cells can be cut along
  industry: Industry;          // 8 values
  employeeBand: EmployeeBand;  // 5 values
  region: Region;              // 4 values (West, Central, East, International)
  segment: Segment;            // 3 values (SMB, MidMarket, Enterprise)
  // weights — the axes balance is measured on
  potentialUsd: number;        // estimated annual potential
  potentialBand: number;       // relative 1σ of that estimate, 0.05–0.60
  openPipelineUsd: number;     // in-flight, real, not an estimate
  openOppStage: Stage | null;  // null | discovery | evaluation | negotiation | commit
  // current state — what makes a diff possible
  currentOwnerId: RepId;
  tenureDays: number;          // days this rep has owned this account
  lastActivityDays: number;    // days since last logged activity
  isNamed: boolean;            // strategic / named account
};
```

`potentialUsd` is an *estimate* and is the only weight that carries a band. That
asymmetry is the point: `openPipelineUsd` is a fact, `potentialUsd` is a model
output, and a tool that treats them the same is the tool this repo is arguing with.

### Rep

```ts
type Rep = { id: RepId; name: string; };
```

Constraints on reps live in `Config`, not on the rep, because they are inputs to a
plan rather than properties of a person.

### Cell

```ts
type Cell = {
  key: string;                 // stable, derived from dimension values in order
  values: Partial<Record<Dimension, string>>;
  accountIds: string[];        // never empty; cells with no accounts are not built
  weight: Record<Axis, number>; // count | potential | pipeline
};
```

A cell is **indivisible**. This is the single most consequential modelling decision
in the repo (see *Method → Why cells*).

### Config

```ts
type Config = {
  corpusId: string;
  granularity: 1 | 2 | 3 | 4;  // how many dimensions form the lattice
  weights: { count: number; potential: number; pipeline: number; churn: number };
  constraints: {
    pinned: Record<string, RepId>;         // accountId → rep
    capacity: { min: number; max: number } | null;
    exclusions: Array<{ repId: RepId; dimension: Dimension; value: string }>;
    protectStage: Stage | null;            // accounts at/after this stage never move
  };
  seed: number;
  restarts: number;
  iterationCap: number;
};
```

`Config` is the *entire* input. The permalink encodes `Config` and nothing else; the
plan is always recomputed, never transported. If two people open the same link they
are looking at the same plan because they ran the same deterministic function, not
because a blob was serialised.

### Plan

```ts
type Plan = {
  config: Config;
  cellAssignment: Record<string, RepId>;
  exceptions: Array<{ accountId: string; repId: RepId; reason: "pinned" | "protected" }>;
  territories: Territory[];    // rep, rule, accountIds, loads
  imbalance: Record<Axis, number>;
  churn: Churn;
  floor: Floor;
};
```

---

## Method

### Why cells

The tension at the centre of the design: **the finest balance comes from assigning
accounts one at a time, and the only defensible territory is one that a rule
describes.** A per-account optimizer produces a territory that is a list of 240 IDs.
No rep can be told why they own it, no CRM rule can maintain it, and next quarter's
new accounts have nowhere to go.

So the decision variable is not the account. The declared dimensions form a
cross-product lattice, and each occupied **cell** is assigned whole to one rep.
Every territory is then, by construction, a set of cells, which renders directly as
a readable predicate:

> `Manufacturing × 200–1000 × West` ∪ `Manufacturing × 1000+ × West`

This buys three things at once:

1. **Rules for free.** No post-hoc rule induction that approximately fits an
   arbitrary assignment. The rule *is* the assignment.
2. **The floor becomes a derived quantity.** Because a cell cannot be split, the
   largest cell sets a hard lower bound on the biggest rep's load. The imbalance
   floor stops being a hand-wave and becomes arithmetic.
3. **Granularity becomes a real, visible tradeoff.** Level 1 uses one dimension —
   four huge cells, a rule a rep can recite, and a floor that may exceed any
   reasonable target. Level 4 uses all four — hundreds of small cells, a floor near
   zero, and a rule nobody can hold in their head. **Neither end is correct**, and
   showing that curve is one of the two things this tool exists to show.

### Exceptions, and why they exist

Two constraints break cell atomicity: a **pinned** account may sit in a cell awarded
to another rep, and a **protected** account (late-stage open opp) must stay with its
current owner regardless. Rather than fracture the lattice, these accounts are lifted
*out* of cell logic and carried as explicit exceptions, so a rendered rule reads:

> `Manufacturing × West`, plus `Acme Corp`, minus `Globex`

which is exactly how a real territory document reads. Exceptions are bounded (only
pins and protections create them), enumerable, and displayed. A tool that silently
smuggled exceptions into the rule would have broken its own premise, so the rule
round-trip is a sweep invariant: render a territory's rule, evaluate it against the
universe, and get back exactly the assigned account set.

### The axes

Three balance axes, each with a per-rep load, all reported **separately and never
summed for display**:

| axis | load | why it is not the others |
|---|---|---|
| `count` | number of accounts | proxy for touch capacity; what reps actually complain about |
| `potential` | Σ `potentialUsd` | what the plan is nominally optimizing; an *estimate* |
| `pipeline` | Σ `openPipelineUsd` | in-flight and real; balancing it means moving live deals |

**Imbalance** on an axis is the relative overshoot of the worst-loaded rep:

```
I(axis) = (max_r load_r − ideal) / ideal        where ideal = total / |reps|
```

Max-side rather than max-minus-min because it is (a) always non-negative, (b)
directly certifiable — every lower bound below bounds the *maximum* load, and (c)
the thing a rep actually experiences: someone is carrying too much.

### Churn — the fourth axis

Churn is a *cost*, measured against the current assignment, and it is reported three
ways because the three disagree and the disagreement is informative:

- `accountsMoved` — count, and fraction of universe.
- `pipelineMovedUsd` — **the headline**. Open pipeline dollars that change owner
  mid-flight. Moving 400 dormant accounts is nearly free; moving one account with a
  live negotiation-stage deal is not, and a metric that scores those the same is
  the reason territory plans get overruled in the room.
- `equityMoved` — relationship equity destroyed, a single composed weight:

```
equity(a) = openPipelineUsd(a) × tenureFactor(a) × recencyFactor(a)
tenureFactor  = clamp(tenureDays / 730, 0.25, 1.5)      // 2 years = full weight
recencyFactor = lastActivityDays < 30 ? 1.5 : lastActivityDays < 90 ? 1.0 : 0.5
```

The constants are arbitrary and are documented as arbitrary, in the README and in
the code. The claim is not that this formula is correct; the claim is that scoring
churn by account count is *definitely* wrong, and that any weighting stated out loud
where the user can see and disagree with it beats a hidden one.

For the optimizer's internal scalarization, churn enters as a fraction:
`churnFraction = pipelineMovedUsd / totalPipelineUsd`.

### The certified floor

The refusal, and the load-bearing beam of the repo. For each axis, the **maximum
achievable-load lower bound** is the maximum of four independently provable bounds
over cell weights `w` sorted descending, with `m` reps:

| bound | claim | proof |
|---|---|---|
| `LB_ideal` | `total / m` | pigeonhole: some rep carries at least the mean |
| `LB_cell` | `max_i w_i` | cells are indivisible; the largest lands on somebody whole |
| `LB_pair` | `w[m] + w[m+1]` | `m+1` largest cells into `m` reps ⇒ two share a rep |
| `LB_forced` | `max over eligibility groups: Σw(C) / \|S\|` | if only rep set `S` may take cell set `C` (exclusions), plus pinned/protected load already committed to a specific rep |

```
floor(axis) = (max(LB_ideal, LB_cell, LB_pair, LB_forced) − ideal) / ideal
```

All four are `O(n log n)` arithmetic and **none of them runs a search**. That is why
`lib/bounds/` may not import `lib/optimize/`.

**Three numbers are reported, never two:**

```
certified floor  8.2%     ← proven unreachable below this
best found       9.1%     ← this plan
the gap          0.9%     ← UNKNOWN. Not "nearly optimal". Not claimed.
```

The gap is labelled *unknown* in the UI, in that word. The tool does not know
whether a better plan exists in it, and saying "near-optimal" would be inventing a
claim the method cannot support.

### Constraint cost attribution

For each of the four constraints, the floor is recomputed with that constraint
lifted and everything else held fixed. The difference is that constraint's **cost in
imbalance points**, reported per constraint. This is what lets the user say "late-
stage protection is costing us 3.1 points of potential imbalance, and we chose that
on purpose" instead of discovering it in a hallway six weeks later.

### The optimizer

```
for restart in 0..restarts-1:
    order  ← cells sorted by weight desc, tie-broken by key,
             then seeded-shuffled within equal-weight runs (restart-dependent)
    seed   ← LPT: place each cell on the rep with the lowest scalarized load
    repeat until no improving move or iterationCap reached:
        best ← argmin over {move cell c → rep r} ∪ {swap cells c1 ↔ c2}
        if delta < 0: apply; else break
keep the best plan across restarts; tie-break by (score, plan hash)
```

Scalarized internally as
`F = w_count·I_count + w_potential·I_potential + w_pipeline·I_pipeline + w_churn·churnFraction`.

**The weight vector is a search input and is never displayed as a score.** It is
shown only as a *position on the frontier*.

Determinism is a hard requirement, not a nicety: every tie-break is total (weight,
then cell key, then rep id), the RNG is a seeded LCG carried explicitly, and the
budget is an iteration count. The sweep asserts byte-identical replay.

### The frontier

A fixed grid of ~32 weight vectors, spanning balance-emphasis against
churn-emphasis. One optimizer run per point; keep only Pareto-nondominated plans
over (churn, I_potential, I_count). Rendered as a scatter — **x = pipeline dollars
moved, y = potential imbalance, dot size = count imbalance**. Clicking a dot loads
that plan into the whole console.

Precomputed by `npm run frontier` and committed for the demo corpus, so first paint
is instant and the demo does not depend on function timing.

### Perturbation

`potentialUsd` carries `potentialBand`, a relative 1σ. With a seeded normal draw:

- **Intervals (N=200, cheap).** Re-score *the same plan* under perturbed potentials.
  Report `I_potential` as a p5–p95 interval instead of a point, and report how often
  the identity of the worst-off rep survives. If the plan's central claim flips under
  a wobble smaller than the stated error, the claim was never there.
- **Stability (N=64, expensive).** *Re-optimize* under each perturbation with the same
  config and seed, and report the mean fraction of accounts that keep their owner
  versus the baseline plan. A plan that reshuffles 40% of the book when estimates
  move within their own error bars is not a plan, and this is the one number in the
  repo most likely to be quoted.

Both are committed for the demo corpus.

---

## The number that is never reported

**A single balance score.** Not on screen, not in the API response, not in the CSV.

The scalarized `F` exists inside the optimizer because a search needs a total order.
It does not escape. Every surface reports the three imbalance axes and the three
churn measures separately, because they genuinely conflict and the choice between
them belongs to the person who has to defend the carve — not to a weighted sum
chosen by whoever wrote the tool.

Second thing never reported: **"optimal", or "near-optimal".** The tool has a
certified floor and a best-found plan. The distance between them is printed and
labelled unknown.

---

## The corpus and the eight named pathologies

~2,000 accounts, 8 reps, one existing (deliberately stale) assignment. Generated
from a fixed seed by `data/generate.ts`, committed as JSON. Eight structures are
planted on purpose, each demonstrating one claim, each asserted by a test:

| name | planted structure | what it proves |
|---|---|---|
| `THE WHALE` | one cell holds ~9% of total potential | floor sits above any reasonable target — the residual is the universe's fault, not the optimizer's |
| `THE LEGACY CARVE` | current assignment is stale and geographic | balance is fully available, but only by moving a large share of live pipeline — the tradeoff is real, not theoretical |
| `THE PROTECTED BOOK` | late-stage opps concentrated on one rep | protection alone forces ~12% imbalance; constraint cost attribution names it |
| `THE NOISY PROXY` | one segment with 0.5+ potential bands | stability collapses to ~55% — the plan is a sample, not a decision |
| `THE EXCLUDED REP` | one rep excluded from the largest vertical | `LB_forced` becomes the binding bound, not `LB_cell` |
| `THE GRANULARITY TRAP` | dimension sizes tuned so floor ≈18% at level 1 and ≈3% at level 4 | readability and reachability trade off directly |
| `THE FREE BALANCE` | a sub-universe where every carve is near-balanced | the tool refuses to take credit for a target that was free |
| `THE REDUNDANT DIMENSION` | two near-collinear dimensions | different rules, identical carve — the tool names both rather than implying the dimension mattered |

Each pathology has a test in `data/*.test.ts` asserting the structure still exists,
so a change to the generator that quietly flattens a pathology fails the suite
rather than silently weakening every demo in the README.

---

## Console

Single page, five sections, all driven by the permalink-encoded `Config`. Opens on
the demo corpus with a plan already computed — no upload, no key, no empty state,
matching Days 008 and 013.

1. **Carve** — one row per rep: rendered rule (with `plus`/`minus` exceptions), book
   size, and the three imbalance bars. The bar draws the rep's load against ideal,
   with the certified floor marked as a line on the axis, so the unreachable region
   is visible in the same picture as the result.
2. **Diff** — flow from current owner to proposed owner: accounts moved, pipeline
   dollars moved, equity moved. Protected accounts marked as held. This is the
   section a rep would be shown.
3. **Frontier** — the scatter. ~32 runs, Pareto-filtered, click to load.
4. **Floor** — certified / achieved / gap-labelled-unknown, plus the per-constraint
   cost table, plus the granularity curve (floor vs level).
5. **Stability** — `I_potential` as a p5–p95 interval, worst-rep-identity survival
   rate, and the reshuffle percentage.

Controls: granularity level, the four weights, the four constraints. Every control
writes to the permalink.

---

## API surface

- `POST /api/v1/plan` — zod-validated `Config` in, full `Plan` out: assignment, all
  three axes, all three churn measures, floor with its four bounds itemised, and
  constraint cost attribution. No auth, no persistence, no rate limit.
- `GET /api/schema` — the request/response schema, rendered from the zod schemas so
  it cannot drift from the implementation.
- `GET /api/v1/plan/csv?...` — the assignment as CSV: account id, name, current
  owner, proposed owner, moved flag, exception reason. Because the actual buyer of
  this output pastes it into a CRM, and a tool whose output cannot leave the browser
  is a demo rather than a tool.

---

## Implementation task order

Each numbered item is one commit, pushed to `main` on completion.

1. `chore`: scaffold, configs, license, this plan.
2. `feat(domain)`: types, zod schemas, axis/dimension/stage enums.
3. `feat(data)`: corpus generator, eight pathologies, committed JSON, structure tests.
4. `feat(cells)`: lattice, four granularity levels, rule render, rule round-trip test.
5. `feat(measure)`: axis loads, imbalance, three churn measures.
6. `feat(bounds)`: the four certified bounds, floor derivation, constraint attribution.
7. `feat(optimize)`: LPT seed, local search, multi-start, determinism, exceptions.
8. `feat(analysis)`: Pareto frontier sweep, perturbation intervals, plan stability.
9. `test`: `scripts/sweep.mts` — the nine invariants over the cross-product.
10. `feat(api)`: `POST /api/v1/plan`, `GET /api/schema`, CSV export, permalink codec.
11. `feat(app)`: the console — five sections.
12. `chore`: precompute and commit frontier + stability artifacts.
13. `docs`: README, plain-English guide, screenshots from the live deployment.

Order is dependency-forced: nothing above can be built before everything below it
exists, and `bounds` deliberately precedes `optimize` so the bound is never
contaminated by knowledge of the search.

---

## Validation / test plan

**Unit tests** (`vitest`, `lib/**/*.test.ts`, `data/**/*.test.ts`): each bound proved
against a hand-computed case; rule rendering; churn arithmetic; the eight pathology
structure assertions; permalink codec round-trip; zod boundary rejection.

**`npm run sweep`** — the cross-product of granularity × weight vector × constraint
set, no network, asserting **nine invariants**:

1. **Bound is never violated.** Achieved imbalance ≥ certified floor, every axis,
   every configuration. A violation means either the bound or the optimizer is wrong,
   and the sweep is the only thing that can catch it.
2. **Determinism.** Same config + seed ⇒ byte-identical plan.
3. **Zero-churn reproduces the status quo.** With churn weight at maximum and all
   others zero, the plan is exactly the current assignment.
4. **Relaxation never hurts.** Lifting any constraint, at equal seed and iteration
   cap, never worsens best-found imbalance.
5. **Constraints hold.** Pins, capacity, exclusions, and protection are never
   violated in any produced plan.
6. **Rule round-trip.** Rendering a territory's rule and evaluating it returns
   exactly that territory's account set.
7. **Partition is total and disjoint.** Every account assigned exactly once.
8. **Pareto set is genuinely nondominated.** No frontier point dominates another.
9. **Finer granularity never raises the floor.** Level `n+1` refines level `n`, so
   its certified floor is ≤ level `n`'s.

`npm run sweep` is not a slower `npm test`. Invariants 1, 4 and 9 are cross-
configuration properties — no single unit test can express them, and they are the
ones that catch a genuinely wrong bound.

**Manual verification** before shipping: the main journey end to end on the deployed
URL, plus the failure states — empty constraint sets, a capacity that is infeasible,
an exclusion set that leaves a cell with no eligible rep. Infeasibility must produce
a named, readable refusal, never a crash and never a silently dropped constraint.

---

## Deployment plan

Vercel, linked at task 1 so the live URL exists before the README needs it. No
environment variables, no secrets, no external calls at runtime — the corpus and
precomputed artifacts are committed, so the deployment is static plus pure compute.
`main` is the production branch; every task pushes.

---

## README plan

Following the house structure: title, one-sentence thesis, live link, plain-English
guide link, day marker, hero screenshot, then **Why I Built This** (the four gaps
above, argued), **What It Does**, **Demo** (walking the named pathologies with
screenshots — `THE WHALE`, `THE PROTECTED BOOK`, the frontier, the granularity
curve), **How It Works** (the pipeline diagram, cells, the four bounds), **The
numbers this tool refuses to print**, **Tradeoffs and what is arbitrary** (the equity
constants, the local search's lack of optimality guarantee, the synthetic corpus),
**Run it locally**, **Repo map**.

Plus `docs/plain-english-guide.md` for the non-engineer reader, matching Days 008
and 013.

---

## Definition of done

- [ ] `npm run build`, `npm run typecheck`, `npm run lint` all clean.
- [ ] `npm test` green, including the eight pathology assertions.
- [ ] `npm run sweep` green on all nine invariants.
- [ ] Console live on Vercel, opening on a computed plan with no interaction.
- [ ] All five console sections implemented and reading from one measurement pass.
- [ ] Certified floor, best-found, and the gap labelled *unknown* visible on screen.
- [ ] Frontier clickable; clicking changes the whole console.
- [ ] Permalink round-trips; CSV downloads.
- [ ] Infeasible configurations produce a named refusal.
- [ ] README with real screenshots from the live deployment; plain-English guide.
- [ ] Every task pushed to `main`.

---

## Cut order if the day runs out

Cut from the bottom. Each cut is a section removed cleanly, never a claim weakened.

1. `docs/plain-english-guide.md`.
2. CSV export.
3. Stability re-optimization (N=64) — keep the cheap intervals.
4. The frontier scatter — keep a fixed three-plan comparison.
5. Constraint cost attribution — keep the floor itself.

**Never cut:** the certified floor, the diff, the three-axes-never-summed rule, the
rule round-trip, or the sweep. Those are the repo's argument. A version of this tool
without them is the tool it was written to argue with.

---

## Post-MVP (not in this build)

- Upload your own universe (CSV with a declared dimension mapping).
- Exact solve for small instances via branch-and-bound, to close the unknown gap on
  cases where it is closable and report the true optimality gap.
- Multi-period: carve for Q1, then re-carve for Q2 with Q1 as the new baseline, and
  measure cumulative churn across a year.
- Overlay territories (specialists, SEs) as a second assignment layer over the same
  cells.
- Rep preference input — let reps rank accounts and measure the plan against stated
  preferences.

---

## Settled decisions

Every one of these was put to the user and confirmed before code was written.

1. Thesis is three-layered: **the diff is the product**, the **imbalance floor** is
   the refusal, the **uncertainty layer** is the honesty. Diff leads.
2. Territories are **attribute-based**, with geography as one available dimension.
3. **Contiguity is not a constraint.** No topology, no map solver.
4. Balance is reported on **three separate axes** plus churn; a single composite
   score is **never** displayed.
5. **Zero model calls.** Fully deterministic.
6. Corpus is **synthetic, seeded, committed**, ~2,000 accounts, 8 reps, with a
   current assignment.
7. Decision variable is the **cell**, not the account — territories are rules by
   construction.
8. Cell granularity is a **user-facing knob** and its tradeoff against the floor is
   displayed.
9. Churn is priced in **open-pipeline dollars** first, account count second, and
   relationship equity as one composed, openly arbitrary weight.
10. **Late-stage protection** is a hard constraint, and the imbalance it causes is
    attributed to it by name.
11. Exactly **four hard constraints**: pins, capacity, exclusions, late-stage
    protection. Nothing else.
12. Pins and protections are carried as **explicit exceptions**, shown in the rule.
13. The floor is **certified** by four arithmetic lower bounds, never by a search.
14. Three numbers reported — floor, achieved, and the gap **labelled unknown**.
15. Optimizer is **LPT seed + steepest-descent local search + multi-start**, budgeted
    in iterations, not wall-clock.
16. Internal scalarization exists but **never escapes the optimizer**.
17. Frontier is a **fixed ~32-point weight grid**, Pareto-filtered, precomputed and
    committed.
18. Perturbation does **both**: intervals on the same plan (N=200) and re-optimized
    stability (N=64).
19. Public surface is **permalink + `POST /api/v1/plan` + CSV**. No auth, no
    persistence.
20. Eight **named pathologies**, each asserted by a test.
21. Console is **one page, five sections**, opening on a computed plan.
22. Stack is **identical to Day 015**; deployment is Vercel.
23. **Nine sweep invariants**, listed above, run over a cross-product with no network.
24. `lib/bounds/` **may not import** `lib/optimize/`; enforced by the sweep.
25. Time limit is **one day**; the cut order above is fixed in advance.
26. Push to `main` after **every** completed task.
