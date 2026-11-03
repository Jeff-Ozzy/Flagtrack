/**
 * XP rules (transparent and idempotent — every reward has a unique key, so the
 * same source can never be rewarded twice):
 *  - Atividade elegível concluída: +10 XP              key activity:<id>
 *  - Tentativa de desafio registrada: +15 XP          key attempt:<id>
 *  - Novo recorde pessoal em desafio: +30 XP          key record:<attemptId>
 *  - Meta semanal cumprida: +40 XP                    key goal:<goalId>:<weekStart>
 *  - A cada 7 dias seguidos de ofensiva: +50 XP       key streak:<date>
 */
export const XP_RULES = {
  activity: 10,
  attempt: 15,
  record: 30,
  goal: 40,
  streak7: 50,
} as const;

export const XP_RULE_LABELS = [
  { label: 'Concluir uma atividade elegível', xp: XP_RULES.activity },
  { label: 'Registrar uma tentativa de desafio', xp: XP_RULES.attempt },
  { label: 'Bater um recorde pessoal em desafio', xp: XP_RULES.record },
  { label: 'Cumprir uma meta semanal', xp: XP_RULES.goal },
  { label: 'A cada 7 dias seguidos de ofensiva', xp: XP_RULES.streak7 },
];

/** XP needed to go from level L to L+1. */
export const xpForLevel = (level: number) => 100 + 50 * (level - 1);

export function levelFromXp(xp: number): { level: number; intoLevel: number; needed: number; progress: number } {
  let level = 1;
  let rest = Math.max(0, xp);
  while (rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level++;
  }
  const needed = xpForLevel(level);
  return { level, intoLevel: rest, needed, progress: rest / needed };
}

export const ACHIEVEMENTS = [
  { code: 'FIRST_TRAINING', title: 'Primeiro Treino', description: 'Conclua sua primeira atividade.' },
  { code: 'FIRST_FULL_WEEK', title: 'Primeira Semana Completa', description: 'Conclua todas as atividades planejadas de uma semana encerrada (mínimo 3).' },
  { code: 'STREAK_3', title: 'Ofensiva de 3 Dias', description: 'Fique 3 dias seguidos ativo.' },
  { code: 'STREAK_7', title: 'Ofensiva de 7 Dias', description: 'Fique 7 dias seguidos ativo.' },
  { code: 'STREAK_30', title: 'Ofensiva de 30 Dias', description: 'Fique 30 dias seguidos ativo.' },
  { code: 'FIRST_CHAMPIONSHIP', title: 'Primeiro Campeonato Registrado', description: 'Cadastre seu primeiro campeonato.' },
  { code: 'FIRST_COLLECTIVE', title: 'Primeiro Coletivo Registrado', description: 'Registre estatísticas em um coletivo.' },
  { code: 'FIRST_CHALLENGE', title: 'Primeiro Desafio Concluído', description: 'Registre a primeira tentativa de um desafio.' },
  { code: 'PERSONAL_RECORD', title: 'Novo Recorde Pessoal', description: 'Supere seu melhor resultado em um desafio.' },
  { code: 'GAMES_10', title: '10 Jogos Registrados', description: 'Registre estatísticas em 10 jogos.' },
] as const;
export type AchievementCode = (typeof ACHIEVEMENTS)[number]['code'];
