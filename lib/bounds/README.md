# The certified floor

Four lower bounds on the **maximum rep load**, each provable in a line, none of
them derived from a search. `floor = (max(bounds) − ideal) / ideal`.

| bound | statement | why it holds |
|---|---|---|
| `ideal` | `total / m` | pigeonhole — somebody carries at least the mean |
| `cell` | `max_c ( w(c) + min_{r eligible for c} committed_r )` | a cell is indivisible, so it lands whole on some eligible rep, who is already carrying whatever their exceptions committed |
| `pair` | `w[m] + w[m+1]`, cells sorted descending | the `m+1` largest cells cannot each have a rep to themselves, so two share one |
| `forced` | max of: any rep's committed load; `(Σw(C) + Σ_{r∈S} committed_r) / |S|` for a cell set `C` only `S` may take; `total − (m−1)·capacity.max` on the count axis | each is a direct statement about what the constraints have already decided |

## Two things this module must never do

**Import `lib/optimize`.** A bound that can see the search is a result, and
reporting a result as a bound is the move this repo exists to refuse. Asserted by
a test that greps the directory, not by good intentions.

**Claim the gap.** The distance between the floor and the best plan found is
printed and labelled *unknown*. Nothing here knows whether a better plan lives in
it.

## A counter-intuitive consequence, kept rather than smoothed over

Adding a constraint can **lower** the certified floor. Protection lifts accounts
out of the lattice as exceptions, and an account that has left the lattice is no
longer part of an indivisible block — so at granularity 1 on the demo corpus,
turning protection on drops the pipeline floor from 136% to 52%.

That is not a bug and it is not charged as a saving. The cost attribution reports
`floorWith` and `floorWithout` side by side and clamps `cost` at zero, so a
constraint is never billed for a residual it did not cause, and never credited
for one either.
