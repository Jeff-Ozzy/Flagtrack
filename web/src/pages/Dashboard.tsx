import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, CalendarPlus, ChevronRight, Medal, Shield, Target, TrendingUp, Trophy, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { STAT_KEYS, STAT_SHORT, formatDateBR, formatDuration } from '@flagtrack/shared';
import { ActivityCard, ReminderBanner, RetroWindowCard, StreakDays, StreakFlame, categoryLabel } from '../components/sport';
import { Badge, Card, Delta, EmptyState, ErrorState, LinkButton, PageLoading, ProgressBar, Ring, SectionTitle, StatTile } from '../components/ui';
import { api } from '../lib/api';
import { serverNow, useTick } from '../lib/hooks';
import type { Activity, Gamification, StreakState } from '../lib/types';

function greeting(name: string) {
  const h = new Date(serverNow()).getHours();
  const first = name.split(' ')[0];
  return `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}, ${first}!`;
}

const fmtChallenge = (measure: string, v: number, unit: string) => (measure === 'TIME' ? formatDuration(v) : `${String(v).replace('.', ',')} ${unit}`);

export default function Dashboard() {
  useTick(30_000);
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api('/dashboard'), refetchInterval: 60_000 });
  if (q.isLoading) return <PageLoading />;
  if (q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data;
  const streak: StreakState = d.streak;
  const g: Gamification = d.gamification;
  const today: Activity[] = d.todayActivities;
  const next: Activity | null = d.nextActivity;
  const w = d.week;
  const reminderToday = today.find((a) => a.status === 'PLANNED' && a.reminderType !== 'NONE');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[32px] font-bold leading-tight">{greeting(d.profile.fullName)}</h1>
        <p className="text-muted">Bom treino! Vamos evoluir hoje?</p>
      </div>

      {/* Streak */}
      <Card className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-flame/10 blur-2xl" />
        <div className="flex items-center gap-4">
          <StreakFlame count={streak.current} active={streak.activeToday} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase tracking-widest text-muted">Ofensiva</div>
            <p className="font-semibold leading-snug">{streak.message}</p>
            <p className="mt-0.5 text-xs text-muted">Recorde pessoal: {streak.best} {streak.best === 1 ? 'dia' : 'dias'} · {streak.weekActiveDays} dias ativos na semana</p>
          </div>
        </div>
        <div className="mt-4"><StreakDays activeDates={streak.recentActiveDates} today={streak.today} /></div>
      </Card>

      <RetroWindowCard endsAt={streak.retro.endsAt} pending={streak.retro.pendingYesterday} date={streak.retro.date} />
      {reminderToday && <ReminderBanner title="Lembrete de hoje" body={`Prepare-se para ${reminderToday.title}${reminderToday.startTime ? ` às ${reminderToday.startTime}` : ''}!`} to={`/activities/${reminderToday.id}`} />}

      {/* Today */}
      <SectionTitle action={<Link to="/calendar" className="text-sm font-semibold text-accent">Calendário</Link>}>Agenda de hoje</SectionTitle>
      {today.length === 0 ? (
        <EmptyState icon={CalendarPlus} title="Nada planejado para hoje" action={<LinkButton to={`/activities/new?date=${d.today}`} icon={CalendarPlus}>Planejar atividade</LinkButton>}>
          {next ? `Próxima: ${next.title} em ${formatDateBR(next.date)}${next.startTime ? ` às ${next.startTime}` : ''}.` : 'Monte sua semana no calendário para manter a consistência.'}
        </EmptyState>
      ) : (
        <div className="space-y-2.5">{today.map((a) => <ActivityCard key={a.id} a={a} />)}</div>
      )}
      {next && today.length > 0 && (
        <Link to={`/activities/${next.id}`} className="flex items-center justify-between rounded-xl bg-surface2/60 px-4 py-3 text-sm">
          <span><span className="text-muted">Próxima:</span> <span className="font-semibold">{next.title}</span> · {categoryLabel(next.category)}</span>
          <span className="tabular text-muted">{next.date === d.today ? '' : formatDateBR(next.date).slice(0, 5)} {next.startTime ?? ''}</span>
        </Link>
      )}

      {/* Week summary */}
      <SectionTitle>Resumo semanal</SectionTitle>
      <Card className="flex items-center gap-4">
        <Ring value={w.completionPct} label="da agenda" size={88} />
        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Metric label="Planejadas" value={w.counts.planned} />
          <Metric label="Concluídas" value={w.counts.completed} tone="text-accent" />
          <Metric label="Não realizadas" value={w.counts.missed} tone="text-danger" />
          <Metric label="Dias ativos" value={w.activeDays} tone="text-flame" />
        </div>
      </Card>
      <p className="text-xs text-muted">
        Semana anterior: {d.lastWeek.counts.completed} concluídas · {d.lastWeek.activeDays} dias ativos ·{' '}
        <Delta value={w.counts.completed - d.lastWeek.counts.completed} suffix=" atividades" />
      </p>

      {/* Goals + XP */}
      <SectionTitle action={<Link to="/goals" className="text-sm font-semibold text-accent">Metas</Link>}>Nível {g.level}</SectionTitle>
      <Card>
        <div className="flex justify-between text-sm"><span className="font-semibold">{g.xp} XP</span><span className="text-muted">faltam {g.needed - g.intoLevel} XP</span></div>
        <ProgressBar className="mt-2" value={g.progress} />
        {g.goalsProgress.length > 0 ? (
          <div className="mt-4 space-y-3">
            {g.goalsProgress.map((p) => (
              <div key={p.goal.id}>
                <div className="flex justify-between text-sm"><span>{p.label}</span><span className={p.done ? 'font-semibold text-accent' : 'text-muted'}>{p.done ? 'Cumprida ✓' : `${p.current}/${p.target}`}</span></div>
                <ProgressBar className="mt-1.5 h-1.5" value={p.progress} />
              </div>
            ))}
          </div>
        ) : <p className="mt-3 text-sm text-muted"><Link to="/goals" className="font-semibold text-accent">Defina metas semanais</Link> para ganhar XP extra.</p>}
      </Card>

      {/* Sports summary */}
      <SectionTitle action={<Link to="/analytics" className="text-sm font-semibold text-accent">Análises</Link>}>Resumo esportivo</SectionTitle>
      <div className="grid grid-cols-3 gap-2.5">
        <StatTile icon={Trophy} value={d.sports.activeChampionships} label="Campeonatos ativos" />
        <StatTile icon={Shield} value={d.sports.gamesWithStats} label="Jogos registrados" />
        <StatTile icon={Medal} value={d.sports.personalRecords} label="Recordes pessoais" tone="flame" />
      </div>
      {d.sports.recentChallenges.length > 0 && (
        <Card className="p-0">
          <div className="px-4 pt-3 text-xs font-bold uppercase tracking-widest text-muted">Desafios recentes</div>
          {d.sports.recentChallenges.map((c: any) => (
            <Link key={c.id} to={`/analytics/challenges/${c.id}`} className="flex items-center gap-3 border-b border-line/40 px-4 py-3 last:border-0 hover:bg-surface2/50">
              <Target className="h-5 w-5 text-info" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{c.name}</div>
                <div className="text-xs text-muted">Último: {fmtChallenge(c.measureType, c.last.value, c.unit)} · Melhor: {fmtChallenge(c.measureType, c.best.value, c.unit)}</div>
              </div>
              {c.lastVsPrevious && <Delta value={c.lastVsPrevious.improvement} format={c.measureType === 'TIME' ? formatDuration : undefined} suffix={c.measureType === 'TIME' ? '' : ` ${c.unit}`} />}
            </Link>
          ))}
        </Card>
      )}
      {d.sports.lastCollective && (
        <Link to={`/analytics/collectives/${d.sports.lastCollective.id}`} className="card block p-4 hover:border-accent/50">
          <div className="mb-2 flex items-center gap-2 text-sm"><Users className="h-4 w-4 text-accent" /><span className="font-semibold">Último coletivo</span><span className="text-muted">· {formatDateBR(d.sports.lastCollective.date)}</span></div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {STAT_KEYS.map((k) => (
              <div key={k}>
                <div className="tabular font-display text-xl font-bold">{d.sports.lastCollective.stat?.[k] ?? '–'}</div>
                <div className="text-[9px] uppercase text-muted">{STAT_SHORT[k]}</div>
              </div>
            ))}
          </div>
        </Link>
      )}

      {/* Recent evolution */}
      {(d.evolution.improved.length > 0 || d.evolution.recentRecords.length > 0) && (
        <>
          <SectionTitle action={<Link to="/evolution" className="text-sm font-semibold text-accent">Evolução</Link>}>Evolução recente</SectionTitle>
          <Card className="space-y-2.5">
            {d.evolution.recentRecords.map((r: any) => (
              <div key={`${r.challengeId}-${r.date}`} className="flex items-center gap-2 text-sm"><Medal className="h-4 w-4 text-warn" /> Novo recorde em <b>{r.name}</b>: {r.measureType === 'TIME' ? formatDuration(r.value) : r.value} <Badge tone="warn">Recorde</Badge></div>
            ))}
            {d.evolution.improved.map((i: any) => (
              <div key={i.challengeId} className="flex items-center gap-2 text-sm">
                <ArrowUpRight className="h-4 w-4 text-accent" /><span className="flex-1">{i.name}</span>
                <span className="font-semibold text-accent">{i.measureType === 'TIME' ? `−${formatDuration(i.comparison.improvement)}` : `+${i.comparison.improvement}`}{i.comparison.pct != null ? ` (${String(i.comparison.pct).replace('.', ',')}%)` : ''}</span>
              </div>
            ))}
          </Card>
        </>
      )}
      <Link to="/evolution" className="flex items-center justify-between rounded-xl border border-line/60 px-4 py-3 text-sm font-semibold hover:border-accent/50">
        <span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-accent" /> Ver central de evolução</span><ChevronRight className="h-4 w-4 text-muted" />
      </Link>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <div className={`tabular font-display text-2xl font-bold leading-none ${tone ?? ''}`}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
