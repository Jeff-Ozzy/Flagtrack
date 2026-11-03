import { useQuery } from '@tanstack/react-query';
import { Ban, Bell, Check, CircleSlash, Clock, MapPin, Pencil, RotateCcw, Target, Trash2, Trophy, Users } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CATEGORY_COLORS, REMINDER_LABELS, formatDuration, formatRemaining, isEligibleCategory, type ActivityCategory, type ReminderType } from '@flagtrack/shared';
import { CategoryIcon } from '../components/icons';
import { CompleteModal, StatusPill, categoryLabel } from '../components/sport';
import { Button, Card, ConfirmModal, DemoBadge, ErrorState, LinkButton, PageHeader, PageLoading } from '../components/ui';
import { api } from '../lib/api';
import { serverNow, useAction, useTick } from '../lib/hooks';
import type { Activity } from '../lib/types';

export default function ActivityDetail() {
  useTick(30_000);
  const { id } = useParams();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['activity', id], queryFn: () => api<Activity & { isDemo?: boolean }>(`/activities/${id}`) });
  const [complete, setComplete] = useState(false);
  const [del, setDel] = useState(false);
  const status = useAction((s: string) => api(`/activities/${id}/status`, { body: { status: s } }), {
    success: (r: any) => ({ PLANNED: 'Atividade reaberta.', MISSED: 'Marcada como não realizada.', CANCELLED: 'Atividade cancelada.', COMPLETED: 'Concluída!' } as Record<string, string>)[r.activity.status],
  });
  const remove = useAction((scope: string) => api(`/activities/${id}${scope === 'series' ? '?scope=series' : ''}`, { method: 'DELETE' }), {
    success: (r: any) => (r.deleted > 1 ? `${r.deleted} atividades excluídas.` : 'Atividade excluída.'),
    onSuccess: () => nav('/calendar', { replace: true }),
  });

  if (q.isLoading) return <PageLoading />;
  if (q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  const a = q.data!;
  const color = CATEGORY_COLORS[a.category as ActivityCategory] ?? '#888';
  const c = a.completion;
  const remaining = c?.ok && c.mode === 'RETRO' && c.windowEndsAt ? Date.parse(c.windowEndsAt) - serverNow() : null;

  return (
    <>
      <PageHeader title="Detalhes" back />
      <Card className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: `${color}22`, color }}><CategoryIcon category={a.category} className="h-6 w-6" /></div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold leading-tight">{a.title} <DemoBadge show={a.isDemo} /></h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">{categoryLabel(a.category)} <StatusPill status={a.status} /></div>
          </div>
        </div>
        <div className="mt-4 grid gap-2 text-sm">
          <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted" />{(() => { const t = DateTime.fromISO(a.date).setLocale('pt-BR').toFormat("cccc, d 'de' LLLL"); return t.charAt(0).toUpperCase() + t.slice(1); })()}{a.startTime ? ` · ${a.startTime}${a.endTime ? `–${a.endTime}` : ''}` : ''}</div>
          {a.location && <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted" />{a.location}</div>}
          {a.reminderType !== 'NONE' && <div className="flex items-center gap-2"><Bell className="h-4 w-4 text-info" />{REMINDER_LABELS[a.reminderType as ReminderType]}{a.reminderTime ? ` (${a.reminderTime})` : ''}{a.status !== 'PLANNED' && ' — inativo (atividade não está planejada)'}</div>}
        </div>
        {a.description && <p className="mt-3 text-sm">{a.description}</p>}
        {a.notes && <p className="mt-3 rounded-xl bg-surface2 p-3 text-sm"><span className="text-muted">Observações: </span>{a.notes}</p>}
        {a.completionNotes && <p className="mt-3 rounded-xl bg-accent/10 p-3 text-sm"><span className="text-muted">Após o treino: </span>{a.completionNotes}</p>}
        {a.completedAt && <p className="mt-3 text-xs text-muted">Concluída em {new Date(a.completedAt).toLocaleString('pt-BR')}</p>}
        {!isEligibleCategory(a.category) && <p className="mt-3 text-xs text-muted">Atividades de descanso não contam para a ofensiva nem geram XP.</p>}
      </Card>

      {a.status === 'PLANNED' && c && (
        <div className="mt-4">
          {c.ok ? (
            <>
              {remaining != null && <p className="mb-3 rounded-xl bg-warn/10 p-3 text-sm text-warn">Você ainda pode registrar esta atividade. Faltam {formatRemaining(remaining)} para encerrar sua janela de registro.</p>}
              <Button size="lg" className="w-full" icon={Check} onClick={() => setComplete(true)}>Concluir atividade</Button>
            </>
          ) : (
            <p className="rounded-xl bg-surface2 p-3 text-sm text-muted">{c.message}</p>
          )}
        </div>
      )}

      {(a.game || a.collective || (a.attempts?.length ?? 0) > 0) && (
        <Card className="mt-4 space-y-2 text-sm">
          {a.game && <Link to={`/analytics/games/${a.game.id}`} className="flex items-center gap-2 font-semibold text-accent"><Trophy className="h-4 w-4" /> Ver jogo vs {a.game.opponent}</Link>}
          {a.collective && <Link to={`/analytics/collectives/${a.collective.id}`} className="flex items-center gap-2 font-semibold text-accent"><Users className="h-4 w-4" /> Ver coletivo {a.collective.name}</Link>}
          {a.attempts?.map((t) => (
            <Link key={t.id} to={`/analytics/challenges/${t.challenge.id}`} className="flex items-center gap-2 font-semibold text-accent"><Target className="h-4 w-4" /> {t.challenge.name}: {t.challenge.measureType === 'TIME' ? formatDuration(t.value) : t.value}</Link>
          ))}
        </Card>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <LinkButton to={`/activities/${a.id}/edit`} variant="soft" icon={Pencil}>Editar</LinkButton>
        {a.status === 'PLANNED' && !(c && !c.ok && c.code === 'FUTURE_DAY') && (
          <Button variant="soft" icon={CircleSlash} loading={status.isPending && status.variables === 'MISSED'} onClick={() => status.mutate('MISSED')}>Não realizada</Button>
        )}
        {a.status === 'PLANNED' && <Button variant="soft" icon={Ban} loading={status.isPending && status.variables === 'CANCELLED'} onClick={() => status.mutate('CANCELLED')}>Cancelar</Button>}
        {a.status !== 'PLANNED' && <Button variant="soft" icon={RotateCcw} loading={status.isPending && status.variables === 'PLANNED'} onClick={() => status.mutate('PLANNED')}>Reabrir</Button>}
        <Button variant="danger" icon={Trash2} onClick={() => setDel(true)}>Excluir</Button>
      </div>
      {a.status === 'COMPLETED' && <p className="mt-2 text-xs text-muted">Reabrir uma atividade concluída remove o XP e o dia de ofensiva correspondentes. Concluir novamente depende da janela de 24 horas.</p>}

      <CompleteModal activity={a} open={complete} onClose={() => setComplete(false)} />
      <ConfirmModal open={del} onClose={() => setDel(false)} onConfirm={() => remove.mutate('one')} title="Excluir atividade?" danger confirmLabel="Excluir" loading={remove.isPending}>
        A atividade será removida definitivamente. Se estava concluída, o XP e o dia de ofensiva também serão removidos.
        {a.seriesId && (
          <button className="mt-4 block font-semibold text-danger underline" onClick={() => remove.mutate('series')}>Excluir esta e as próximas da série (pendentes)</button>
        )}
      </ConfirmModal>
    </>
  );
}
