import { z } from 'zod';
import {
  ACTIVITY_CATEGORIES, ACTIVITY_STATUSES, CHAMPIONSHIP_STATUSES, EVENT_STATUSES, GAME_RESULTS,
  GOAL_TYPES, MEASURE_TYPES, REMINDER_TYPES, STAT_KEYS,
} from './constants';
import { isValidTimeZone } from './time';

// Validation schemas shared by the API (authoritative) and the forms (fast feedback).

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').refine((d) => !isNaN(Date.parse(d)), 'Data inválida');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido (HH:MM)');
const optText = (max: number) =>
  z.string().trim().max(max, `Máximo de ${max} caracteres`).nullish().transform((v) => (v ? v : null));
const optDate = isoDate.nullish().or(z.literal('')).transform((v) => (v ? v : null));
const optTime = hhmm.nullish().or(z.literal('')).transform((v) => (v ? v : null));
const clientId = z.string().uuid().nullish();

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres').max(128),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
});

export const timezoneSchema = z.string().refine(isValidTimeZone, 'Fuso horário inválido');

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Informe seu nome completo').max(100),
  positions: z.array(z.string().trim().min(1).max(40)).min(1, 'Selecione ao menos uma posição').max(6),
  jerseyNumber: z.number().int('Número inteiro').min(0, 'Mínimo 0').max(999, 'Máximo 999').nullable(),
  birthDate: optDate,
  heightCm: z.number().min(100, 'Altura mínima 100 cm').max(250, 'Altura máxima 250 cm').nullable(),
  timezone: timezoneSchema,
  inAppReminders: z.boolean().default(true),
});
export type ProfileInput = z.infer<typeof profileSchema>;

export const onboardingSchema = profileSchema.extend({
  weightKg: z.number().min(25, 'Peso mínimo 25 kg').max(300, 'Peso máximo 300 kg'),
});

export const weightSchema = z.object({
  weightKg: z.number({ invalid_type_error: 'Informe o peso' }).min(25, 'Peso mínimo 25 kg').max(300, 'Peso máximo 300 kg'),
  date: isoDate,
});

export const recurrenceSchema = z.object({
  weekdays: z.array(z.number().int().min(1).max(7)).min(1, 'Escolha os dias da semana'),
  until: isoDate,
});

export const activitySchema = z
  .object({
    title: z.string().trim().min(1, 'Informe o nome').max(80),
    category: z.enum(ACTIVITY_CATEGORIES),
    description: optText(500),
    date: isoDate,
    startTime: optTime,
    endTime: optTime,
    durationMin: z.number().int().min(1).max(1440).nullable().default(null),
    location: optText(120),
    notes: optText(1000),
    isFlagRelated: z.boolean().default(true),
    reminderType: z.enum(REMINDER_TYPES).default('NONE'),
    reminderTime: optTime,
    recurrence: recurrenceSchema.nullish(),
    clientId,
  })
  .refine((a) => !a.startTime || !a.endTime || a.endTime > a.startTime, { message: 'O término deve ser depois do início', path: ['endTime'] })
  .refine((a) => a.reminderType !== 'CUSTOM' || !!a.reminderTime, { message: 'Informe o horário do lembrete', path: ['reminderTime'] })
  .refine((a) => !['MIN_30', 'HOUR_1'].includes(a.reminderType) || !!a.startTime, {
    message: 'Defina um horário de início para usar esse lembrete',
    path: ['reminderType'],
  })
  .refine((a) => !a.recurrence || a.recurrence.until >= a.date, { message: 'A repetição deve terminar depois da data inicial', path: ['recurrence'] });
export type ActivityInput = z.infer<typeof activitySchema>;

export const activityStatusSchema = z.object({
  status: z.enum(ACTIVITY_STATUSES),
  completionNotes: optText(1000),
});

