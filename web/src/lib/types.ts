import type { CompletionCheck, Comparison, StatLine } from '@flagtrack/shared';

export interface Rewards {
  xpGained: number;
  newAchievements: string[];
}

export interface Activity {
  id: string;
  seriesId: string | null;
  title: string;
  category: string;
  description: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  durationMin: number | null;
  location: string | null;
  notes: string | null;
  isFlagRelated: boolean;
  status: 'PLANNED' | 'COMPLETED' | 'MISSED' | 'CANCELLED';
  completionNotes: string | null;
  completedAt: string | null;
  reminderType: string;
  reminderTime: string | null;
  reminderAt: string | null;
  gameId: string | null;
  collectiveId: string | null;
  completion?: CompletionCheck;
  game?: { id: string; opponent: string; championshipId: string } | null;
  collective?: { id: string; name: string } | null;
  attempts?: { id: string; value: number; challenge: { id: string; name: string; measureType: string } }[];
}

export interface Profile {
  fullName: string;
  positions: string[];
  jerseyNumber: number | null;
  birthDate: string | null;
  heightCm: number | null;
  timezone: string;
  inAppReminders: boolean;
  hasPhoto: boolean;
  photoUrl: string | null;
  weightKg: number | null;
  createdAt: string;
}

export interface StreakState {
  current: number;
  best: number;
  activeToday: boolean;
  atRisk: boolean;
  today: string;
  weekActiveDays: number;
  recentActiveDates: string[];
  retro: { date: string; yesterdayActive: boolean; pendingYesterday: number; endsAt: string; remainingMs: number };
  message: string;
}

export interface Gamification {
  xp: number;
  level: number;
  intoLevel: number;
  needed: number;
  progress: number;
  recent: { id: string; amount: number; reason: string; createdAt: string }[];
  achievements: { code: string; title: string; description: string; unlockedAt: string | null }[];
  goals: { id: string; type: string; target: number; category: string | null; active: boolean; label: string }[];
  week: string;
  goalsProgress: { goal: { id: string }; label: string; current: number; target: number; done: boolean; progress: number }[];
}

export type Stats = StatLine;

export interface GameRow {
  id: string;
  label: string;
  date: string;
  opponent: string;
  stageName: string;
  filled: boolean;
  stats: Stats | null;
}

export interface GamesSummary {
  counts: { total: number; scheduled: number; played: number; cancelled: number; withStats: number; playedWithoutStats: number };
  record: { wins: number; losses: number; draws: number };
  totals: Record<string, number>;
  averages: Record<string, number | null>;
  informedCounts: Record<string, number>;
  bestByStat: Record<string, { value: number; game: GameRow } | null>;
  bestGame: GameRow | null;
  series: GameRow[];
}

export interface AttemptRow {
  id: string;
  date: string;
  performedAt: string;
  value: number;
  notes: string | null;
  activityId: string | null;
}

export interface ChallengeDetail {
  challenge: { id: string; name: string; description: string | null; measureType: 'LAPS' | 'TIME'; unit: string; archived: boolean; createdAt: string };
  overall: { count: number; first: AttemptRow | null; last: AttemptRow | null; previous: AttemptRow | null; best: AttemptRow | null; lastVsPrevious: Comparison | null; lastVsFirst: Comparison | null; bestVsFirst: Comparison | null };
  period: {
    count: number;
    first: AttemptRow | null;
    last: AttemptRow | null;
    previous: AttemptRow | null;
    best: AttemptRow | null;
    lastVsPrevious: Comparison | null;
    lastVsFirst: Comparison | null;
    history: { attempt: AttemptRow; vsPrevious: Comparison | null; vsFirst: Comparison | null; isRecord: boolean; bestSoFar: number }[];
  };
  recordDate: string | null;
  records: { id: string; date: string; value: number; previousBest: number | null }[];
}
