import type { ReactNode } from "react";
import type { IconStyle, Sample } from "./shared";

/** Each style draws into a 16×16 viewBox in currentColor. */
type IconDrawer = (samples: readonly Sample[]) => ReactNode;

export const memoryPercent = ({ memory }: Sample) =>
  (100 * memory.usedBytes) / memory.totalBytes;

const clamp = (value: number) => Math.min(100, Math.max(0, value));

/** High load tints the icon; normal load keeps the rail's own color. */
export function tint(percent: number): string | undefined {
  if (percent >= 95) return "var(--destructive)";
  if (percent >= 85) return "var(--warning)";
  return undefined;
}

const TRACK = 0.25;

const bars: IconDrawer = (samples) => {
  const latest = samples.at(-1);
  const levels = latest
    ? [latest.cpu.percent, memoryPercent(latest), latest.gpu?.percent ?? 0]
    : [0, 0, 0];
  return levels.map((level, index) => {
    const height = Math.max(1, (14 * clamp(level)) / 100);
    const x = 1.5 + index * 5;
    return (
      <g key={index}>
        <rect x={x} y={1} width={3} height={14} rx={1} opacity={TRACK} />
        <rect
          x={x}
          y={15 - height}
          width={3}
          height={height}
          rx={1}
          fill={tint(level)}
        />
      </g>
    );
  });
};

function Arc({ r, percent }: { r: number; percent: number }) {
  return (
    <>
      <circle cx={8} cy={8} r={r} opacity={TRACK} />
      <circle
        cx={8}
        cy={8}
        r={r}
        pathLength={100}
        strokeDasharray={`${clamp(percent)} 100`}
        strokeLinecap="round"
        transform="rotate(-90 8 8)"
        stroke={tint(percent)}
      />
    </>
  );
}

const rings: IconDrawer = (samples) => {
  const latest = samples.at(-1);
  return (
    <g fill="none" stroke="currentColor" strokeWidth={2}>
      <Arc r={6.5} percent={latest?.cpu.percent ?? 0} />
      <Arc r={3} percent={latest ? memoryPercent(latest) : 0} />
    </g>
  );
};

const spark: IconDrawer = (samples) => {
  const values = samples.slice(-30).map((sample) => sample.cpu.percent);
  if (values.length < 2) values.unshift(0, 0);
  const step = 14 / (values.length - 1);
  const points = values.map(
    (value, index) => `${1 + index * step},${15 - (13 * clamp(value)) / 100}`,
  );
  const color = tint(values.at(-1) ?? 0) ?? "currentColor";
  return (
    <>
      <path d="M1 15.25H15" stroke="currentColor" opacity={TRACK} />
      <path
        d={`M1,15 L${points.join(" L")} L15,15 Z`}
        fill={color}
        opacity={0.3}
      />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </>
  );
};

const digits: IconDrawer = (samples) => {
  const cpu = Math.round(samples.at(-1)?.cpu.percent ?? 0);
  return (
    <>
      <rect
        x={0.75}
        y={0.75}
        width={14.5}
        height={14.5}
        rx={3.5}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        opacity={0.5}
      />
      <text
        x={8}
        y={11.4}
        textAnchor="middle"
        fontSize={cpu >= 100 ? 6.5 : 9}
        fontWeight={700}
        fill={tint(cpu) ?? "currentColor"}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {cpu}
      </text>
    </>
  );
};

const chip: IconDrawer = (samples) => {
  const cpu = samples.at(-1)?.cpu.percent ?? 0;
  const height = (8 * clamp(cpu)) / 100;
  const pins = [5.5, 8, 10.5];
  return (
    <>
      <g stroke="currentColor" strokeWidth={1.25} strokeLinecap="round">
        {pins.map((at) => (
          <g key={at}>
            <path d={`M${at} 0.75V2.75M${at} 13.25V15.25`} />
            <path d={`M0.75 ${at}H2.75M13.25 ${at}H15.25`} />
          </g>
        ))}
      </g>
      <rect
        x={3.25}
        y={3.25}
        width={9.5}
        height={9.5}
        rx={2}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      />
      <rect
        x={4}
        y={12 - height}
        width={8}
        height={height}
        rx={1.25}
        fill={tint(cpu) ?? "currentColor"}
      />
    </>
  );
};

export const ICONS: Record<IconStyle, IconDrawer> = {
  bars,
  rings,
  spark,
  digits,
  chip,
};
