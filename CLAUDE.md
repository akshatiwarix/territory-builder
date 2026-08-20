# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Day 016 of a 100-day building challenge. **`PLAN.md` is the contract** — 26 decisions
settled before any code was written. It is not a suggestion and not a starting point
to improve on. If this file contradicts `PLAN.md`, `PLAN.md` wins; if the code
contradicts either, the code is wrong.

## What this repo is

A territory planner whose subject is **not the carve**. The carve is a local search
and it is the easy part. The repo's argument is the three things every commercial
territory tool omits:

1. **A plan is a diff, not an assignment.** There is always a current book. Churn is
   priced in open-pipeline dollars that change owner, never in accounts moved.
2. **Perfect balance is arithmetically impossible on a lumpy universe.** The tool
   computes a *certified lower bound* on imbalance and reports floor / achieved /
   **gap-labelled-unknown** — three numbers, never two.
3. **Balance measured on an estimate is not a fact.** `potentialUsd` carries an error
   band; imbalance is reported as an interval, and plan *stability* under
   perturbation is reported alongside it.

If you find yourself writing a single composite "balance score", a map/contiguity
solver, a CRM integration, or a model call, stop — every one of those is explicitly
out of scope in `PLAN.md`.

## Commands

```bash
npm run dev        # dev server
npm run build      # production build — run before claiming done
npm test           # vitest run (lib/**/*.test.ts, data/**/*.test.ts)
npm run test:watch # watch mode
npm run sweep      # nine invariants, full cross-product, no network
npm run corpus     # regenerate the committed synthetic corpus from its fixed seed
npm run frontier   # recompute + commit the Pareto frontier and stability artifacts
npm run typecheck  # next typegen && tsc --noEmit
npm run lint       # eslint
```

Run a single test: `npx vitest run lib/bounds/floor.test.ts`
Run a single test by name: `npx vitest run -t "largest cell bounds the max load"`

**`npm run sweep` is not a slower `npm test`.** Invariants 1 (achieved ≥ certified
floor), 4 (relaxing a constraint never worsens the result) and 9 (finer granularity
never raises the floor) are cross-configuration properties. No single unit test can
express them, and they are the only things that catch a genuinely wrong bound. It
must pass before any claim that the build works.

## Architecture

Seven layers. Dependency arrows point downward only.

```
data/          corpus generation + committed JSON + zod load schema
lib/domain/    Account, Rep, Cell, Config, Plan — types + schemas
lib/cells/     lattice, granularity levels, rule render + parse
lib/measure/   axis loads, imbalance, churn, constraint cost attribution
lib/bounds/    the four certified lower bounds — pure arithmetic, no search
lib/optimize/  LPT seed, local search, multi-start, exception resolution
lib/analysis/  Pareto frontier, perturbation intervals, plan stability
app/           console + /api/v1/plan
```

### Invariants of the architecture

- **`lib/bounds/` must never import `lib/optimize/`.** A bound that depends on a
  search is not a bound. This is the technical expression of the whole thesis and is
  asserted by the sweep, not left to good intentions.
- **`lib/optimize/` is pure and synchronous.** No `Date.now()`, no `Math.random()`,
  no wall-clock budget. The RNG is a seeded LCG carried explicitly and the search
  budget is an *iteration count*, so a permalink replays byte-identically on a laptop
  and in a Vercel function. Every tie-break is total: `(weight, cellKey, repId)`.
- **Nothing below `app/` knows about React, HTTP or the DOM.**
- **Measurement happens once**, in `lib/measure/`. The console never recomputes a
  number for display; if a value appears twice on screen it came from one call.

### The two ideas you need before reading the code

**Cells.** The decision variable is not the account — it is the **cell**, a tuple in
the cross-product lattice of declared dimensions (industry × employeeBand × region ×
segment), assigned whole to one rep. Two consequences drive everything else: every
territory is automatically a readable *rule* rather than a list of IDs, and because a
cell is indivisible, the largest cell puts a **provable floor** under the biggest
rep's load. Granularity (levels 1–4 = how many dimensions form the lattice) is a
user-facing knob, and its tradeoff — readable rules vs reachable balance — is one of
the two things the tool exists to show.

**Exceptions.** Pinned accounts and late-stage-protected accounts break cell
atomicity. Rather than fracture the lattice, they are lifted out and carried as
explicit `exceptions`, so a rule renders as `Manufacturing × West, plus Acme, minus
Globex`. Exceptions come from *only* those two sources. The **rule round-trip** is a
sweep invariant: render a territory's rule, evaluate it against the universe, get
back exactly that territory's account set.

### Imbalance

```
I(axis) = (max_r load_r − ideal) / ideal        ideal = total / |reps|
```

Max-side, because every lower bound bounds the *maximum* load and is therefore
directly certifiable against it. Three axes — `count`, `potential`, `pipeline` —
always reported separately.

## Things that are load-bearing and easy to break

- **Never display a composite score.** The optimizer scalarizes internally because a
  search needs a total order; that number must not escape `lib/optimize/`.
- **Never write "optimal" or "near-optimal".** The tool has a certified floor and a
  best-found plan. The distance between them is printed and labelled *unknown*.
- **`potentialUsd` is an estimate and `openPipelineUsd` is a fact.** Only the first
  carries a band. Code that treats them symmetrically has erased the point.
- **The eight named pathologies** in the corpus (`THE WHALE`, `THE PROTECTED BOOK`,
  `THE GRANULARITY TRAP`, …) are each asserted by a test in `data/`. A generator
  change that quietly flattens one must fail the suite, not silently weaken every
  demo in the README.
- **Infeasible configurations** (a capacity that cannot be met, exclusions that leave
  a cell with no eligible rep) must produce a **named refusal**, never a crash and
  never a silently dropped constraint.

## Cut order

Fixed in advance in `PLAN.md`. Cut from the bottom: plain-English guide → CSV export
→ stability re-optimization → frontier scatter → constraint cost attribution.

**Never cut:** the certified floor, the diff, the three-axes-never-summed rule, the
rule round-trip, or the sweep.

## Workflow

Push to `main` after every completed task in `PLAN.md`'s implementation task order.
Deployment is Vercel; `main` is production; there are no environment variables and no
runtime network calls.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
