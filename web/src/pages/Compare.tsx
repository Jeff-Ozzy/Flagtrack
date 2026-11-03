import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Info } from 'lucide-react';
import { DateTime } from 'luxon';
import { type ReactNode, useState } from 'react';
import { STAT_KEYS, STAT_LABELS, STAT_SHORT, addDays, diff, formatDateBR, formatDuration, weekStart } from '@flagtrack/shared';
import { Bars, CHART, ChartCard, NoData } from '../components/charts';
import { Card, ErrorState, Input, PageHeader, PageLoading, SectionTitle, Select, cx } from '../components/ui';
import { api } from '../lib/api';
import { useServerTime } from '../lib/hooks';

type Preset = 'week' | 'month' | 'months' | 'semesters' | 'seasons' | 'custom';
type Range = { from: string; to: string };

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'week', label: 'Esta semana × semana anterior' },
  { value: 'month', label: 'Este mês × mês anterior' },
  { value: 'months', label: 'Mês × mês (escolher)' },
  { value: 'semesters', label: '1º semestre × 2º semestre' },
  { value: 'seasons', label: 'Temporada atual × anterior (ano)' },
  { value: 'custom', label: 'Períodos personalizados' },
];

const monthRange = (ym: string): Range => {
  const d = DateTime.fromISO(`${ym}-01`);
  return { from: d.toISODate()!, to: d.endOf('month').toISODate()! };
};

/** Periods still in progress are cut at today so they are not diluted by future days. */
const capAt = (r: Range, today: string) => ({ ...r, to: r.to > today ? today : r.to, ongoing: r.to > today });

const num = (v: number | null | undefined, d = 2) => (v == null ? '—' : String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ','));

function Row({ label, a, b, fmt = (v) => num(v), absFmt, lowerIsBetter, comparable = true, hint, neutral }: {
  label: ReactNode; a: number | null | undefined; b: number | null | undefined; fmt?: (v: number | null | undefined) => string; absFmt?: (v: number) => string;
  lowerIsBetter?: boolean; comparable?: boolean; hint?: string; neutral?: boolean;
}) {
  const d = diff(a, b);
  const better = neutral || d.abs == null || d.abs === 0 ? null : lowerIsBetter ? d.abs < 0 : d.abs > 0;
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 border-b border-line/40 px-4 py-2.5 last:border-0">
      <div className="min-w-0 text-sm">
        {label}
        {hint && <div className="text-[11px] text-muted">{hint}</div>}
      </div>
      <div className="tabular text-right text-sm text-muted">{fmt(a)} → <b className="text-text">{fmt(b)}</b></div>
      <div className={cx('tabular w-20 text-right text-sm font-semibold', !comparable ? 'text-muted' : better == null ? 'text-muted' : better ? 'text-accent' : 'text-danger')}>
        {!comparable ? 'n/c' : d.abs == null ? 'sem dados' : d.abs === 0 ? '=' : (
          <>
            {d.abs > 0 ? '+' : '−'}{(absFmt ?? fmt)(Math.abs(d.abs))}
            {d.pct != null && <div className="text-[11px] font-medium opacity-80">{d.pct > 0 ? '+' : ''}{num(d.pct, 1)}%</div>}
          </>
        )}
      </div>
    </div>
  );
}

