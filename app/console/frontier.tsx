"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FrontierPoint } from "@/lib/analysis/frontier";
import type { Config } from "@/lib/domain";
import { encodeConfig } from "@/lib/permalink";
import { pct, usd } from "./format";

type Props = {
  points: FrontierPoint[];
  config: Config;
  stale: boolean;
};

/**
 * Thirty-two plans, plotted where they actually sit.
 *
 * The console refuses to collapse the axes into a score, and this is what makes
 * that refusal usable rather than merely principled: the tradeoff is a shape you
 * can point at. Clicking a plan loads it — the weight vector is a position on
 * this picture, never a rating of it.
 */
export function Frontier({ points, config, stale }: Props) {
  const router = useRouter();
  const [hovered, setHovered] = useState<FrontierPoint | null>(null);

  const width = 720;
  const height = 320;
  const pad = { left: 54, right: 18, top: 16, bottom: 42 };

  // Scaled to the plans worth choosing between. A single badly dominated plan at
  // 234% imbalance would otherwise flatten the entire frontier into one row of
  // dots, hiding the tradeoff this chart exists to show. Outliers are clamped to
  // the top edge and drawn hollow rather than dropped.
  const kept = points.filter((p) => !p.dominated);
  const scaleSet = kept.length > 1 ? kept : points;
  const xMax = Math.max(...points.map((p) => p.churnPipelineFraction), 0.01) * 1.08;
  const yMax = Math.max(...scaleSet.map((p) => p.imbalance.potential), 0.01) * 1.15;

  const px = (value: number) =>
    pad.left + (value / xMax) * (width - pad.left - pad.right);
  const py = (value: number) =>
    height - pad.bottom - (Math.min(value, yMax) / yMax) * (height - pad.top - pad.bottom);
  const clipped = (value: number) => value > yMax;

  const sizeOf = (point: FrontierPoint) =>
    3.2 + Math.min(6, point.imbalance.count * 14);

  const current = points.find(
    (point) =>
      point.weights.count === config.weights.count &&
      point.weights.potential === config.weights.potential &&
      point.weights.pipeline === config.weights.pipeline &&
      point.weights.churn === config.weights.churn,
  );

  return (
    <div>
      <div className="scroll">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          style={{ minWidth: 520, display: "block" }}
          role="img"
          aria-label="Potential imbalance against pipeline churn, one point per weight vector"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1={pad.left}
                y1={py(yMax * fraction)}
                x2={width - pad.right}
                y2={py(yMax * fraction)}
                stroke="#2a4149"
                strokeWidth="1"
              />
              <text
                x={pad.left - 8}
                y={py(yMax * fraction) + 4}
                textAnchor="end"
                fill="#5c7580"
                fontSize="11"
                fontFamily="var(--font-mono)"
              >
                {pct(yMax * fraction, 0)}
              </text>
            </g>
          ))}

          {[0, 0.5, 1].map((fraction) => (
            <text
              key={fraction}
              x={px(xMax * fraction)}
              y={height - pad.bottom + 18}
              textAnchor="middle"
              fill="#5c7580"
              fontSize="11"
              fontFamily="var(--font-mono)"
            >
              {pct(xMax * fraction, 0)}
            </text>
          ))}

          <text
            x={pad.left}
            y={height - 8}
            fill="#8aa3ab"
            fontSize="11"
            letterSpacing="0.1em"
          >
            PIPELINE THAT CHANGES HANDS →
          </text>
          <text
            x={-pad.top - 4}
            y={14}
            fill="#8aa3ab"
            fontSize="11"
            letterSpacing="0.1em"
            transform="rotate(-90)"
            textAnchor="end"
          >
            POTENTIAL IMBALANCE →
          </text>

          {points.map((point, index) => (
            <circle
              key={index}
              className="frontier-dot"
              cx={px(point.churnPipelineFraction)}
              cy={py(point.imbalance.potential)}
              r={sizeOf(point)}
              fill={
                clipped(point.imbalance.potential)
                  ? "none"
                  : point.dominated
                    ? "rgba(138,163,171,0.28)"
                    : "var(--kept)"
              }
              stroke={
                point === current
                  ? "#e8f0f1"
                  : clipped(point.imbalance.potential)
                    ? "rgba(138,163,171,0.5)"
                    : "none"
              }
              strokeWidth={point === current ? 2 : clipped(point.imbalance.potential) ? 1 : 0}
              onMouseEnter={() => setHovered(point)}
              onMouseLeave={() => setHovered(null)}
              onClick={() =>
                router.push(`/?c=${encodeConfig({ ...config, weights: point.weights })}`, {
                  scroll: false,
                })
              }
            />
          ))}
        </svg>
      </div>

      <div className="legend">
        <span>
          <i className="swatch" style={{ background: "var(--kept)" }} /> not dominated
        </span>
        <span>
          <i className="swatch" style={{ background: "rgba(138,163,171,0.28)" }} /> another
          plan beats it on every axis
        </span>
        <span>
          <i
            className="swatch"
            style={{ background: "none", borderColor: "rgba(138,163,171,0.5)" }}
          />{" "}
          worse than the axis shows
        </span>
        <span>dot size = account-count imbalance</span>
      </div>

      <p className="note mono">
        {hovered
          ? `potential ${pct(hovered.imbalance.potential)} · accounts ${pct(
              hovered.imbalance.count,
            )} · pipeline ${pct(hovered.imbalance.pipeline)} · churn ${usd(
              hovered.churnPipelineUsd,
            )} (${pct(hovered.churnPipelineFraction)}) · weights ${hovered.weights.count}/${
              hovered.weights.potential
            }/${hovered.weights.pipeline}/${hovered.weights.churn}`
          : "Hover a plan for its four numbers. Click to load it."}
      </p>

      {stale && (
        <p className="note">
          Computed with the default constraint set. You have changed a constraint, so
          these thirty-two plans no longer describe the carve above.
        </p>
      )}
    </div>
  );
}
