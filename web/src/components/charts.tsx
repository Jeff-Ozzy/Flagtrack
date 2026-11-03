import type { ReactNode } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

// Consistent chart theme. Each chart has a single unit on its Y axis.
export const CHART = {
  accent: 'rgb(46 213 101)',
  info: 'rgb(47 124 246)',
  flame: 'rgb(255 138 30)',
  grid: 'rgb(46 52 59)',
  muted: 'rgb(148 157 167)',
};

const axis = { stroke: CHART.muted, fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: 'rgb(31 35 40)', border: '1px solid rgb(46 52 59)', borderRadius: 12, color: '#fff', fontSize: 12 },
  labelStyle: { color: CHART.muted, marginBottom: 4 },
  cursor: { fill: 'rgb(255 255 255 / .04)' },
};

export function ChartCard({ title, subtitle, children, right }: { title: string; subtitle?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold">{title}</h3>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

type Series = { key: string; label: string; color?: string };

export function Bars({ data, x, series, height = 220, format }: { data: Record<string, unknown>[]; x: string; series: Series[]; height?: number; format?: (v: number) => string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="3 3" />
        <XAxis dataKey={x} {...axis} interval="preserveStartEnd" />
        <YAxis {...axis} allowDecimals={false} tickFormatter={format} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => (format ? format(v) : v)} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color ?? (i === 0 ? CHART.info : CHART.accent)} radius={[6, 6, 0, 0]} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Lines({ data, x, series, height = 220, format, area, domain }: {
  data: Record<string, unknown>[]; x: string; series: Series[]; height?: number; format?: (v: number) => string; area?: boolean; domain?: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax'];
}) {
  if (area && series.length === 1) {
    const s = series[0];
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color ?? CHART.accent} stopOpacity={0.35} />
              <stop offset="100%" stopColor={s.color ?? CHART.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="3 3" />
          <XAxis dataKey={x} {...axis} interval="preserveStartEnd" />
          <YAxis {...axis} tickFormatter={format} domain={domain ?? ['auto', 'auto']} width={format ? 60 : 40} />
          <Tooltip {...tooltipStyle} formatter={(v: number) => (format ? format(v) : v)} />
          <Area type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? CHART.accent} strokeWidth={2.5} fill={`url(#g-${s.key})`} dot={{ r: 3.5, fill: s.color ?? CHART.accent }} activeDot={{ r: 5 }} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="3 3" />
        <XAxis dataKey={x} {...axis} interval="preserveStartEnd" />
        <YAxis {...axis} tickFormatter={format} domain={domain ?? ['auto', 'auto']} width={format ? 60 : 40} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => (format ? format(v) : v)} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />}
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? (i === 0 ? CHART.accent : CHART.info)} strokeWidth={2.5} dot={{ r: 3.5 }} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function NoData({ children }: { children: ReactNode }) {
  return <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-line px-6 text-center text-sm text-muted">{children}</div>;
}
