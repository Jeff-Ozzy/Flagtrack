import { useQuery } from '@tanstack/react-query';
import { Bell, CalendarDays, MapPin, Repeat } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CATEGORY_LABELS, REMINDER_LABELS, REMINDER_TYPES, activitySchema, addDays, checkCompletion,
  formatRemaining, type ActivityCategory, type ReminderType,
} from '@flagtrack/shared';
import { CategoryIcon } from '../components/icons';
import { WEEKDAYS_SHORT } from '../components/sport';
import { Button, Chips, ErrorState, Input, PageHeader, PageLoading, Select, Textarea, Toggle, cx } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { newClientId, serverNow, useAction, useServerTime } from '../lib/hooks';
import type { Activity } from '../lib/types';

const defaultTitle: Partial<Record<ActivityCategory, string>> = {
  TECNICO: 'Treino técnico', FISICO: 'Treino físico', ACADEMIA: 'Academia', CORRIDA: 'Corrida', MOBILIDADE: 'Mobilidade',
  COLETIVO: 'Coletivo', DESAFIO: 'Desafio', JOGO: 'Jogo', CAMPEONATO: 'Campeonato', DESCANSO: 'Descanso',
};

export default function ActivityForm() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['activity', id], queryFn: () => api<Activity>(`/activities/${id}`), enabled: !!id });
  if (id && q.isLoading) return <PageLoading />;
  if (id && q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  return <Form existing={q.data} />;
}

