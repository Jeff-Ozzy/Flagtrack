import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, ChevronRight, FileText, Flame, Pencil, Ruler, Scale, Settings, Shirt, Target, Trash2, Trophy, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DEFAULT_POSITIONS, DEFAULT_TIMEZONE, formatDateBR, onboardingSchema, profileSchema, weightSchema } from '@flagtrack/shared';
import { ChartCard, Lines, NoData } from '../components/charts';
import { StreakFlame } from '../components/sport';
import { useToast } from '../components/Toast';
import {
  Button, Card, Chips, ConfirmModal, DemoBadge, EmptyState, ErrorState, Input, ListRow, PageHeader, PageLoading, ProgressBar,
  SectionTitle, Select, StatTile, Toggle, cx,
} from '../components/ui';
import { ApiError, IS_LOCAL, api } from '../lib/api';
import { useAction, useProfile, useServerTime } from '../lib/hooks';
import type { Profile } from '../lib/types';

const TIMEZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return [DEFAULT_TIMEZONE];
  }
})();

async function resizeImage(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const size = 320;
  const scale = Math.max(size / img.width, size / img.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, (size - img.width * scale) / 2, (size - img.height * scale) / 2, img.width * scale, img.height * scale);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Falha ao processar a imagem.'))), 'image/jpeg', 0.85));
}

/** In the offline build the photo lives in the on-device database. */
function useResolvedPhoto(url: string | null) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    if (!IS_LOCAL || !url?.startsWith('/api/')) return;
    let objectUrl: string | null = null;
    import('../local/backend').then(({ localPhoto }) => localPhoto()).then((blob) => {
      if (blob) setLocal((objectUrl = URL.createObjectURL(blob)));
    });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  return IS_LOCAL && url?.startsWith('/api/') ? local : url;
}

export function Avatar({ url: rawUrl, name, size = 96 }: { url: string | null; name: string; size?: number }) {
  const url = useResolvedPhoto(rawUrl);
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
  return url ? (
    <img src={url} alt={`Foto de ${name}`} width={size} height={size} className="rounded-full object-cover ring-4 ring-accent/60" style={{ width: size, height: size }} />
  ) : (
    <div className="flex items-center justify-center rounded-full bg-surface2 font-display font-bold text-muted ring-4 ring-accent/40" style={{ width: size, height: size, fontSize: size / 2.6 }}>{initials || <User />}</div>
  );
}

type Draft = { fullName: string; positions: string[]; jerseyNumber: string; birthDate: string; heightCm: string; timezone: string; inAppReminders: boolean; weightKg: string };