export const championshipSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome').max(100),
    season: z.string().trim().min(1, 'Informe a temporada').max(20),
    teamName: z.string().trim().min(1, 'Informe a equipe').max(80),
    description: optText(500),
    startDate: isoDate,
    endDate: optDate,
    location: optText(120),
    status: z.enum(CHAMPIONSHIP_STATUSES),
    notes: optText(1000),
  })
  .refine((c) => !c.endDate || c.endDate >= c.startDate, { message: 'O término deve ser depois do início', path: ['endDate'] });

export const stageSchema = z
  .object({
    name: z.string().trim().min(1, 'Informe o nome').max(80),
    order: z.number().int().min(1).max(99),
    startDate: optDate,
    endDate: optDate,
    location: optText(120),
    notes: optText(1000),
  })
  .refine((s) => !s.startDate || !s.endDate || s.endDate >= s.startDate, { message: 'O término deve ser depois do início', path: ['endDate'] });

const statValue = z
  .number({ invalid_type_error: 'Use apenas números inteiros' })
  .int('Use apenas números inteiros')
  .min(0, 'Não pode ser negativo')
  .max(99, 'Valor muito alto')
  .nullable();
export const statsSchema = z.object(Object.fromEntries(STAT_KEYS.map((k) => [k, statValue])) as Record<(typeof STAT_KEYS)[number], typeof statValue>);
export type StatsInput = z.infer<typeof statsSchema>;

export const gameSchema = z.object({
  championshipId: z.string().min(1, 'Selecione o campeonato'),
  stageId: z.string().min(1, 'Selecione a etapa'),
  opponent: z.string().trim().min(1, 'Informe o adversário').max(80),
  date: isoDate,
  time: optTime,
  code: optText(40),
  teamScore: z.number().int().min(0).max(999).nullable().default(null),
  opponentScore: z.number().int().min(0).max(999).nullable().default(null),
  result: z.enum(GAME_RESULTS).nullable().default(null),
  status: z.enum(EVENT_STATUSES),
  notes: optText(1000),
  addToCalendar: z.boolean().default(false),
  clientId,
});

export const collectiveSchema = z.object({
  name: z.string().trim().min(1, 'Informe a identificação').max(80),
  date: isoDate,
  time: optTime,
  location: optText(120),
  description: optText(500),
  opponent: optText(80),
  status: z.enum(EVENT_STATUSES),
  notes: optText(1000),
  addToCalendar: z.boolean().default(false),
  clientId,
});

export const challengeSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(80),
  description: optText(500),
  measureType: z.enum(MEASURE_TYPES),
  unit: z.string().trim().min(1, 'Informe a unidade').max(20),
  archived: z.boolean().default(false),
});

export const attemptSchema = z.object({
  date: isoDate,
  time: optTime,
  /** Laps (decimal allowed, 1 place) or seconds for time challenges. */
  value: z.number({ invalid_type_error: 'Informe o resultado' }).min(0, 'Não pode ser negativo').max(1_000_000),
  notes: optText(1000),
  activityId: z.string().nullish().transform((v) => v || null),
  clientId,
});

export const goalSchema = z
  .object({
    type: z.enum(GOAL_TYPES),
    target: z.number().int().min(1, 'Meta mínima 1').max(100),
    category: z.enum(ACTIVITY_CATEGORIES).nullish().transform((v) => v ?? null),
    active: z.boolean().default(true),
  })
  .refine((g) => g.type !== 'CATEGORY' || !!g.category, { message: 'Escolha a categoria', path: ['category'] });

export const reportQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  modules: z
    .string()
    .default('activities,championships,collectives,challenges,weight')
    .transform((s) => s.split(',').filter(Boolean)),
});
export const REPORT_MODULES = [
  { code: 'activities', label: 'Atividades e ofensiva' },
  { code: 'championships', label: 'Campeonatos e jogos' },
  { code: 'collectives', label: 'Coletivos' },
  { code: 'challenges', label: 'Desafios' },
  { code: 'weight', label: 'Evolução corporal' },
] as const;
