import { CheckCircle2, FileSpreadsheet, FileText } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { REPORT_MODULES, addDays, formatDateBR, weekStart } from '@flagtrack/shared';
import { useToast } from '../components/Toast';
import { Button, Card, Chips, Input, PageHeader, Segmented } from '../components/ui';
import { download } from '../lib/api';
import { useServerTime } from '../lib/hooks';

type Preset = 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'custom';

export default function Reports() {
  const time = useServerTime();
  const toast = useToast();
  const today = time?.today ?? DateTime.now().toISODate()!;
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const [modules, setModules] = useState<string[]>(REPORT_MODULES.map((m) => m.code));
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const [done, setDone] = useState<{ name: string; size: number } | null>(null);
  const d = DateTime.fromISO(today);
  const ranges: Record<Preset, { from: string; to: string }> = {
    thisWeek: { from: weekStart(today), to: addDays(weekStart(today), 6) },
    lastWeek: { from: addDays(weekStart(today), -7), to: addDays(weekStart(today), -1) },
    thisMonth: { from: d.startOf('month').toISODate()!, to: d.endOf('month').toISODate()! },
    lastMonth: { from: d.minus({ months: 1 }).startOf('month').toISODate()!, to: d.minus({ months: 1 }).endOf('month').toISODate()! },
    custom,
  };
  const range = ranges[preset];

  const gen = async (fmt: 'pdf' | 'xlsx') => {
    if (!modules.length) return toast.error('Selecione ao menos um módulo.');
    if (range.to < range.from) return toast.error('O fim do período deve ser depois do início.');
    setBusy(fmt);
    setDone(null);
    try {
      const r = await download(`/reports/${fmt}?from=${range.from}&to=${range.to}&modules=${modules.join(',')}`);
      setDone(r);
      toast.success('Relatório gerado!');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar o relatório.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Relatórios" subtitle="PDF profissional ou planilha Excel com seus dados reais" />
      <Card className="mb-4">
        <span className="label">Período</span>
        <Segmented value={preset} onChange={setPreset} options={[{ value: 'thisWeek', label: 'Semana' }, { value: 'lastWeek', label: 'Sem. ant.' }, { value: 'thisMonth', label: 'Mês' }, { value: 'lastMonth', label: 'Mês ant.' }, { value: 'custom', label: 'Outro' }]} />
        {preset === 'custom' && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Input label="De" type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <Input label="Até" type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        )}
        <p className="mt-3 text-sm text-muted">{formatDateBR(range.from)} a {formatDateBR(range.to)}</p>
      </Card>
      <Card className="mb-5">
        <span className="label">Módulos incluídos</span>
        <Chips multiple value={modules} onChange={setModules} options={REPORT_MODULES.map((m) => ({ value: m.code, label: m.label }))} />
        <p className="mt-3 text-xs text-muted">Dados não informados aparecem como “n/i”, nunca como zero. O relatório inclui apenas os seus registros.</p>
      </Card>

      {done && (
        <div className="mb-5 flex animate-rise flex-col items-center text-center">
          <CheckCircle2 className="h-16 w-16 text-accent" />
          <h2 className="mt-2 text-3xl font-bold">Relatório gerado!</h2>
          <p className="text-sm text-muted">{done.name} · {(done.size / 1024).toFixed(0)} KB — o download foi iniciado.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => gen('pdf')} disabled={!!busy} className="card flex flex-col items-center gap-2 p-5 transition hover:border-accent/60 disabled:opacity-60">
          <FileText className="h-10 w-10 text-danger" />
          <span className="font-semibold">PDF</span>
          <span className="text-xs text-muted">Seções, tabelas, gráficos e paginação</span>
        </button>
        <button onClick={() => gen('xlsx')} disabled={!!busy} className="card flex flex-col items-center gap-2 p-5 transition hover:border-accent/60 disabled:opacity-60">
          <FileSpreadsheet className="h-10 w-10 text-accent" />
          <span className="font-semibold">Excel</span>
          <span className="text-xs text-muted">Planilhas com filtros e destaques</span>
        </button>
      </div>
      {busy && <Button variant="outline" className="mt-4 w-full" loading>Gerando {busy === 'pdf' ? 'PDF' : 'Excel'}…</Button>}
    </>
  );
}
