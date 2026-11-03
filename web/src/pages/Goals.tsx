import { useQuery } from '@tanstack/react-query';
import { Lock, Pencil, Plus, Target, Trash2, Trophy, Zap } from 'lucide-react';
import { useState } from 'react';
import { ACTIVITY_CATEGORIES, CATEGORY_LABELS, GOAL_TYPES, GOAL_TYPE_LABELS, XP_RULE_LABELS, goalSchema, type GoalType } from '@flagtrack/shared';
import { Button, Card, ConfirmModal, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoading, ProgressBar, SectionTitle, Select, Toggle, cx } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAction } from '../lib/hooks';
import type { Gamification } from '../lib/types';

type GoalDraft = { id?: string; type: GoalType; target: string; category: string; active: boolean };

export default function Goals() {
  const q = useQuery({ queryKey: ['gamification'], queryFn: () => api<Gamification>('/gamification') });
  const [edit, setEdit] = useState<GoalDraft | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useAction((g: GoalDraft) => {
    const body = { type: g.type, target: Number(g.target), category: g.type === 'CATEGORY' ? g.category : null, active: g.active };
    return g.id ? api(`/goals/${g.id}`, { method: 'PUT', body }) : api('/goals', { body });
  }, { success: 'Meta salva.', onSuccess: () => setEdit(null), onError: (e) => e instanceof ApiError && setErrors(e.fieldErrors) });
  const remove = useAction((id: string) => api(`/goals/${id}`, { method: 'DELETE' }), { success: 'Meta removida.', onSuccess: () => setDel(null) });

  if (q.isLoading) return <PageLoading />;
  if (q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  const g = q.data!;
  const progress = new Map(g.goalsProgress.map((p) => [p.goal.id, p]));
  const submit = () => {
    if (!edit) return;
    const r = goalSchema.safeParse({ type: edit.type, target: Number(edit.target), category: edit.type === 'CATEGORY' ? edit.category || null : null, active: edit.active });
    if (!r.success) return setErrors(Object.fromEntries(Object.entries(r.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ''])));
    setErrors({});
    save.mutate(edit);
  };
  const unlocked = g.achievements.filter((a) => a.unlockedAt).length;

  return (
    <>
      <PageHeader title="Metas e conquistas" back />
      <Card className="relative overflow-hidden">
        <div aria-hidden className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-accent/15 blur-2xl" />
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 flex-col items-center justify-center rounded-2xl bg-accent text-accent-ink">
            <span className="text-[10px] font-bold uppercase">Nível</span>
            <span className="font-display text-3xl font-bold leading-none">{g.level}</span>
          </div>
          <div className="flex-1">
            <div className="font-display text-3xl font-bold">{g.xp} XP</div>
            <ProgressBar className="mt-1.5" value={g.progress} />
            <div className="mt-1 text-xs text-muted">{g.intoLevel}/{g.needed} XP para o nível {g.level + 1}</div>
          </div>
        </div>
      </Card>

      <SectionTitle action={<Button size="sm" variant="outline" icon={Plus} onClick={() => setEdit({ type: 'ACTIVITIES', target: '3', category: 'FISICO', active: true })}>Meta</Button>}>Metas da semana</SectionTitle>
      {g.goals.length === 0 ? (
        <EmptyState icon={Target} title="Nenhuma meta definida" action={<Button icon={Plus} onClick={() => setEdit({ type: 'ACTIVITIES', target: '3', category: 'FISICO', active: true })}>Criar meta</Button>}>
          Ex.: concluir 3 atividades, realizar 2 treinos físicos, cumprir 80% da agenda. Cada meta cumprida vale XP.
        </EmptyState>
      ) : (
        <div className="space-y-2.5">
          {g.goals.map((goal) => {
            const p = progress.get(goal.id);
            return (
              <Card key={goal.id} className={cx(!goal.active && 'opacity-60')}>
                <div className="flex items-center gap-2">
                  <span className="flex-1 font-semibold">{goal.label}{!goal.active && <span className="ml-2 text-xs text-muted">(pausada)</span>}</span>
                  {p && <span className={cx('tabular text-sm', p.done ? 'font-semibold text-accent' : 'text-muted')}>{p.done ? 'Cumprida ✓' : `${p.current}/${p.target}${goal.type === 'AGENDA_PCT' ? '%' : ''}`}</span>}
                  <button aria-label="Editar meta" className="p-1 text-muted hover:text-text" onClick={() => setEdit({ id: goal.id, type: goal.type as GoalType, target: String(goal.target), category: goal.category ?? 'FISICO', active: goal.active })}><Pencil className="h-4 w-4" /></button>
                  <button aria-label="Excluir meta" className="p-1 text-muted hover:text-danger" onClick={() => setDel(goal.id)}><Trash2 className="h-4 w-4" /></button>
                </div>
                {p && <ProgressBar className="mt-2" value={p.progress} />}
              </Card>
            );
          })}
        </div>
      )}

      <SectionTitle>Conquistas <span className="text-base text-muted">{unlocked}/{g.achievements.length}</span></SectionTitle>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {g.achievements.map((a) => (
          <div key={a.code} className={cx('card flex flex-col items-center p-4 text-center', !a.unlockedAt && 'opacity-50')}>
            {a.unlockedAt ? <Trophy className="h-8 w-8 text-warn" /> : <Lock className="h-8 w-8 text-muted" />}
            <div className="mt-2 font-semibold leading-tight">{a.title}</div>
            <div className="mt-1 text-xs text-muted">{a.description}</div>
            {a.unlockedAt && <div className="mt-1.5 text-[11px] text-accent">{new Date(a.unlockedAt).toLocaleDateString('pt-BR')}</div>}
          </div>
        ))}
      </div>

      <SectionTitle>Como ganhar XP</SectionTitle>
      <Card className="p-0">
        {XP_RULE_LABELS.map((r) => (
          <div key={r.label} className="flex items-center gap-3 border-b border-line/40 px-4 py-2.5 text-sm last:border-0"><Zap className="h-4 w-4 text-accent" /><span className="flex-1">{r.label}</span><b className="text-accent">+{r.xp} XP</b></div>
        ))}
      </Card>
      <p className="mt-2 text-xs text-muted">Cada recompensa é concedida uma única vez por fonte. Desfazer uma conclusão remove o XP correspondente. XP e conquistas nunca alteram estatísticas de jogos.</p>

      {g.recent.length > 0 && (
        <>
          <SectionTitle>Histórico de XP</SectionTitle>
          <Card className="p-0">
            {g.recent.map((e) => (
              <div key={e.id} className="flex items-center gap-3 border-b border-line/40 px-4 py-2.5 text-sm last:border-0">
                <span className="flex-1">{e.reason}</span>
                <span className="text-xs text-muted">{new Date(e.createdAt).toLocaleDateString('pt-BR')}</span>
                <b className="tabular text-accent">+{e.amount}</b>
              </div>
            ))}
          </Card>
        </>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar meta' : 'Nova meta semanal'}>
        {edit && (
          <>
            <Select label="Tipo" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value as GoalType, target: e.target.value === 'AGENDA_PCT' ? '80' : edit.target })} options={GOAL_TYPES.map((t) => ({ value: t, label: GOAL_TYPE_LABELS[t] }))} />
            {edit.type === 'CATEGORY' && <Select label="Categoria" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} options={ACTIVITY_CATEGORIES.filter((c) => c !== 'DESCANSO').map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} error={errors.category} />}
            <Input label={edit.type === 'AGENDA_PCT' ? 'Percentual (%)' : 'Quantidade por semana'} inputMode="numeric" value={edit.target} onChange={(e) => setEdit({ ...edit, target: e.target.value.replace(/\D/g, '') })} error={errors.target} />
            <Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Meta ativa" />
            <div className="flex gap-3">
              <Button variant="soft" className="flex-1" onClick={() => setEdit(null)}>Cancelar</Button>
              <Button className="flex-1" loading={save.isPending} onClick={submit}>Salvar</Button>
            </div>
          </>
        )}
      </Modal>
      <ConfirmModal open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} title="Excluir meta?" danger confirmLabel="Excluir" loading={remove.isPending}>
        O XP já conquistado em semanas anteriores é mantido.
      </ConfirmModal>
    </>
  );
}