function Form({ existing }: { existing?: Activity }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const time = useServerTime();
  const today = time?.today ?? DateTime.now().toISODate()!;
  const tz = time?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [clientId] = useState(newClientId);
  const [f, setF] = useState({
    title: existing?.title ?? '',
    category: (existing?.category ?? params.get('category') ?? 'TECNICO') as ActivityCategory,
    description: existing?.description ?? '',
    date: existing?.date ?? params.get('date') ?? today,
    startTime: existing?.startTime ?? '',
    endTime: existing?.endTime ?? '',
    location: existing?.location ?? '',
    notes: existing?.notes ?? '',
    isFlagRelated: existing?.isFlagRelated ?? true,
    reminderType: (existing?.reminderType ?? 'NONE') as ReminderType,
    reminderTime: existing?.reminderTime ?? '',
  });
  const [titleTouched, setTitleTouched] = useState(!!existing);
  const [repeat, setRepeat] = useState(false);
  const [weekdays, setWeekdays] = useState<string[]>([]);
  const [until, setUntil] = useState(addDays(today, 27));
  const [markCompleted, setMarkCompleted] = useState(false);
  const [completionNotes, setCompletionNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  // Preview of the retroactive rule using the server clock; the API validates definitively.
  const check = useMemo(() => checkCompletion({ date: f.date, startTime: f.startTime || null, tz, now: serverNow() }), [f.date, f.startTime, tz]);
  const isPast = f.date <= today;

  const save = useAction(
    (body: Record<string, unknown>) => (existing ? api(`/activities/${existing.id}`, { method: 'PUT', body }) : api('/activities', { body })),
    {
      success: (r: any) => (existing ? 'Atividade atualizada.' : r.duplicate ? 'Esta atividade já tinha sido salva.' : r.created > 1 ? `${r.created} atividades criadas.` : markCompleted ? 'Atividade registrada como concluída!' : 'Atividade salva.'),
      onSuccess: (r: any) => nav(`/activities/${r.activity.id}`, { replace: true }),
      onError: (e) => e instanceof ApiError && setErrors(e.fieldErrors),
    },
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...f,
      title: f.title || defaultTitle[f.category] || '',
      startTime: f.startTime || null,
      endTime: f.endTime || null,
      reminderTime: f.reminderType === 'CUSTOM' ? f.reminderTime || null : null,
      recurrence: !existing && repeat ? { weekdays: weekdays.map(Number), until } : null,
      clientId: existing ? undefined : clientId,
    };
    const r = activitySchema.safeParse(payload);
    if (!r.success) {
      setErrors(Object.fromEntries(Object.entries(r.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ''])));
      return;
    }
    if (markCompleted && !check.ok) return setErrors({ date: check.message });
    setErrors({});
    save.mutate({ ...payload, ...(markCompleted && !existing ? { markCompleted: true, completionNotes: completionNotes || null } : {}) });
  };

  const main: ActivityCategory[] = ['TECNICO', 'FISICO', 'ACADEMIA', 'CORRIDA', 'JOGO', 'COLETIVO', 'DESAFIO', 'MOBILIDADE', 'CAMPEONATO', 'DESCANSO', 'OUTRA'];
  return (
    <>
      <PageHeader title={existing ? 'Editar atividade' : 'Registrar atividade'} back />
      <form onSubmit={submit} noValidate className="mx-auto max-w-xl">
        <label className="card mb-5 flex items-center gap-3 p-3.5">
          <CalendarDays className="h-6 w-6 text-accent" />
          <span className="flex-1">
            <span className="block text-xs text-muted">Data</span>
            <span className="font-semibold">{f.date === today ? 'Hoje, ' : ''}{DateTime.fromISO(f.date).setLocale('pt-BR').toFormat("d 'de' LLL")}</span>
          </span>
          <input type="date" aria-label="Data da atividade" value={f.date} onChange={(e) => e.target.value && set({ date: e.target.value })} className="rounded-lg bg-surface2 px-2 py-1.5 text-sm" />
        </label>
        {errors.date && <p className="-mt-3 mb-4 text-sm text-danger">{errors.date}</p>}

        <span className="label">Tipo de atividade</span>
        <div className="mb-5 flex flex-wrap gap-2">
          {main.map((c) => (
            <button type="button" key={c} aria-pressed={f.category === c}
              onClick={() => set({ category: c, ...(titleTouched ? {} : { title: defaultTitle[c] ?? '' }) })}
              className={cx('inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition', f.category === c ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface text-muted hover:text-text')}>
              <CategoryIcon category={c} className="h-4 w-4" />
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>

        <div className="card p-4">
          <Input label="Nome" placeholder={defaultTitle[f.category] ?? 'Ex.: Treino de rotas'} value={f.title} onChange={(e) => { setTitleTouched(true); set({ title: e.target.value }); }} error={errors.title} maxLength={80} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Início" type="time" value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} error={errors.startTime} />
            <Input label="Término" type="time" value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} error={errors.endTime} />
          </div>
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-3 top-[38px] h-4 w-4 text-muted" />
            <Input label="Local (opcional)" className="pl-9" value={f.location} onChange={(e) => set({ location: e.target.value })} maxLength={120} placeholder="Ex.: Campo principal" />
          </div>
          <Textarea label="Descrição (opcional)" value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={500} />
          <Textarea label="Observações (opcional)" value={f.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={1000} />
          <Toggle checked={f.isFlagRelated} onChange={(v) => set({ isFlagRelated: v })} label="Relacionada ao Flag Football" description="Desmarque para compromissos complementares (ex.: academia fora da equipe)." />
        </div>

        <div className="card mt-4 p-4">
          <div className="mb-3 flex items-center gap-2 font-semibold"><Bell className="h-4 w-4 text-info" /> Lembrete</div>
          <Select label="Quando avisar" value={f.reminderType} onChange={(e) => set({ reminderType: e.target.value as ReminderType })} options={REMINDER_TYPES.map((r) => ({ value: r, label: REMINDER_LABELS[r] }))} error={errors.reminderType} hint="Lembretes só são enviados para atividades planejadas. Ative as notificações push em Configurações." />
          {f.reminderType === 'CUSTOM' && <Input label="Horário do lembrete (no dia)" type="time" value={f.reminderTime} onChange={(e) => set({ reminderTime: e.target.value })} error={errors.reminderTime} />}
        </div>

        {!existing && (
          <div className="card mt-4 p-4">
            <Toggle checked={repeat} onChange={(v) => { setRepeat(v); if (v) setMarkCompleted(false); }} label="Repetir semanalmente" description="Cria uma atividade para cada dia escolhido até a data final." />
            {repeat && (
              <>
                <div className="mb-4">
                  <span className="label"><Repeat className="mr-1 inline h-3 w-3" />Dias da semana</span>
                  <Chips multiple value={weekdays} onChange={setWeekdays} options={WEEKDAYS_SHORT.map((w, i) => ({ value: String(i + 1), label: w }))} />
                  {errors.recurrence && <p className="mt-1.5 text-sm text-danger">{errors.recurrence}</p>}
                </div>
                <Input label="Repetir até" type="date" min={f.date} value={until} onChange={(e) => setUntil(e.target.value)} />
              </>
            )}
          </div>
        )}

        {!existing && isPast && !repeat && (
          <div className="card mt-4 p-4">
            <Toggle checked={markCompleted} onChange={setMarkCompleted} label="Já realizei esta atividade" description="Registra a atividade como concluída." />
            {markCompleted && (
              check.ok ? (
                <>
                  {check.mode === 'RETRO' && check.windowEndsAt && (
                    <p className="mb-3 rounded-xl bg-warn/10 p-3 text-sm text-warn">
                      Você ainda pode registrar o treino de ontem. Faltam {formatRemaining(Date.parse(check.windowEndsAt) - serverNow())} para encerrar sua janela de registro.
                    </p>
                  )}
                  <Textarea label="Como foi? (opcional)" value={completionNotes} onChange={(e) => setCompletionNotes(e.target.value)} maxLength={1000} />
                </>
              ) : (
                <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{check.message}</p>
              )
            )}
          </div>
        )}
        {!existing && f.date < today && !markCompleted && !check.ok && (
          <p className="mt-3 text-xs text-muted">Esta data já passou da janela de 24 horas: a atividade pode ser salva como histórico de planejamento, mas não poderá ser concluída.</p>
        )}

        <Button type="submit" size="lg" className="mt-6 w-full" loading={save.isPending} disabled={markCompleted && !check.ok}>
          {existing ? 'Salvar alterações' : markCompleted ? 'Registrar como concluída' : 'Salvar atividade'}
        </Button>
      </form>
    </>
  );
}