export default function Compare() {
  const time = useServerTime();
  const today = time?.today ?? DateTime.now().toISODate()!;
  const t = DateTime.fromISO(today);
  const [preset, setPreset] = useState<Preset>('month');
  const [months, setMonths] = useState({ a: t.minus({ months: 1 }).toFormat('yyyy-LL'), b: t.toFormat('yyyy-LL') });
  const [year, setYear] = useState(t.year);
  const [custom, setCustom] = useState({ aFrom: addDays(today, -59), aTo: addDays(today, -30), bFrom: addDays(today, -29), bTo: today });

  const ranges: Record<Preset, { a: Range; b: Range }> = {
    week: { a: { from: addDays(weekStart(today), -7), to: addDays(weekStart(today), -1) }, b: { from: weekStart(today), to: addDays(weekStart(today), 6) } },
    month: { a: monthRange(t.minus({ months: 1 }).toFormat('yyyy-LL')), b: monthRange(t.toFormat('yyyy-LL')) },
    months: { a: monthRange(months.a), b: monthRange(months.b) },
    semesters: { a: { from: `${year}-01-01`, to: `${year}-06-30` }, b: { from: `${year}-07-01`, to: `${year}-12-31` } },
    seasons: { a: { from: `${t.year - 1}-01-01`, to: `${t.year - 1}-12-31` }, b: { from: `${t.year}-01-01`, to: `${t.year}-12-31` } },
    custom: { a: { from: custom.aFrom, to: custom.aTo }, b: { from: custom.bFrom, to: custom.bTo } },
  };
  const A = capAt(ranges[preset].a, today);
  const B = capAt(ranges[preset].b, today);
  const valid = A.from <= A.to && B.from <= B.to;
  const q = useQuery({
    queryKey: ['compare', A.from, A.to, B.from, B.to],
    queryFn: () => api(`/compare?aFrom=${A.from}&aTo=${A.to}&bFrom=${B.from}&bTo=${B.to}`),
    enabled: valid && !!time,
  });

  return (
    <>
      <PageHeader title="Comparar períodos" subtitle="A = período de referência · B = período analisado" back="/evolution" />
      <Card className="mb-4">
        <Select label="Comparação" value={preset} onChange={(e) => setPreset(e.target.value as Preset)} options={PRESETS} />
        {preset === 'months' && (
          <div className="grid grid-cols-2 gap-3">
            <Input label="Mês A" type="month" value={months.a} onChange={(e) => e.target.value && setMonths((m) => ({ ...m, a: e.target.value }))} />
            <Input label="Mês B" type="month" value={months.b} onChange={(e) => e.target.value && setMonths((m) => ({ ...m, b: e.target.value }))} />
          </div>
        )}
        {preset === 'semesters' && <Input label="Ano" inputMode="numeric" value={String(year)} onChange={(e) => setYear(Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || t.year)} />}
        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-x-3">
            <Input label="A — de" type="date" value={custom.aFrom} onChange={(e) => setCustom((c) => ({ ...c, aFrom: e.target.value }))} />
            <Input label="A — até" type="date" value={custom.aTo} onChange={(e) => setCustom((c) => ({ ...c, aTo: e.target.value }))} />
            <Input label="B — de" type="date" value={custom.bFrom} onChange={(e) => setCustom((c) => ({ ...c, bFrom: e.target.value }))} />
            <Input label="B — até" type="date" value={custom.bTo} onChange={(e) => setCustom((c) => ({ ...c, bTo: e.target.value }))} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-info/10 p-3"><div className="text-xs font-bold text-info">A</div>{formatDateBR(A.from)} – {formatDateBR(A.to)}{A.ongoing && <div className="text-[11px] text-muted">em andamento, até hoje</div>}</div>
          <div className="rounded-xl bg-accent/10 p-3"><div className="text-xs font-bold text-accent">B</div>{formatDateBR(B.from)} – {formatDateBR(B.to)}{B.ongoing && <div className="text-[11px] text-muted">em andamento, até hoje</div>}</div>
        </div>
      </Card>

      {!valid ? <ErrorState error={new Error('Em cada período, a data final deve ser posterior à inicial (períodos futuros não têm dados).')} /> :
        q.isLoading || !q.data ? (q.isError ? <ErrorState error={q.error} retry={q.refetch} /> : <PageLoading />) : (() => {
          const { a, b, sameLength } = q.data;
          const same = sameLength as boolean;
          const statsBoth = a.games.withStats > 0 && b.games.withStats > 0;
          const colBoth = a.collectives.withStats > 0 && b.collectives.withStats > 0;
          const chA = new Map<string, any>(a.challenges.map((c: any) => [c.id, c]));
          const shared = b.challenges.filter((c: any) => chA.has(c.id));
          const weeklyLen = Math.max(a.activities.weekly.length, b.activities.weekly.length);
          const weekly = Array.from({ length: weeklyLen }, (_, i) => ({ x: `Sem ${i + 1}`, A: a.activities.weekly[i]?.completed ?? null, B: b.activities.weekly[i]?.completed ?? null }));
          return (
            <>
              {!same ? (
                <p className="mb-3 flex items-start gap-2 rounded-xl bg-warn/10 p-3 text-sm text-warn">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Os períodos têm durações diferentes ({a.days} × {b.days} dias). Totais não são equivalentes (marcados “n/c”); compare pelas médias por semana, por jogo e por tentativa.
                </p>
              ) : <p className="mb-3 text-xs text-muted">Ambos os períodos têm {a.days} dias.</p>}
              {Math.min(a.days, b.days) < 7 && (
                <p className="mb-3 flex items-start gap-2 rounded-xl bg-surface2 p-3 text-xs text-muted">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Um dos períodos tem menos de 7 dias ({Math.min(a.days, b.days)} dias): as taxas “por semana” desse período são projeções e podem exagerar a diferença.
                </p>
              )}

              <SectionTitle>Treinos</SectionTitle>
              <Card className="p-0">
                <Row label="Dias ativos por semana" a={a.activities.activeDaysPerWeek} b={b.activities.activeDaysPerWeek} />
                <Row label="Atividades concluídas por semana" a={a.activities.completedPerWeek} b={b.activities.completedPerWeek} />
                <Row label="Cumprimento da agenda" a={a.activities.completionPct} b={b.activities.completionPct} fmt={(v) => (v == null ? '—' : `${num(v, 0)}%`)} absFmt={(v) => `${num(v, 0)} p.p.`} hint="% das atividades planejadas concluídas (diferença em pontos percentuais)" />
                <Row label="Atividades concluídas (total)" a={a.activities.completed} b={b.activities.completed} comparable={same} />
                <Row label="Dias ativos (total)" a={a.activities.activeDays} b={b.activities.activeDays} comparable={same} />
              </Card>
              <div className="mt-3">
                <ChartCard title="Atividades concluídas por semana" subtitle="Semana 1, 2, 3… de cada período">
                  {weekly.some((w) => (w.A ?? 0) + (w.B ?? 0) > 0) ? <Bars data={weekly} x="x" series={[{ key: 'A', label: 'A', color: CHART.info }, { key: 'B', label: 'B', color: CHART.accent }]} height={190} /> : <NoData>Nenhuma atividade concluída nos dois períodos.</NoData>}
                </ChartCard>
              </div>

              <SectionTitle>Jogos (média por jogo)</SectionTitle>
              {a.games.withStats + b.games.withStats === 0 ? <NoData>Nenhum jogo com estatísticas nos dois períodos.</NoData> : (
                <>
                  <Card className="p-0">
                    <Row label="Jogos com estatísticas" a={a.games.withStats} b={b.games.withStats} comparable={same} />
                    {STAT_KEYS.map((k) => (
                      <Row key={k} label={STAT_LABELS[k]} a={a.games.averages[k]} b={b.games.averages[k]} hint={`${a.games.informedCounts[k] ?? 0} × ${b.games.informedCounts[k] ?? 0} jogos com o dado · total ${a.games.totals[k]} → ${b.games.totals[k]}`} />
                    ))}
                  </Card>
                  {statsBoth ? (
                    <div className="mt-3">
                      <ChartCard title="Média por jogo" subtitle="A × B">
                        <Bars data={STAT_KEYS.map((k) => ({ x: STAT_SHORT[k], A: a.games.averages[k] ?? 0, B: b.games.averages[k] ?? 0 }))} x="x" series={[{ key: 'A', label: 'A', color: CHART.info }, { key: 'B', label: 'B', color: CHART.accent }]} height={200} />
                      </ChartCard>
                    </div>
                  ) : <p className="mt-2 flex gap-2 text-xs text-muted"><Info className="h-3.5 w-3.5 shrink-0" />O gráfico aparece quando os dois períodos têm jogos com estatísticas.</p>}
                </>
              )}

              <SectionTitle>Coletivos (média por coletivo)</SectionTitle>
              {a.collectives.withStats + b.collectives.withStats === 0 ? <NoData>Nenhum coletivo com estatísticas nos dois períodos.</NoData> : (
                <Card className="p-0">
                  <Row label="Coletivos com estatísticas" a={a.collectives.withStats} b={b.collectives.withStats} comparable={same} />
                  {STAT_KEYS.map((k) => <Row key={k} label={STAT_LABELS[k]} a={a.collectives.averages[k]} b={b.collectives.averages[k]} />)}
                  {!colBoth && <p className="px-4 py-2 text-xs text-muted">Um dos períodos não tem coletivos com estatísticas.</p>}
                </Card>
              )}

              <SectionTitle>Desafios</SectionTitle>
              {shared.length === 0 ? <NoData>Nenhum desafio com tentativas nos dois períodos.</NoData> : (
                <div className="space-y-3">
                  {shared.map((cb: any) => {
                    const ca = chA.get(cb.id);
                    const time = cb.measureType === 'TIME';
                    const fmt = (v: number | null | undefined) => (v == null ? '—' : time ? formatDuration(v) : `${num(v, 1)}`);
                    return (
                      <Card key={cb.id} className="p-0">
                        <div className="px-4 pt-3 font-semibold">{cb.name} <span className="text-xs font-normal text-muted">({time ? 'tempo — menor é melhor' : `${cb.unit} — maior é melhor`})</span></div>
                        <Row label="Melhor resultado" a={ca.best} b={cb.best} fmt={fmt} lowerIsBetter={time} />
                        <Row label="Média por tentativa" a={ca.average} b={cb.average} fmt={fmt} lowerIsBetter={time} />
                        <Row label="Tentativas" a={ca.attempts} b={cb.attempts} comparable={same} />
                      </Card>
                    );
                  })}
                </div>
              )}

              <SectionTitle>Peso corporal</SectionTitle>
              {a.weight.end == null || b.weight.end == null ? <NoData>É preciso ao menos um registro de peso em cada período.</NoData> : (
                <Card className="p-0"><Row label="Peso no fim do período (kg)" a={a.weight.end} b={b.weight.end} fmt={(v) => num(v, 1)} neutral hint="Variação de peso não é classificada como melhora ou piora." /></Card>
              )}
            </>
          );
        })()}
    </>
  );
}
