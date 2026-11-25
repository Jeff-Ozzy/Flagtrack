import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Dumbbell, Target, Trophy, Users } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PageHeader, Segmented } from '../components/ui';
import { api } from '../lib/api';

/** Module switcher shared by the three analytics modules. */
export function AnalyticsTabs() {
  const loc = useLocation();
  const nav = useNavigate();
  const value = loc.pathname.includes('challenges') ? 'challenges' : loc.pathname.includes('collectives') ? 'collectives' : loc.pathname.includes('exercises') ? 'exercises' : 'championships';
  return (
    <Segmented
      className="mb-5"
      compact
      value={value}
      onChange={(v) => nav(`/analytics/${v}`)}
      options={[{ value: 'championships', label: 'Campeonatos' }, { value: 'challenges', label: 'Desafios' }, { value: 'collectives', label: 'Coletivos' }, { value: 'exercises', label: 'Exercícios' }]}
    />
  );
}

export default function Analytics() {
  const champs = useQuery({ queryKey: ['championships', false], queryFn: () => api<any[]>('/championships') });
  const challenges = useQuery({ queryKey: ['challenges', 'false'], queryFn: () => api<any[]>('/challenges') });
  const cols = useQuery({ queryKey: ['collectives', '', ''], queryFn: () => api('/collectives') });
  const exercises = useQuery({ queryKey: ['exercises'], queryFn: () => api<{ prCount: number }[]>('/exercises') });
  const cards = [
    { to: '/analytics/championships', icon: Trophy, title: 'Campeonatos', desc: 'Etapas, jogos e as 7 estatísticas por partida.', stat: champs.data ? `${champs.data.length} ativo(s) · ${champs.data.reduce((s, c) => s + c.counts.withStats, 0)} jogos com stats` : '…', color: 'text-warn' },
    { to: '/analytics/challenges', icon: Target, title: 'Desafios', desc: 'Voltas e tempos: compare tentativas e bata recordes.', stat: challenges.data ? `${challenges.data.length} desafio(s) · ${challenges.data.reduce((s, c) => s + c.count, 0)} tentativas` : '…', color: 'text-info' },
    { to: '/analytics/exercises', icon: Dumbbell, title: 'Exercícios', desc: 'Academia, CrossFit/WOD e mobilidade: cargas, evolução e PRs.', stat: exercises.data ? `${exercises.data.length} exercício(s) · ${exercises.data.reduce((s, e) => s + e.prCount, 0)} PRs` : '…', color: 'text-flame' },
    { to: '/analytics/collectives', icon: Users, title: 'Coletivos', desc: 'Desempenho individual nos coletivos da equipe.', stat: cols.data ? `${cols.data.summary.counts.played} realizado(s)` : '…', color: 'text-accent' },
  ];
  return (
    <>
      <PageHeader title="Análises" subtitle="Campeonatos, desafios, exercícios e coletivos" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.to} to={c.to} className="card group flex items-center gap-4 p-5 transition hover:border-accent/60 md:flex-col md:items-start">
            <div className="rounded-2xl bg-surface2 p-3"><c.icon className={`h-7 w-7 ${c.color}`} /></div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold">{c.title}</h2>
              <p className="text-sm text-muted">{c.desc}</p>
              <p className="mt-2 text-xs font-semibold text-accent">{c.stat}</p>
            </div>
            <ChevronRight className="h-5 w-5 text-muted transition group-hover:translate-x-1 md:hidden" />
          </Link>
        ))}
      </div>
    </>
  );
}
