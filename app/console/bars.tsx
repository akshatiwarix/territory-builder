import { pct } from "./format";

/**
 * Surveyor's notation, used as data encoding.
 *
 * A plat hatches the land you cannot build on. This console hatches the
 * imbalance you cannot reach, and outlines the stretch between the certified
 * floor and the plan actually found as an open void — because nothing knows
 * whether a better plan lives in it, and filling it in would be a claim.
 */

export function HatchDefs() {
  return (
    <svg width="0" height="0" aria-hidden style={{ position: "absolute" }}>
      <defs>
        <pattern
          id="hatch-oxide"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" fill="rgba(160,85,85,0.16)" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#a05555" strokeWidth="1.6" />
        </pattern>
      </defs>
    </svg>
  );
}

type ClaimBarProps = {
  floor: number;
  achieved: number;
};

/**
 * The whole argument on one line.
 *
 * Plotted in imbalance rather than in absolute load: the origin is an equal
 * share, the hatched stretch is the region no plan can end before, and the
 * outlined stretch is the distance nothing has ruled out. Drawing absolute loads
 * instead would spend nine tenths of the width on the part everyone agrees about
 * and squash the argument into the right edge.
 *
 * When the hatch runs the full width, the residual was never available and there
 * is nothing left to optimize. When the outline does, the tool does not know
 * what it is looking at, and says so.
 */
export function ClaimBar({ floor, achieved }: ClaimBarProps) {
  const scale = Math.max(achieved, floor, 0.001);
  const floorX = (Math.max(0, floor) / scale) * 100;
  const achievedX = (Math.max(0, achieved) / scale) * 100;

  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      width="100%"
      height={30}
      role="img"
      aria-label={`${pct(floor)} unreachable, ${pct(
        Math.max(0, achieved - floor),
      )} unknown, ${pct(achieved)} achieved`}
    >
      {/* the region the busiest book cannot end before */}
      {floorX > 0.4 && (
        <rect x="0" y="4" width={floorX} height="22" fill="url(#hatch-oxide)" />
      )}

      {/* unknown: outlined, never filled, because nothing here is known */}
      {achievedX > floorX + 0.4 && (
        <rect
          x={floorX}
          y="4"
          width={achievedX - floorX}
          height="22"
          fill="none"
          stroke="#5c7580"
          strokeWidth="1"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/* an equal share, and where this plan actually landed */}
      <line
        x1="0"
        y1="0"
        x2="0"
        y2="30"
        stroke="#8aa3ab"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={achievedX}
        y1="0"
        x2={achievedX}
        y2="30"
        stroke="#e8f0f1"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

type RepBarProps = {
  load: number;
  ideal: number;
  scaleMax: number;
  label: string;
  value: string;
};

/** A rep's book against an equal share. Deliberately plain: the hatch is spent. */
export function RepBar({ load, ideal, scaleMax, label, value }: RepBarProps) {
  const width = Math.min(100, (load / scaleMax) * 100);
  const idealX = Math.min(100, (ideal / scaleMax) * 100);
  const over = load > ideal;

  return (
    <div className="bar">
      <div className="label">
        <span>{label}</span>
        <span className="num mono">{value}</span>
      </div>
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" width="100%" height="10" aria-hidden>
        <rect x="0" y="3" width="100" height="4" fill="rgba(232,240,241,0.07)" />
        <rect
          x="0"
          y="3"
          width={width}
          height="4"
          fill={over ? "var(--moved)" : "var(--kept)"}
        />
        <line
          x1={idealX}
          y1="0"
          x2={idealX}
          y2="10"
          stroke="#8aa3ab"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