function ProfileFields({ d, set, errors, onboarding, customPos, setCustomPos }: {
  d: Draft; set: (p: Partial<Draft>) => void; errors: Record<string, string>; onboarding?: boolean; customPos: string; setCustomPos: (v: string) => void;
}) {
  const known = DEFAULT_POSITIONS.map((p) => p.code as string);
  const options = [...DEFAULT_POSITIONS.map((p) => ({ value: p.code as string, label: p.label })), ...d.positions.filter((p) => !known.includes(p)).map((p) => ({ value: p, label: p }))];
  return (
    <>
      <Input label="Nome completo" value={d.fullName} onChange={(e) => set({ fullName: e.target.value })} error={errors.fullName} autoComplete="name" />
      <div className="mb-4">
        <span className="label">Posições</span>
        <Chips multiple value={d.positions} onChange={(v) => set({ positions: v })} options={options} />
        <div className="mt-2 flex gap-2">
          <input className="input" placeholder="Outra posição (ex.: Safety)" value={customPos} maxLength={40} onChange={(e) => setCustomPos(e.target.value)} />
          <Button type="button" variant="soft" onClick={() => { const v = customPos.trim(); if (v && !d.positions.includes(v)) set({ positions: [...d.positions, v] }); setCustomPos(''); }}>Adicionar</Button>
        </div>
        {errors.positions && <p className="mt-1.5 text-sm text-danger">{errors.positions}</p>}
        <p className="mt-1.5 text-xs text-muted">Use a nomenclatura da sua equipe. É possível escolher mais de uma.</p>
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        <Input label="Número da camisa" inputMode="numeric" value={d.jerseyNumber} onChange={(e) => set({ jerseyNumber: e.target.value.replace(/\D/g, '').slice(0, 3) })} error={errors.jerseyNumber} />
        {onboarding && <Input label="Peso (kg)" inputMode="decimal" value={d.weightKg} onChange={(e) => set({ weightKg: e.target.value.replace(',', '.') })} error={errors.weightKg} />}
        <Input label="Altura (cm, opcional)" inputMode="numeric" value={d.heightCm} onChange={(e) => set({ heightCm: e.target.value.replace(/[^\d.]/g, '') })} error={errors.heightCm} />
        <Input label="Nascimento (opcional)" type="date" value={d.birthDate} onChange={(e) => set({ birthDate: e.target.value })} error={errors.birthDate} />
      </div>
      <Select
        label="Fuso horário"
        value={d.timezone}
        onChange={(e) => set({ timezone: e.target.value })}
        // The browser list omits some valid names (e.g. "UTC"); always show the saved value.
        options={(TIMEZONES.includes(d.timezone) ? TIMEZONES : [d.timezone, ...TIMEZONES]).map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))}
        error={errors.timezone}
        hint="Define o seu dia esportivo: ofensiva e janela de registro retroativo usam este fuso."
      />
    </>
  );
}

function toPayload(d: Draft) {
  return {
    fullName: d.fullName,
    positions: d.positions,
    jerseyNumber: d.jerseyNumber === '' ? null : Number(d.jerseyNumber),
    birthDate: d.birthDate || null,
    heightCm: d.heightCm === '' ? null : Number(d.heightCm),
    timezone: d.timezone,
    inAppReminders: d.inAppReminders,
    weightKg: d.weightKg === '' ? NaN : Number(d.weightKg),
  };
}

const flatErrors = (e: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) =>
  Object.fromEntries(Object.entries(e.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? '']));

function PhotoPicker({ preview, onPick }: { preview: string | null; onPick: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="mb-6 flex flex-col items-center">
      <button type="button" onClick={() => ref.current?.click()} className="relative" aria-label="Alterar foto">
        <Avatar url={preview} name="" size={104} />
        <span className="absolute bottom-0 right-0 rounded-full bg-accent p-2 text-accent-ink"><Camera className="h-4 w-4" /></span>
      </button>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} />
      <span className="mt-2 text-xs text-muted">JPG, PNG ou WebP</span>
    </div>
  );
}

async function uploadPhoto(file: File) {
  const blob = await resizeImage(file);
  await api('/profile/photo', { method: 'PUT', raw: blob, contentType: 'image/jpeg' });
}

export function Onboarding() {
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState<Draft>({
    fullName: '', positions: [], jerseyNumber: '', birthDate: '', heightCm: '', weightKg: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE, inAppReminders: true,
  });
  const [customPos, setCustomPos] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [demo, setDemo] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = onboardingSchema.safeParse(toPayload(d));
    if (!r.success) return setErrors(flatErrors(r.error));
    setErrors({});
    setLoading(true);
    try {
      await api('/profile', { body: r.data });
      if (file) await uploadPhoto(file).catch((err) => toast.error(`Perfil criado, mas a foto falhou: ${err.message}`));
      if (demo) await api('/demo', { method: 'POST' }).catch(() => toast.error('Não foi possível carregar a demonstração.'));
      await qc.resetQueries();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg px-5 py-8">
      <PageHeader title="Monte seu perfil" subtitle="Leva menos de um minuto. Você pode editar tudo depois." />
      <form onSubmit={submit} noValidate className="card p-5">
        <PhotoPicker preview={file ? URL.createObjectURL(file) : null} onPick={setFile} />
        <ProfileFields d={d} set={set} errors={errors} onboarding customPos={customPos} setCustomPos={setCustomPos} />
        <Toggle checked={demo} onChange={setDemo} label="Explorar com dados de demonstração" description="Cria treinos, jogos e desafios fictícios marcados como DEMO. Você pode removê-los a qualquer momento em Configurações." />
        <Button type="submit" size="lg" className="w-full" loading={loading}>Começar</Button>
      </form>
    </div>
  );
}

