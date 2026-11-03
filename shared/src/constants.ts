// Domain constants shared by API and UI.

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export const DEFAULT_POSITIONS = [
  { code: 'QB', label: 'Quarterback (QB)' },
  { code: 'WR', label: 'Wide Receiver (WR)' },
  { code: 'C', label: 'Center (C)' },
  { code: 'RB', label: 'Running Back (RB)' },
  { code: 'RUSHER', label: 'Rusher' },
  { code: 'DB', label: 'Defensive Back (DB)' },
  { code: 'LB', label: 'Linebacker (LB)' },
] as const;

export const ACTIVITY_CATEGORIES = [
  'TECNICO', 'FISICO', 'ACADEMIA', 'CORRIDA', 'MOBILIDADE', 'COLETIVO',
  'DESAFIO', 'JOGO', 'CAMPEONATO', 'DESCANSO', 'OUTRA',
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  TECNICO: 'Treino técnico',
  FISICO: 'Treino físico',
  ACADEMIA: 'Academia',
  CORRIDA: 'Corrida',
  MOBILIDADE: 'Mobilidade e recuperação',
  COLETIVO: 'Coletivo',
  DESAFIO: 'Desafio',
  JOGO: 'Jogo',
  CAMPEONATO: 'Campeonato',
  DESCANSO: 'Descanso',
  OUTRA: 'Outra atividade',
};

export const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  TECNICO: '#2ED565',
  FISICO: '#FF7A1A',
  ACADEMIA: '#F2C94C',
  CORRIDA: '#38BDF8',
  MOBILIDADE: '#A78BFA',
  COLETIVO: '#34D399',
  DESAFIO: '#F472B6',
  JOGO: '#F87171',
  CAMPEONATO: '#FB923C',
  DESCANSO: '#94A3B8',
  OUTRA: '#CBD5E1',
};

/** Rest days can be planned but never count towards the streak or XP. */
export const NON_ELIGIBLE_CATEGORIES: ActivityCategory[] = ['DESCANSO'];
export const isEligibleCategory = (c: string) => !NON_ELIGIBLE_CATEGORIES.includes(c as ActivityCategory);

export const ACTIVITY_STATUSES = ['PLANNED', 'COMPLETED', 'MISSED', 'CANCELLED'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];
export const STATUS_LABELS: Record<ActivityStatus, string> = {
  PLANNED: 'Planejada',
  COMPLETED: 'Concluída',
  MISSED: 'Não realizada',
  CANCELLED: 'Cancelada',
};

export const REMINDER_TYPES = ['NONE', 'MIN_30', 'HOUR_1', 'MORNING', 'CUSTOM'] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];
export const REMINDER_LABELS: Record<ReminderType, string> = {
  NONE: 'Sem lembrete',
  MIN_30: '30 minutos antes',
  HOUR_1: '1 hora antes',
  MORNING: 'Na manhã do dia (08:00)',
  CUSTOM: 'Horário personalizado',
};

export const STAT_KEYS = ['tdPass', 'tdRun', 'tdRec', 'sacks', 'deflections', 'interceptions', 'pickSix'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export const STAT_LABELS: Record<StatKey, string> = {
  tdPass: 'TDs Passados',
  tdRun: 'TDs Corridos',
  tdRec: 'TDs Recebidos',
  sacks: 'SACKs',
  deflections: 'Desviados',
  interceptions: 'Interceptações',
  pickSix: 'Pick Six',
};
export const STAT_SHORT: Record<StatKey, string> = {
  tdPass: 'TD Pass', tdRun: 'TD Corr', tdRec: 'TD Rec', sacks: 'SACK', deflections: 'Desv', interceptions: 'INT', pickSix: 'Pick 6',
};

export const CHAMPIONSHIP_STATUSES = ['PLANNED', 'ONGOING', 'FINISHED'] as const;
export const CHAMPIONSHIP_STATUS_LABELS: Record<(typeof CHAMPIONSHIP_STATUSES)[number], string> = {
  PLANNED: 'Planejado', ONGOING: 'Em andamento', FINISHED: 'Encerrado',
};

export const EVENT_STATUSES = ['SCHEDULED', 'PLAYED', 'CANCELLED'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const GAME_STATUS_LABELS: Record<EventStatus, string> = { SCHEDULED: 'Agendado', PLAYED: 'Realizado', CANCELLED: 'Cancelado' };

export const GAME_RESULTS = ['WIN', 'LOSS', 'DRAW'] as const;
export const GAME_RESULT_LABELS: Record<(typeof GAME_RESULTS)[number], string> = { WIN: 'Vitória', LOSS: 'Derrota', DRAW: 'Empate' };

export const MEASURE_TYPES = ['LAPS', 'TIME'] as const;
export type MeasureType = (typeof MEASURE_TYPES)[number];
export const MEASURE_LABELS: Record<MeasureType, string> = { LAPS: 'Voltas', TIME: 'Tempo' };

export const GOAL_TYPES = ['ACTIVITIES', 'CATEGORY', 'CHALLENGE_ATTEMPTS', 'COLLECTIVES', 'AGENDA_PCT'] as const;
export type GoalType = (typeof GOAL_TYPES)[number];
export const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  ACTIVITIES: 'Concluir atividades',
  CATEGORY: 'Concluir atividades de uma categoria',
  CHALLENGE_ATTEMPTS: 'Registrar tentativas de desafio',
  COLLECTIVES: 'Participar de coletivos',
  AGENDA_PCT: 'Cumprir % da agenda planejada',
};
