import { DEFAULT_UNIVERSE_ID, listUniverses, requireUniverse } from "@/data";
import { artifactFor } from "@/data/artifacts";
import { formatRule } from "@/lib/cells";
import {
  AXES,
  GRANULARITY_LEVELS,
  defaultConfig,
  type Axis,
  type Config,
  type GranularityLevel,
  type TerritoryRule,
} from "@/lib/domain";
import { floorOf } from "@/lib/bounds";
import { buildPlan } from "@/lib/optimize";
import { decodeConfig } from "@/lib/permalink";
import { prepare } from "@/lib/setup";
import { ClaimBar, HatchDefs, RepBar } from "./console/bars";
import { Controls } from "./console/controls";
import { Frontier } from "./console/frontier";
import {
  AXIS_TITLE,
  BINDING_PHRASE,
  BOUND_CLAIM,
  BOUND_TITLE,
  CONSTRAINT_TITLE,
  REFUSAL_TITLE,
  count,
  pct,
  usd,
} from "./console/format";

export const metadata = {
  title: "Territory Builder",
  description:
    "Balance an account universe into sales territories — and certify the imbalance that was never available, instead of apologising for it.",
};

type Props = { searchParams: Promise<{ c?: string }> };

export default async function Page({ searchParams }: Props) {
  const params = await searchParams;
  const config: Config = decodeConfig(params.c) ?? defaultConfig(DEFAULT_UNIVERSE_ID);
  const universe = requireUniverse(config.universeId);
  const result = buildPlan(universe, config);

  const namedAccountIds = universe.accounts
    .filter((account) => account.isNamed)
    .slice(0, 8)
    .map((account) => account.id);
  const enterpriseHalf = universe.reps
    .slice(Math.ceil(universe.reps.length / 2))
    .map((rep) => rep.id);

  const controls = (
    <Controls
      config={config}
      universes={listUniverses().map((u) => ({ id: u.id, label: u.label }))}
      namedAccountIds={namedAccountIds}
      enterpriseHalf={enterpriseHalf}
    />
  );

  if (result.kind === "infeasible") {
    return (
      <main>
        <TitleBlock config={config} label={universe.label} />
        {controls}
        <div className="refusal">
          <span className="k">Refused · {result.reason}</span>
          <p style={{ fontSize: "var(--step-3)", letterSpacing: "-0.02em" }}>
            {REFUSAL_TITLE[result.reason] ?? "This configuration cannot be satisfied"}
          </p>
          <p style={{ color: "var(--muted)" }}>{result.detail}</p>
        </div>
        <p className="note">
          Nothing was dropped to get here. A constraint the model cannot honour is an
          answer, and the tool would rather say so than hand back a plan that quietly
          ignored it.
        </p>
      </main>
    );
  }

  const plan = result.plan;
  const repName = new Map(universe.reps.map((rep) => [rep.id, rep.name]));
  const accountName = new Map(
    universe.accounts.map((account) => [account.id, account.name]),
  );
  const byId = new Map(universe.accounts.map((account) => [account.id, account]));

  const totals = {
    count: universe.accounts.length,
    potential: universe.accounts.reduce((sum, a) => sum + a.potentialUsd, 0),
    pipeline: universe.accounts.reduce((sum, a) => sum + a.openPipelineUsd, 0),
  } as Record<Axis, number>;

  const artifact = artifactFor(config.universeId, config.granularity);
  const defaults = defaultConfig(config.universeId);
  const constraintsChanged =
    JSON.stringify(config.constraints) !== JSON.stringify(defaults.constraints);

  // The granularity curve: cheap enough to compute live, and the second thing
  // the tool exists to show.
  const curve = GRANULARITY_LEVELS.map((granularity) => {
    const levelConfig = { ...config, granularity };
    const prep = prepare(universe, levelConfig);
    if (prep.kind === "infeasible") {
      return { granularity, cells: 0, floor: null, terms: null };
    }

    // Terms per rule is the readability axis, and it is the one number that
    // makes "a rule a rep can recite" checkable rather than aspirational.
    const levelPlan = buildPlan(universe, levelConfig);
    const terms =
      levelPlan.kind === "plan"
        ? Math.round(
            levelPlan.plan.territories.reduce(
              (sum, territory) => sum + territory.rule.include.length,
              0,
            ) / levelPlan.plan.territories.length,
          )
        : null;

    return {
      granularity,
      cells: prep.cells.length,
      floor: floorOf(prep, levelConfig).potential.floor,
      terms,
    };
  });

  return (
    <main>
      <HatchDefs />
      <TitleBlock config={config} label={universe.label} plan={plan} />
      {controls}

      {/* ---------------------------------------------------------------- */}
      <section className="section" id="claim">
        <header>
          <h2>The claim</h2>
          <p>
            Three numbers, never two. The third one is the one nobody prints.
          </p>
        </header>

        {AXES.map((axis) => {
          const bounds = plan.floor.perAxis[axis];
          const gap = plan.imbalance[axis] - bounds.floor;

          return (
            <div key={axis} style={{ marginBottom: "1.75rem" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: "1rem",
                  marginBottom: "0.3rem",
                }}
              >
                <span
                  style={{
                    fontSize: "var(--step-0)",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--faint)",
                  }}
                >
                  {AXIS_TITLE[axis]}
                </span>
                <span className="mono" style={{ fontSize: "var(--step-1)" }}>
                  <span style={{ color: "var(--oxide)" }}>{pct(bounds.floor)} unreachable</span>
                  <span style={{ color: "var(--faint)" }}> · </span>
                  <span style={{ color: "var(--faint)" }}>{pct(gap)} unknown</span>
                  <span style={{ color: "var(--faint)" }}> · </span>
                  <span>{pct(plan.imbalance[axis])} achieved</span>
                </span>
              </div>
              <ClaimBar floor={bounds.floor} achieved={plan.imbalance[axis]} />
              <div className="bar-axis mono">
                <span>an equal share</span>
                <span>
                  {BINDING_PHRASE[bounds.binding]}
                </span>
              </div>
            </div>
          );
        })}

        <div className="claim">
          <div>
            <span className="k">Pipeline that changes hands</span>
            <div className="v mono" style={{ color: "var(--moved)" }}>
              {pct(plan.churn.pipelineMovedFraction, 0)}
            </div>
            <p className="d">
              {usd(plan.churn.pipelineMovedUsd)} of open pipeline moves owner mid-flight,
              across {count(plan.churn.accountsMoved)} accounts.
            </p>
          </div>
          <div>
            <span className="k">Churn nobody chose</span>
            <div className="v mono" style={{ color: "var(--oxide)" }}>
              {pct(plan.floor.churn.fraction, 0)}
            </div>
            <p className="d">
              The book on the ground is not expressible as a rule, so this much moves
              before the optimizer states a single preference.
            </p>
          </div>
          <div className="unknown">
            <span className="k">Owner retention if re-run</span>
            <div className="v mono">
              {artifact && !constraintsChanged ? pct(artifact.stability.ownerRetention, 0) : "—"}
            </div>
            <p className="d">
              {artifact && !constraintsChanged
                ? "Share of accounts keeping this owner when the potential estimates are re-drawn inside their own error bands."
                : "Precomputed for the default constraint set only."}
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="section" id="carve">
        <header>
          <h2>Carve</h2>
          <p>
            {plan.territories.length} territories from{" "}
            {count(Object.keys(plan.cellAssignment).length)} cells. Each rule was rendered
            from the cells and evaluated back against the universe; the account sets match
            exactly.
          </p>
        </header>

        {plan.territories.map((territory) => {
          const scaleMax = Math.max(
            ...plan.territories.map((t) => Math.max(t.load.count, 0)),
          );
          return (
            <div className="rep" key={territory.repId}>
              <div className="who">
                {repName.get(territory.repId)}
                <span className="id mono">{territory.repId}</span>
              </div>
              <div>
                <RuleText
                  territory={territory}
                  level={config.granularity}
                  nameOf={(id) => accountName.get(id) ?? id}
                />
                <div className="rep-bars">
                  {AXES.map((axis) => (
                    <RepBar
                      key={axis}
                      label={AXIS_TITLE[axis]}
                      load={territory.load[axis]}
                      ideal={totals[axis] / universe.reps.length}
                      scaleMax={
                        axis === "count"
                          ? scaleMax
                          : Math.max(...plan.territories.map((t) => t.load[axis]))
                      }
                      value={
                        axis === "count"
                          ? count(territory.load.count)
                          : usd(territory.load[axis])
                      }
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}

        <p className="note">
          Verdigris is at or under an equal share; ochre is over it. The tick is the
          share every rep would carry if the universe were smooth.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="section" id="diff">
        <header>
          <h2>Diff</h2>
          <p>Where the book goes. Rows are today&apos;s owner, columns are the plan&apos;s.</p>
        </header>

        <div className="scroll">
          <table className="matrix mono">
            <thead>
              <tr>
                <th scope="col" />
                {universe.reps.map((rep) => (
                  <th key={rep.id} scope="col">
                    {rep.id.replace("rep-", "")}
                  </th>
                ))}
                <th scope="col">held</th>
              </tr>
            </thead>
            <tbody>
              {universe.reps.map((from) => {
                const row = universe.reps.map((to) =>
                  universe.accounts
                    .filter((account) => {
                      if (account.currentOwnerId !== from.id) return false;
                      const territory = plan.territories.find((t) =>
                        t.accountIds.includes(account.id),
                      );
                      return territory?.repId === to.id;
                    })
                    .reduce((sum, account) => sum + account.openPipelineUsd, 0),
                );
                const held = row[universe.reps.indexOf(from)] ?? 0;
                const total = row.reduce((sum, value) => sum + value, 0);

                return (
                  <tr key={from.id}>
                    <th scope="row">{repName.get(from.id)}</th>
                    {row.map((value, index) => (
                      <td
                        key={index}
                        className={
                          universe.reps[index]!.id === from.id
                            ? "held"
                            : value === 0
                              ? "zero"
                              : undefined
                        }
                        style={
                          universe.reps[index]!.id !== from.id && value > 0
                            ? {
                                background: `color-mix(in srgb, var(--moved) ${Math.min(
                                  55,
                                  (value / Math.max(total, 1)) * 90,
                                )}%, transparent)`,
                              }
                            : undefined
                        }
                      >
                        {value === 0 ? "·" : usd(value)}
                      </td>
                    ))}
                    <td className="held">
                      {total === 0 ? "—" : pct(held / total, 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <BiggestMoves plan={plan} byId={byId} repName={repName} />
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="section" id="floor">
        <header>
          <h2>Floor</h2>
          <p>Four bounds, all arithmetic, none of them from a search.</p>
        </header>

        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Bound</th>
                <th>Claim</th>
                {AXES.map((axis) => (
                  <th key={axis} className="num">
                    {AXIS_TITLE[axis]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(["ideal", "cell", "pair", "forced"] as const).map((name) => (
                <tr
                  key={name}
                  className={
                    AXES.some((axis) => plan.floor.perAxis[axis].binding === name)
                      ? "binding"
                      : undefined
                  }
                >
                  <td>{BOUND_TITLE[name]}</td>
                  <td className="dim">{BOUND_CLAIM[name]}</td>
                  {AXES.map((axis) => {
                    const bounds = plan.floor.perAxis[axis];
                    const value = bounds.bounds[name];
                    const asImbalance = (value - bounds.ideal) / bounds.ideal;
                    return (
                      <td key={axis} className="num mono">
                        {value === 0
                          ? "—"
                          : name === "ideal"
                            ? "0.0%"
                            : pct(Math.max(0, asImbalance))}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 600 }}>certified floor</td>
                <td className="dim">The largest of the four.</td>
                {AXES.map((axis) => (
                  <td key={axis} className="num mono" style={{ color: "var(--oxide)" }}>
                    {pct(plan.floor.perAxis[axis].floor)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>achieved</td>
                <td className="dim">This plan.</td>
                {AXES.map((axis) => (
                  <td key={axis} className="num mono">
                    {pct(plan.imbalance[axis])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <p className="note">
          The distance between the last two rows is unknown. Not small, not
          near-optimal — unknown. Nothing in this tool can tell you whether a better
          plan lives in it.
        </p>

        <h3
          style={{
            fontSize: "var(--step-1)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--faint)",
            marginTop: "2.25rem",
            marginBottom: "0.75rem",
            fontWeight: 400,
          }}
        >
          What each constraint costs
        </h3>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Constraint</th>
                <th>Status</th>
                {AXES.map((axis) => (
                  <th key={axis} className="num">
                    {AXIS_TITLE[axis]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plan.floor.costs.map((cost) => (
                <tr key={cost.constraint}>
                  <td>{CONSTRAINT_TITLE[cost.constraint]}</td>
                  <td className="dim">{cost.active ? "on" : "off"}</td>
                  {AXES.map((axis) => (
                    <td key={axis} className="num mono">
                      {!cost.active
                        ? "—"
                        : cost.cost[axis] === 0
                          ? "free"
                          : `+${pct(cost.cost[axis])}`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          Free means the universe was already forcing at least that much residual, so
          the constraint is not charged for it. A constraint can even lower the floor:
          protected accounts leave the lattice, and an account that has left is no
          longer part of an indivisible block.
        </p>

        <h3
          style={{
            fontSize: "var(--step-1)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--faint)",
            marginTop: "2.25rem",
            marginBottom: "0.75rem",
            fontWeight: 400,
          }}
        >
          Readability against reachability
        </h3>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Granularity</th>
                <th>Cut along</th>
                <th className="num">Cells</th>
                <th className="num">Terms per rule</th>
                <th className="num">Potential floor</th>
                <th className="num">Retention if re-run</th>
              </tr>
            </thead>
            <tbody>
              {curve.map((row) => {
                const levelArtifact = artifactFor(config.universeId, row.granularity);
                return (
                  <tr
                    key={row.granularity}
                    className={row.granularity === config.granularity ? "binding" : undefined}
                  >
                    <td className="mono">L{row.granularity}</td>
                    <td className="dim">
                      {["industry", "region", "segment", "employeeBand"]
                        .slice(0, row.granularity)
                        .join(" × ")}
                    </td>
                    <td className="num mono">{row.cells === 0 ? "—" : count(row.cells)}</td>
                    <td className="num mono">{row.terms === null ? "—" : row.terms}</td>
                    <td className="num mono" style={{ color: "var(--oxide)" }}>
                      {row.floor === null ? "refused" : pct(row.floor)}
                    </td>
                    <td className="num mono">
                      {levelArtifact && !constraintsChanged
                        ? pct(levelArtifact.stability.ownerRetention, 0)
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note">
          Read the middle two columns together. A one-term rule is a sentence a rep can
          repeat back; a thirty-term rule is a document nobody reads, and the difference
          between them is what buying the last points of balance costs. The right-hand
          column is the twist: the levels that balance best are the least stable,
          because once everything is reachable, nothing forces the choice between one
          plan and another.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      {artifact && (
        <section className="section" id="frontier">
          <header>
            <h2>Frontier</h2>
            <p>Thirty-two weight vectors, one plan each. Click one to load it.</p>
          </header>
          <Frontier
            points={artifact.frontier.points}
            config={config}
            stale={constraintsChanged}
          />
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {artifact && !constraintsChanged && (
        <section className="section" id="stability">
          <header>
            <h2>Stability</h2>
            <p>What the balance claim is worth once the estimates are allowed to wobble.</p>
          </header>

          <div className="claim">
            <div>
              <span className="k">Potential imbalance, p5–p95</span>
              <div className="v mono" style={{ fontSize: "var(--step-3)" }}>
                {pct(artifact.stability.potentialImbalance.p5)} –{" "}
                {pct(artifact.stability.potentialImbalance.p95)}
              </div>
              <p className="d">
                The same plan, re-scored {artifact.stability.draws.intervals} times with
                every estimate re-drawn inside its own band. The point number on screen is
                the middle of this.
              </p>
            </div>
            <div>
              <span className="k">Worst-loaded rep survives</span>
              <div className="v mono" style={{ fontSize: "var(--step-3)" }}>
                {pct(artifact.stability.worstRepSurvival, 0)}
              </div>
              <p className="d">
                How often {repName.get(artifact.stability.worstRepId) ?? "the same rep"} is
                still the one carrying too much. Below 100%, the sentence &ldquo;X is
                overloaded&rdquo; is not a finding.
              </p>
            </div>
            <div>
              <span className="k">Owner retention, re-optimized</span>
              <div className="v mono" style={{ fontSize: "var(--step-3)" }}>
                {pct(artifact.stability.ownerRetention, 0)}
              </div>
              <p className="d">
                {artifact.stability.draws.stability} full re-runs under perturbed
                estimates. Everything else is one sample from a distribution of plans.
              </p>
            </div>
          </div>

          <p className="note">
            The random-carve baseline for this universe and granularity is{" "}
            <span className="mono">
              {pct(artifact.baseline.medianPotentialImbalance)}
            </span>{" "}
            median potential imbalance over {artifact.baseline.draws} draws, against a
            certified floor of{" "}
            <span className="mono">{pct(plan.floor.perAxis.potential.floor)}</span>.
            {plan.floor.perAxis.potential.floor === 0
              ? " The floor is zero here: hitting any target says nothing about this universe."
              : " The floor is not zero here: part of the residual was never available."}
          </p>
        </section>
      )}

      <footer
        style={{
          marginTop: "5rem",
          paddingTop: "1.25rem",
          borderTop: "1px solid var(--line)",
          color: "var(--faint)",
          fontSize: "var(--step-0)",
          display: "flex",
          gap: "1.5rem",
          flexWrap: "wrap",
        }}
      >
        <span>Day 016 of a 100-day building challenge</span>
        <a href="https://github.com/akshatiwarix/territory-builder" style={{ color: "var(--kept)" }}>
          Source
        </a>
        <a href="/api/schema" style={{ color: "var(--kept)" }}>
          API
        </a>
        <span>Synthetic corpus, fixed seed, zero model calls.</span>
      </footer>
    </main>
  );
}

function TitleBlock({
  config,
  label,
  plan,
}: {
  config: Config;
  label: string;
  plan?: { search: { restarts: number; iterations: number }; cellAssignment: Record<string, string> };
}) {
  return (
    <div className="titleblock">
      <div>
        <h1>Territory&nbsp;Builder</h1>
        <p className="sub">
          Balance an account universe into sales territories — and certify the imbalance
          that was never available, instead of apologising for it.
        </p>
      </div>
      <dl className="specs mono">
        <dt>Universe</dt>
        <dd>{label.split(" —")[0]}</dd>
        <dt>Granularity</dt>
        <dd>L{config.granularity}</dd>
        <dt>Cells</dt>
        <dd>{plan ? Object.keys(plan.cellAssignment).length : "—"}</dd>
        <dt>Seed</dt>
        <dd>{config.seed}</dd>
        <dt>Restarts</dt>
        <dd>{plan?.search.restarts ?? config.restarts}</dd>
        <dt>Steps</dt>
        <dd>{plan?.search.iterations ?? "—"}</dd>
      </dl>
    </div>
  );
}

const RULE_PREVIEW = 5;

/**
 * A rule, with its length stated first.
 *
 * The term count is the honest readability metric, and at the default
 * granularity it is around twenty — which is the granularity trap arriving in
 * person. Printing all of it inline would bury the page, and hiding it would
 * flatter the tool, so the count leads and the text opens on request.
 */
function RuleText({
  territory,
  level,
  nameOf,
}: {
  territory: { rule: TerritoryRule };
  level: GranularityLevel;
  nameOf: (id: string) => string;
}) {
  const terms = territory.rule.include.length;
  const exceptions = territory.rule.plus.length + territory.rule.minus.length;
  const full = formatRule(territory.rule, level, nameOf);
  const preview = formatRule(
    { ...territory.rule, include: territory.rule.include.slice(0, RULE_PREVIEW), plus: [], minus: [] },
    level,
    nameOf,
  );

  return (
    <div className="rule">
      <div className="rule-meta mono">
        <span>{terms === 1 ? "1 term" : `${terms} terms`}</span>
        {exceptions > 0 && <span>{exceptions} by name</span>}
      </div>
      {terms <= RULE_PREVIEW && exceptions === 0 ? (
        <p className="mono rule-body">{full}</p>
      ) : (
        <details>
          <summary className="mono rule-body">
            {preview}
            {terms > RULE_PREVIEW ? `, and ${terms - RULE_PREVIEW} more` : ""}
          </summary>
          <p className="mono rule-body rule-full">{full}</p>
        </details>
      )}
    </div>
  );
}

function BiggestMoves({
  plan,
  byId,
  repName,
}: {
  plan: { territories: Array<{ repId: string; accountIds: string[] }> };
  byId: Map<string, { id: string; name: string; openPipelineUsd: number; openOppStage: string | null; currentOwnerId: string; tenureDays: number }>;
  repName: Map<string, string>;
}) {
  const ownerOf = new Map<string, string>();
  for (const territory of plan.territories) {
    for (const id of territory.accountIds) ownerOf.set(id, territory.repId);
  }

  const moves = [...byId.values()]
    .filter((account) => ownerOf.get(account.id) !== account.currentOwnerId)
    .sort((a, b) => b.openPipelineUsd - a.openPipelineUsd)
    .slice(0, 8);

  if (moves.length === 0) return null;

  return (
    <>
      <h3
        style={{
          fontSize: "var(--step-1)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--faint)",
          marginTop: "2.25rem",
          marginBottom: "0.75rem",
          fontWeight: 400,
        }}
      >
        The eight most expensive moves
      </h3>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>From</th>
              <th>To</th>
              <th className="num">Open pipeline</th>
              <th>Stage</th>
              <th className="num">Years owned</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((account) => (
              <tr key={account.id}>
                <td>{account.name}</td>
                <td className="dim">{repName.get(account.currentOwnerId)}</td>
                <td>{repName.get(ownerOf.get(account.id) ?? "")}</td>
                <td className="num mono" style={{ color: "var(--moved)" }}>
                  {usd(account.openPipelineUsd)}
                </td>
                <td className="dim">{account.openOppStage ?? "—"}</td>
                <td className="num mono">{(account.tenureDays / 365).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        These are the rows that get argued about. Counting accounts moved would have
        scored them the same as {moves.length} dormant ones.
      </p>
    </>
  );
}