export function ProfileEdit() {
  const q = useProfile();
  if (q.isLoading) return <PageLoading />;
  if (q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  return <ProfileEditForm p={q.data!} />;
}

function ProfileEditForm({ p }: { p: Profile }) {
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>({
    fullName: p.fullName, positions: p.positions, jerseyNumber: p.jerseyNumber?.toString() ?? '', birthDate: p.birthDate ?? '',
    heightCm: p.heightCm?.toString() ?? '', timezone: p.timezone, inAppReminders: p.inAppReminders, weightKg: '',
  });
  const [customPos, setCustomPos] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photoBusy, setPhotoBusy] = useState(false);
  const set = (x: Partial<Draft>) => setD((s) => ({ ...s, ...x }));
  const save = useAction((body: unknown) => api('/profile', { method: 'PUT', body }), {
    success: 'Perfil atualizado.',
    onSuccess: () => nav('/profile'),
    onError: (e) => e instanceof ApiError && setErrors(e.fieldErrors),
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const { weightKg: _w, ...payload } = toPayload(d);
    const r = profileSchema.safeParse(payload);
    if (!r.success) return setErrors(flatErrors(r.error));
    setErrors({});
    save.mutate(r.data);
  };
  const changePhoto = async (f: File) => {
    setPhotoBusy(true);
    try {
      await uploadPhoto(f);
      await qc.invalidateQueries();
      toast.success('Foto atualizada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar a foto.');
    } finally {
      setPhotoBusy(false);
    }
  };
  const removePhoto = useAction(() => api('/profile/photo', { method: 'DELETE' }), { success: 'Foto removida.' });

  return (
    <>
      <PageHeader title="Editar perfil" back="/profile" />
      <form onSubmit={submit} noValidate className="card mx-auto max-w-xl p-5">
        <div className={cx(photoBusy && 'opacity-50')}><PhotoPicker preview={p.photoUrl} onPick={changePhoto} /></div>
        {p.hasPhoto && <button type="button" className="-mt-4 mb-5 block w-full text-center text-sm text-danger" onClick={() => removePhoto.mutate()}>Remover foto</button>}
        <ProfileFields d={d} set={set} errors={errors} customPos={customPos} setCustomPos={setCustomPos} />
        <p className="mb-4 text-sm text-muted">Para atualizar o peso, use o <Link to="/profile/weight" className="font-semibold text-accent">histórico de peso</Link> — cada atualização é registrada para o gráfico de evolução.</p>
        <Button type="submit" size="lg" className="w-full" loading={save.isPending}>Salvar</Button>
      </form>
    </>
  );
}

export function ProfilePage() {
  const p = useProfile();
  const s = useQuery({ queryKey: ['summary'], queryFn: () => api('/profile/summary') });
  const time = useServerTime();
  const month = time?.today ? { from: time.today.slice(0, 8) + '01', to: time.today } : null;
  const evo = useQuery({ queryKey: ['evolution', 'profile-month', month], queryFn: () => api(`/evolution?from=${month!.from}&to=${month!.to}`), enabled: !!month });
  if (p.isLoading || s.isLoading) return <PageLoading />;
  if (p.isError) return <ErrorState error={p.error} retry={p.refetch} />;
  const prof = p.data!;
  const sum = s.data;
  const age = prof.birthDate ? Math.floor((Date.now() - Date.parse(prof.birthDate)) / (365.25 * 864e5)) : null;
  const unlocked = sum?.gamification.achievements.filter((a: { unlockedAt: string | null }) => a.unlockedAt) ?? [];
  const weekly = evo.data?.activities.weekly ?? [];

  return (
    <>
      <PageHeader title="Meu perfil" action={<Link to="/settings" aria-label="Configurações" className="rounded-full p-2 text-muted hover:bg-surface2"><Settings className="h-6 w-6" /></Link>} />
      <div className="flex flex-col items-center text-center">
        <Avatar url={prof.photoUrl} name={prof.fullName} size={112} />
        <h2 className="mt-3 text-3xl font-bold">{prof.fullName}</h2>
        <p className="text-sm text-muted">{prof.jerseyNumber != null ? `#${prof.jerseyNumber} | ` : ''}{prof.positions.join(' / ')}</p>
        <p className="mt-1 text-xs text-muted">Atleta desde {formatDateBR(prof.createdAt.slice(0, 10))}</p>
      </div>

      <Card className="mt-5 divide-y divide-line/50 p-0">
        <InfoRow icon={Scale} label="Peso" value={prof.weightKg != null ? `${String(prof.weightKg).replace('.', ',')} kg` : '—'} to="/profile/weight" />
        <InfoRow icon={Shirt} label="Posição" value={prof.positions.join(' / ')} />
        <InfoRow icon={Ruler} label="Altura · Idade" value={`${prof.heightCm ? `${prof.heightCm} cm` : '—'} · ${age != null ? `${age} anos` : '—'}`} />
      </Card>
      <Link to="/profile/edit" className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-accent py-3 font-semibold text-accent hover:bg-accent/10"><Pencil className="h-4 w-4" /> Editar perfil</Link>

      {sum && (
        <>
          <SectionTitle>Resumo de desempenho</SectionTitle>
          <div className="grid grid-cols-3 gap-2.5">
            <StatTile value={<StreakFlame count={sum.streak.current} active={sum.streak.activeToday} />} label="Ofensiva atual" />
            <StatTile value={sum.streak.best} label="Recorde (dias)" tone="flame" />
            <StatTile value={sum.completed} label="Atividades concluídas" tone="accent" />
            <StatTile value={sum.gamesWithStats} label="Jogos com stats" />
            <StatTile value={sum.collectivesWithStats} label="Coletivos com stats" />
            <StatTile value={sum.attempts} label="Tentativas de desafios" />
          </div>
          <Card className="mt-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">Nível {sum.gamification.level}</span>
              <span className="text-muted">{sum.gamification.intoLevel}/{sum.gamification.needed} XP</span>
            </div>
            <ProgressBar className="mt-2" value={sum.gamification.progress} />
          </Card>

          <SectionTitle>Evolução do mês</SectionTitle>
          <ChartCard title="Atividades concluídas por semana" subtitle="Mês atual">
            {weekly.some((w: { completed: number }) => w.completed > 0) ? (
              <Lines area data={weekly.map((w: { week: string; completed: number }) => ({ x: formatDateBR(w.week).slice(0, 5), v: w.completed }))} x="x" series={[{ key: 'v', label: 'Concluídas' }]} height={170} />
            ) : <NoData>Conclua atividades para ver sua evolução semanal.</NoData>}
          </ChartCard>

          <SectionTitle action={<Link to="/goals" className="text-sm font-semibold text-accent">Ver todas</Link>}>Conquistas</SectionTitle>
          {unlocked.length ? (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {unlocked.map((a: { code: string; title: string }) => (
                <div key={a.code} className="card flex min-w-[120px] flex-col items-center p-3 text-center"><Trophy className="mb-1 h-6 w-6 text-warn" /><span className="text-xs font-semibold">{a.title}</span></div>
              ))}
            </div>
          ) : <p className="text-sm text-muted">Nenhuma conquista ainda — conclua seu primeiro treino!</p>}
        </>
      )}

      <Card className="mt-6 p-0">
        <ListRow to="/calendar?view=history"><Flame className="h-5 w-5 text-flame" /><span className="flex-1">Atividades concluídas</span><ChevronRight className="h-4 w-4 text-muted" /></ListRow>
        <ListRow to="/goals"><Target className="h-5 w-5 text-accent" /><span className="flex-1">Metas e conquistas</span><ChevronRight className="h-4 w-4 text-muted" /></ListRow>
        <ListRow to="/reports"><FileText className="h-5 w-5 text-info" /><span className="flex-1">Relatórios PDF e Excel</span><ChevronRight className="h-4 w-4 text-muted" /></ListRow>
      </Card>
    </>
  );
}

function InfoRow({ icon: Icon, label, value, to }: { icon: typeof Scale; label: string; value: string; to?: string }) {
  const inner = (
    <>
      <div className="rounded-xl bg-surface2 p-2.5"><Icon className="h-5 w-5" /></div>
      <div className="flex-1"><div className="text-xs text-muted">{label}</div><div className="text-lg font-semibold">{value || '—'}</div></div>
      {to && <ChevronRight className="h-4 w-4 text-muted" />}
    </>
  );
  return <ListRow to={to}>{inner}</ListRow>;
}

export function WeightPage() {
  const time = useServerTime();
  const q = useQuery({ queryKey: ['weights'], queryFn: () => api<{ id: string; date: string; weightKg: number; isDemo: boolean }[]>('/weights') });
  const [kg, setKg] = useState('');
  const [date, setDate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [del, setDel] = useState<string | null>(null);
  const add = useAction((body: unknown) => api('/weights', { body }), { success: 'Peso registrado.', onSuccess: () => setKg('') });
  const remove = useAction((id: string) => api(`/weights/${id}`, { method: 'DELETE' }), { success: 'Registro removido.', onSuccess: () => setDel(null) });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = weightSchema.safeParse({ weightKg: kg === '' ? undefined : Number(kg.replace(',', '.')), date: date || time?.today });
    if (!r.success) return setErrors(flatErrors(r.error));
    setErrors({});
    add.mutate(r.data);
  };
  const list = q.data ?? [];
  return (
    <>
      <PageHeader title="Histórico de peso" back="/profile" />
      <form onSubmit={submit} noValidate className="card mb-5 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Peso (kg)" inputMode="decimal" placeholder="ex.: 81,5" value={kg} onChange={(e) => setKg(e.target.value)} error={errors.weightKg} />
          <Input label="Data" type="date" max={time?.today} value={date || time?.today || ''} onChange={(e) => setDate(e.target.value)} error={errors.date} />
        </div>
        <Button type="submit" className="w-full" loading={add.isPending}>Registrar peso</Button>
      </form>
      {q.isLoading ? <PageLoading /> : list.length === 0 ? (
        <EmptyState icon={Scale} title="Sem registros">Registre seu peso para acompanhar a evolução corporal.</EmptyState>
      ) : (
        <>
          <ChartCard title="Evolução corporal" subtitle="kg">
            {list.length > 1 ? <Lines area data={list.map((w) => ({ x: formatDateBR(w.date).slice(0, 5), kg: w.weightKg }))} x="x" series={[{ key: 'kg', label: 'Peso (kg)' }]} domain={['dataMin', 'dataMax']} /> : <NoData>Registre ao menos dois pesos para ver o gráfico.</NoData>}
          </ChartCard>
          <Card className="mt-4 p-0">
            {[...list].reverse().map((w) => (
              <ListRow key={w.id}>
                <span className="flex-1 text-sm text-muted">{formatDateBR(w.date)} <DemoBadge show={w.isDemo} /></span>
                <span className="tabular font-display text-xl font-bold">{String(w.weightKg).replace('.', ',')} kg</span>
                <button aria-label="Excluir registro" onClick={() => setDel(w.id)} className="p-1 text-muted hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </ListRow>
            ))}
          </Card>
        </>
      )}
      <ConfirmModal open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} title="Excluir registro?" danger confirmLabel="Excluir" loading={remove.isPending}>
        O registro será removido do histórico e do gráfico.
      </ConfirmModal>
    </>
  );
}
