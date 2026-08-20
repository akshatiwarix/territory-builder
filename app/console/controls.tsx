"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Config, GranularityLevel, Stage, Universe } from "@/lib/domain";
import { encodeConfig } from "@/lib/permalink";

const WEIGHT_LABELS = {
  count: "Accounts",
  potential: "Potential",
  pipeline: "Pipeline",
  churn: "Keep books",
} as const;

type Props = {
  config: Config;
  universes: Array<Pick<Universe, "id" | "label">>;
  namedAccountIds: string[];
  enterpriseHalf: string[];
};

/**
 * Every control writes to the permalink, and the permalink is the only state.
 * There is no local plan cache to fall out of step with the URL, and a link
 * pasted into Slack reproduces the carve exactly.
 */
export function Controls({ config, universes, namedAccountIds, enterpriseHalf }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  function apply(next: Config) {
    startTransition(() => {
      router.push(`/?c=${encodeConfig(next)}`, { scroll: false });
    });
  }

  const setWeight = (key: keyof Config["weights"], value: number) =>
    apply({ ...config, weights: { ...config.weights, [key]: value } });

  const setConstraints = (patch: Partial<Config["constraints"]>) =>
    apply({ ...config, constraints: { ...config.constraints, ...patch } });

  const pinned = Object.keys(config.constraints.pinned).length > 0;
  const excluded = config.constraints.exclusions.length > 0;

  return (
    <div className="controls" data-pending={pending}>
      <div className="control">
        <span className="k">Universe</span>
        <div className="segmented">
          {universes.map((universe) => (
            <button
              key={universe.id}
              type="button"
              aria-pressed={config.universeId === universe.id}
              onClick={() =>
                apply({
                  ...config,
                  universeId: universe.id,
                  constraints: { ...config.constraints, pinned: {}, exclusions: [] },
                })
              }
            >
              {universe.label.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>

      <div className="control">
        <span className="k">Granularity</span>
        <div className="segmented">
          {([1, 2, 3, 4] as GranularityLevel[]).map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={config.granularity === level}
              onClick={() => apply({ ...config, granularity: level })}
            >
              L{level}
            </button>
          ))}
        </div>
      </div>

      <div className="control">
        <span className="k">Weights</span>
        {(Object.keys(WEIGHT_LABELS) as Array<keyof typeof WEIGHT_LABELS>).map((key) => (
          <label className="slider" key={key}>
            <span>{WEIGHT_LABELS[key]}</span>
            <input
              type="range"
              min={0}
              max={8}
              step={0.5}
              value={config.weights[key]}
              onChange={(event) => setWeight(key, Number(event.target.value))}
            />
            <span className="v mono">{config.weights[key].toFixed(1)}</span>
          </label>
        ))}
      </div>

      <div className="control">
        <span className="k">Constraints</span>
        <label className="toggle">
          <input
            type="checkbox"
            checked={config.constraints.protectStage !== null}
            onChange={(event) =>
              setConstraints({
                protectStage: event.target.checked ? ("negotiation" as Stage) : null,
              })
            }
          />
          Protect late-stage deals
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={config.constraints.capacity !== null}
            onChange={(event) =>
              setConstraints({
                capacity: event.target.checked ? { min: 180, max: 400 } : null,
              })
            }
          />
          Capacity 180–400 accounts
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(event) =>
              setConstraints({
                pinned: event.target.checked
                  ? Object.fromEntries(
                      namedAccountIds.map((id, index) => [
                        id,
                        `rep-0${(index % 4) + 1}`,
                      ]),
                    )
                  : {},
              })
            }
          />
          Pin named accounts
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={excluded}
            onChange={(event) =>
              setConstraints({
                exclusions: event.target.checked
                  ? enterpriseHalf.map((repId) => ({
                      repId,
                      dimension: "segment" as const,
                      value: "Enterprise",
                    }))
                  : [],
              })
            }
          />
          Enterprise-qualified reps only
        </label>
      </div>

      <div className="linkbar">
        <a href={`/api/v1/plan/csv?c=${encodeConfig(config)}`}>Download CSV</a>
        <a href="/api/schema">API schema</a>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(window.location.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? "Link copied" : "Copy permalink"}
        </button>
      </div>
    </div>
  );
}
