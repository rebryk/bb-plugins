import type { ReactNode } from "react";
import { memoryPercent, tint } from "./icons";
import type { CardStyle, Sample } from "./shared";

type Reading = { label: string; percent: number | null };
type Indicator = (reading: Reading) => ReactNode;

const readings = (sample: Sample): Reading[] => [
  { label: "CPU", percent: sample.cpu.percent },
  { label: "RAM", percent: memoryPercent(sample) },
  { label: "GPU", percent: sample.gpu?.percent ?? null },
];

const fill = (percent: number | null) => Math.min(percent ?? 0, 100);

function Value({ percent }: { percent: number | null }) {
  return (
    <span
      className="rm-value"
      style={{ color: percent === null ? undefined : tint(percent) }}
    >
      {percent === null ? "—" : `${Math.round(percent)}%`}
    </span>
  );
}

const bar: Indicator = ({ percent }) => (
  <>
    <span className="rm-vbar">
      <i style={{ height: `${fill(percent)}%`, background: tint(percent ?? 0) }} />
    </span>
    <Value percent={percent} />
  </>
);

const ring: Indicator = ({ percent }) => (
  <span className="rm-ring">
    <svg viewBox="0 0 36 36" aria-hidden>
      <circle cx={18} cy={18} r={15} className="rm-track" />
      <circle
        cx={18}
        cy={18}
        r={15}
        pathLength={100}
        strokeDasharray={`${fill(percent)} 100`}
        transform="rotate(-90 18 18)"
        style={{ stroke: tint(percent ?? 0) }}
      />
    </svg>
    <Value percent={percent} />
  </span>
);

const number: Indicator = ({ percent }) => (
  <>
    <span className="rm-big">
      <Value percent={percent} />
    </span>
    <span className="rm-hbar">
      <i style={{ width: `${fill(percent)}%`, background: tint(percent ?? 0) }} />
    </span>
  </>
);

const INDICATORS: Record<CardStyle, Indicator> = {
  columns: bar,
  rings: ring,
  numbers: number,
};

/** Three columns, CPU, RAM, GPU, each with one load indicator. */
export function ResourceCard({
  style,
  samples,
}: {
  style: CardStyle;
  samples: readonly Sample[];
}) {
  const latest = samples.at(-1);
  if (latest === undefined) {
    return <div className="rm-card rm-muted">Waiting…</div>;
  }
  return (
    <div className={`rm-card rm-${style}`}>
      {readings(latest).map((reading) => (
        <div key={reading.label} className="rm-column">
          {INDICATORS[style](reading)}
          <span className="rm-label">{reading.label}</span>
        </div>
      ))}
    </div>
  );
}
