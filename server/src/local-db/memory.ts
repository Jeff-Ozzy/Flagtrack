/**
 * In-memory database implementing the subset of the Prisma Client API used by
 * FlagTrack (filters, relation filters, include/select, nested create, unique
 * constraints, cascades, transactions). It lets the exact same route code run
 * inside the browser for the offline/local mode, persisted by the caller.
 * It is validated by running the API integration suite with DB_DRIVER=memory.
 */

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const NOW = '__now__';
const UPDATED = '__updated__';

// Field lists with defaults (undefined = optional, stored as null).
const STAT_FIELDS = { tdPass: undefined, tdRun: undefined, tdRec: undefined, sacks: undefined, deflections: undefined, interceptions: undefined, pickSix: undefined };
const MODELS: Record<string, Record<string, unknown>> = {
  user: { id: undefined, email: undefined, passwordHash: undefined, createdAt: NOW },
  athleteProfile: {
    id: undefined, userId: undefined, fullName: undefined, positions: '[]', jerseyNumber: undefined, photo: undefined, photoMime: undefined,
    photoUpdatedAt: undefined, birthDate: undefined, heightCm: undefined, timezone: 'America/Sao_Paulo', inAppReminders: true, createdAt: NOW, updatedAt: UPDATED,
  },
  weightEntry: { id: undefined, userId: undefined, isDemo: false, weightKg: undefined, date: undefined, recordedAt: NOW },
  activity: {
    id: undefined, userId: undefined, isDemo: false, clientId: undefined, seriesId: undefined, title: undefined, category: undefined, description: undefined,
    date: undefined, startTime: undefined, endTime: undefined, durationMin: undefined, location: undefined, notes: undefined, isFlagRelated: true,
    status: 'PLANNED', completionNotes: undefined, completedAt: undefined, startsAt: undefined, reminderType: 'NONE', reminderTime: undefined,
    reminderAt: undefined, reminderSentAt: undefined, gameId: undefined, collectiveId: undefined, createdAt: NOW, updatedAt: UPDATED,
  },
  championship: {
    id: undefined, userId: undefined, isDemo: false, name: undefined, season: undefined, teamName: undefined, description: undefined, startDate: undefined,
    endDate: undefined, location: undefined, status: undefined, notes: undefined, archived: false, createdAt: NOW, updatedAt: UPDATED,
  },
  stage: { id: undefined, userId: undefined, championshipId: undefined, name: undefined, order: undefined, startDate: undefined, endDate: undefined, location: undefined, notes: undefined, createdAt: NOW },
  game: {
    id: undefined, userId: undefined, clientId: undefined, championshipId: undefined, stageId: undefined, opponent: undefined, date: undefined, time: undefined,
    code: undefined, teamScore: undefined, opponentScore: undefined, result: undefined, status: undefined, notes: undefined, createdAt: NOW, updatedAt: UPDATED,
  },
  gameStat: { id: undefined, userId: undefined, gameId: undefined, ...STAT_FIELDS, updatedAt: UPDATED },
  collective: {
    id: undefined, userId: undefined, isDemo: false, clientId: undefined, name: undefined, date: undefined, time: undefined, location: undefined,
    description: undefined, opponent: undefined, status: undefined, notes: undefined, createdAt: NOW, updatedAt: UPDATED,
  },
  collectiveStat: { id: undefined, userId: undefined, collectiveId: undefined, ...STAT_FIELDS, updatedAt: UPDATED },
  challenge: { id: undefined, userId: undefined, isDemo: false, name: undefined, description: undefined, measureType: undefined, unit: undefined, archived: false, createdAt: NOW, updatedAt: UPDATED },
  challengeAttempt: {
    id: undefined, userId: undefined, clientId: undefined, challengeId: undefined, date: undefined, performedAt: undefined, value: undefined, notes: undefined,
    activityId: undefined, createdAt: NOW, updatedAt: UPDATED,
  },
  weeklyGoal: { id: undefined, userId: undefined, type: undefined, target: undefined, category: undefined, active: true, createdAt: NOW },
  xpEntry: { id: undefined, userId: undefined, key: undefined, amount: undefined, reason: undefined, createdAt: NOW },
  achievement: { id: undefined, userId: undefined, code: undefined, unlockedAt: NOW },
  pushSubscription: { id: undefined, userId: undefined, endpoint: undefined, p256dh: undefined, auth: undefined, createdAt: NOW },
};

const UNIQUES: Record<string, string[][]> = {
  user: [['email']],
  athleteProfile: [['userId']],
  activity: [['userId', 'clientId']],
  game: [['userId', 'clientId']],
  collective: [['userId', 'clientId']],
  challengeAttempt: [['userId', 'clientId']],
  gameStat: [['gameId']],
  collectiveStat: [['collectiveId']],
  xpEntry: [['userId', 'key']],
  achievement: [['userId', 'code']],
  pushSubscription: [['endpoint']],
};

/** Foreign keys: [child model, fk field, parent model, onDelete]. */
const FKS: [string, string, string, 'Cascade' | 'SetNull'][] = [
  ...Object.keys(MODELS).filter((m) => m !== 'user').map((m) => [m, 'userId', 'user', 'Cascade'] as [string, string, string, 'Cascade']),
  ['activity', 'gameId', 'game', 'SetNull'],
  ['activity', 'collectiveId', 'collective', 'SetNull'],
  ['stage', 'championshipId', 'championship', 'Cascade'],
  ['game', 'championshipId', 'championship', 'Cascade'],
  ['game', 'stageId', 'stage', 'Cascade'],
  ['gameStat', 'gameId', 'game', 'Cascade'],
  ['collectiveStat', 'collectiveId', 'collective', 'Cascade'],
  ['challengeAttempt', 'challengeId', 'challenge', 'Cascade'],
  ['challengeAttempt', 'activityId', 'activity', 'SetNull'],
];

type Rel = { kind: 'toOne' | 'toMany' | 'reverseOne'; model: string; fk: string };
const RELATIONS: Record<string, Record<string, Rel>> = {
  user: { profile: { kind: 'reverseOne', model: 'athleteProfile', fk: 'userId' } },
  activity: {
    game: { kind: 'toOne', model: 'game', fk: 'gameId' },
    collective: { kind: 'toOne', model: 'collective', fk: 'collectiveId' },
    attempts: { kind: 'toMany', model: 'challengeAttempt', fk: 'activityId' },
  },
  championship: { stages: { kind: 'toMany', model: 'stage', fk: 'championshipId' }, games: { kind: 'toMany', model: 'game', fk: 'championshipId' } },
  stage: { championship: { kind: 'toOne', model: 'championship', fk: 'championshipId' }, games: { kind: 'toMany', model: 'game', fk: 'stageId' } },
  game: {
    championship: { kind: 'toOne', model: 'championship', fk: 'championshipId' },
    stage: { kind: 'toOne', model: 'stage', fk: 'stageId' },
    stat: { kind: 'reverseOne', model: 'gameStat', fk: 'gameId' },
    activities: { kind: 'toMany', model: 'activity', fk: 'gameId' },
  },
  gameStat: { game: { kind: 'toOne', model: 'game', fk: 'gameId' } },
  collective: { stat: { kind: 'reverseOne', model: 'collectiveStat', fk: 'collectiveId' }, activities: { kind: 'toMany', model: 'activity', fk: 'collectiveId' } },
  collectiveStat: { collective: { kind: 'toOne', model: 'collective', fk: 'collectiveId' } },
  challenge: { attempts: { kind: 'toMany', model: 'challengeAttempt', fk: 'challengeId' } },
  challengeAttempt: { challenge: { kind: 'toOne', model: 'challenge', fk: 'challengeId' }, activity: { kind: 'toOne', model: 'activity', fk: 'activityId' } },
};

export class MemoryDbError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

let seq = 0;
const newId = () => `c${Date.now().toString(36)}${(seq++ % 1679616).toString(36).padStart(4, '0')}${Math.random().toString(36).slice(2, 8)}`;

const isPlainObject = (v: unknown): v is Row => !!v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof Uint8Array) && !Array.isArray(v);
const cmp = (a: unknown, b: unknown) => {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return x === y ? 0 : (x as number) < (y as number) ? -1 : 1;
};
const eq = (a: unknown, b: unknown) => (a == null && b == null) || (a != null && b != null && cmp(a, b) === 0);

export function createMemoryPrisma(opts: { onChange?: () => void; now?: () => Date } = {}) {
  let tables: Tables = Object.fromEntries(Object.keys(MODELS).map((m) => [m, []]));
  const now = opts.now ?? (() => new Date());
  const changed = () => opts.onChange?.();

  const rows = (m: string) => tables[m];
  const byId = (m: string, id: unknown) => rows(m).find((r) => r.id === id);

  /** Expands compound unique keys such as `userId_clientId: { userId, clientId }`. */
  function flattenWhere(m: string, where: Row = {}): Row {
    const out: Row = {};
    for (const [k, v] of Object.entries(where)) {
      if (v === undefined) continue;
      if (k.includes('_') && isPlainObject(v) && !(k in MODELS[m]) && !RELATIONS[m]?.[k]) Object.assign(out, v);
      else out[k] = v;
    }
    return out;
  }

  function matches(m: string, row: Row, where: Row = {}): boolean {
    for (const [k, cond] of Object.entries(flattenWhere(m, where))) {
      if (k === 'AND') {
        if (!(cond as Row[]).every((w) => matches(m, row, w))) return false;
        continue;
      }
      if (k === 'OR') {
        if (!(cond as Row[]).some((w) => matches(m, row, w))) return false;
        continue;
      }
      const rel = RELATIONS[m]?.[k];
      if (rel) {
        if (rel.kind === 'toMany') {
          const related = rows(rel.model).filter((r) => r[rel.fk] === row.id);
          if (cond.some && !related.some((r) => matches(rel.model, r, cond.some))) return false;
          if (cond.none && related.some((r) => matches(rel.model, r, cond.none))) return false;
          if (cond.every && !related.every((r) => matches(rel.model, r, cond.every))) return false;
        } else {
          const target = rel.kind === 'toOne' ? byId(rel.model, row[rel.fk]) : rows(rel.model).find((r) => r[rel.fk] === row.id);
          if (cond === null) {
            if (target) return false;
          } else if (!target || !matches(rel.model, target, cond)) return false;
        }
        continue;
      }
      const v = row[k];
      if (isPlainObject(cond)) {
        for (const [op, arg] of Object.entries(cond)) {
          if (arg === undefined) continue;
          if (op === 'equals' && !eq(v, arg)) return false;
          if (op === 'not' && (isPlainObject(arg) ? matches(m, row, { [k]: arg }) : eq(v, arg))) return false;
          if (op === 'in' && !(arg as unknown[]).some((a) => eq(v, a))) return false;
          if (op === 'notIn' && (arg as unknown[]).some((a) => eq(v, a))) return false;
          if (op === 'gte' && (v == null || cmp(v, arg) < 0)) return false;
          if (op === 'gt' && (v == null || cmp(v, arg) <= 0)) return false;
          if (op === 'lte' && (v == null || cmp(v, arg) > 0)) return false;
          if (op === 'lt' && (v == null || cmp(v, arg) >= 0)) return false;
        }
      } else if (!eq(v, cond)) return false;
    }
    return true;
  }

  function sort(list: Row[], orderBy: Row | Row[] | undefined): Row[] {
    if (!orderBy) return list;
    const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
    return [...list].sort((a, b) => {
      for (const [k, dir] of keys) {
        const x = a[k];
        const y = b[k];
        let c: number;
        if (x == null && y == null) c = 0;
        else if (x == null) c = -1; // SQLite: NULLs first in ASC
        else if (y == null) c = 1;
        else c = cmp(x, y);
        if (c) return dir === 'desc' ? -c : c;
      }
      return 0;
    });
  }

  function project(m: string, row: Row, args: Row = {}): Row {
    let out: Row;
    if (args.select) {
      out = {};
      for (const [k, v] of Object.entries(args.select)) {
        if (!v) continue;
        if (k === '_count') out._count = count(m, row, (v as Row).select);
        else if (RELATIONS[m]?.[k]) out[k] = related(m, row, k, v === true ? {} : (v as Row));
        else out[k] = row[k];
      }
      return out;
    }
    out = { ...row };
    if (args.include) {
      for (const [k, v] of Object.entries(args.include)) {
        if (!v) continue;
        if (k === '_count') out._count = count(m, row, (v as Row).select);
        else out[k] = related(m, row, k, v === true ? {} : (v as Row));
      }
    }
    return out;
  }

  function count(m: string, row: Row, select: Row) {
    return Object.fromEntries(Object.keys(select).map((k) => {
      const rel = RELATIONS[m][k];
      return [k, rows(rel.model).filter((r) => r[rel.fk] === row.id).length];
    }));
  }

  function related(m: string, row: Row, field: string, args: Row) {
    const rel = RELATIONS[m]?.[field];
    if (!rel) throw new Error(`Relação desconhecida ${m}.${field}`);
    if (rel.kind === 'toOne') {
      const t = row[rel.fk] == null ? null : byId(rel.model, row[rel.fk]);
      return t ? project(rel.model, t, args) : null;
    }
    if (rel.kind === 'reverseOne') {
      const t = rows(rel.model).find((r) => r[rel.fk] === row.id);
      return t ? project(rel.model, t, args) : null;
    }
    return query(rel.model, { ...args, where: { ...(args.where ?? {}), [rel.fk]: row.id } });
  }

  function query(m: string, args: Row = {}): Row[] {
    let list = sort(rows(m).filter((r) => matches(m, r, args.where)), args.orderBy);
    if (args.distinct) {
      const seen = new Set<string>();
      list = list.filter((r) => {
        const key = JSON.stringify((args.distinct as string[]).map((k) => r[k]));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (args.skip) list = list.slice(args.skip);
    if (args.take != null) list = list.slice(0, args.take);
    return list.map((r) => project(m, r, args));
  }

  function checkUnique(m: string, row: Row, ignoreId?: string) {
    for (const fields of UNIQUES[m] ?? []) {
      if (fields.some((f) => row[f] == null)) continue;
      if (rows(m).some((r) => r.id !== ignoreId && fields.every((f) => eq(r[f], row[f])))) {
        throw new MemoryDbError('P2002', `Unique constraint failed on ${m}.${fields.join(',')}`);
      }
    }
  }

  function insert(m: string, data: Row): Row {
    const row: Row = {};
    const nested: [string, Row][] = [];
    const t = now();
    for (const [k, def] of Object.entries(MODELS[m])) {
      const v = data[k];
      if (v !== undefined) row[k] = v;
      else row[k] = def === NOW || def === UPDATED ? new Date(t) : def === undefined ? null : def;
    }
    for (const [k, v] of Object.entries(data)) {
      if (RELATIONS[m]?.[k] && isPlainObject(v) && v.create) nested.push([k, v.create]);
    }
    if (row.id == null) row.id = newId();
    checkUnique(m, row);
    rows(m).push(row);
    for (const [k, childData] of nested) {
      const rel = RELATIONS[m][k];
      insert(rel.model, { ...childData, [rel.fk]: row.id });
    }
    return row;
  }

  function applyUpdate(m: string, row: Row, data: Row) {
    const next = { ...row };
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined || !(k in MODELS[m])) continue;
      next[k] = v;
    }
    for (const [k, def] of Object.entries(MODELS[m])) if (def === UPDATED) next[k] = now();
    checkUnique(m, next, row.id);
    Object.assign(row, next);
  }

  function remove(m: string, row: Row) {
    const idx = rows(m).indexOf(row);
    if (idx < 0) return;
    rows(m).splice(idx, 1);
    for (const [child, fk, parent, onDelete] of FKS) {
      if (parent !== m) continue;
      for (const c of rows(child).filter((r) => r[fk] === row.id)) {
        if (onDelete === 'Cascade') remove(child, c);
        else c[fk] = null;
      }
    }
  }

  function findUniqueRow(m: string, where: Row) {
    return rows(m).find((r) => matches(m, r, where));
  }

  function delegate(m: string) {
    return {
      findMany: async (args: Row = {}) => query(m, args),
      findFirst: async (args: Row = {}) => query(m, { ...args, take: 1 })[0] ?? null,
      findUnique: async (args: Row) => {
        const r = findUniqueRow(m, args.where);
        return r ? project(m, r, args) : null;
      },
      count: async (args: Row = {}) => rows(m).filter((r) => matches(m, r, args.where)).length,
      create: async (args: Row) => {
        const r = insert(m, args.data);
        changed();
        return project(m, r, args);
      },
      createMany: async (args: Row) => {
        for (const d of args.data as Row[]) insert(m, d);
        changed();
        return { count: (args.data as Row[]).length };
      },
      update: async (args: Row) => {
        const r = findUniqueRow(m, args.where);
        if (!r) throw new MemoryDbError('P2025', `Registro não encontrado em ${m}`);
        applyUpdate(m, r, args.data);
        changed();
        return project(m, r, args);
      },
      updateMany: async (args: Row) => {
        const list = rows(m).filter((r) => matches(m, r, args.where));
        for (const r of list) applyUpdate(m, r, args.data);
        if (list.length) changed();
        return { count: list.length };
      },
      upsert: async (args: Row) => {
        const r = findUniqueRow(m, args.where);
        if (r) applyUpdate(m, r, args.update);
        const out = r ?? insert(m, args.create);
        changed();
        return project(m, out, args);
      },
      delete: async (args: Row) => {
        const r = findUniqueRow(m, args.where);
        if (!r) throw new MemoryDbError('P2025', `Registro não encontrado em ${m}`);
        const copy = project(m, r, args);
        remove(m, r);
        changed();
        return copy;
      },
      deleteMany: async (args: Row = {}) => {
        const list = rows(m).filter((r) => matches(m, r, args.where));
        for (const r of list) remove(m, r);
        if (list.length) changed();
        return { count: list.length };
      },
    };
  }

  const snapshot = () => Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));

  const client: Record<string, any> = Object.fromEntries(Object.keys(MODELS).map((m) => [m, delegate(m)]));
  Object.assign(client, {
    /** Array form: operations already ran (eagerly). Function form: rolled back on error. */
    async $transaction(arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) {
      if (Array.isArray(arg)) return Promise.all(arg);
      const before = snapshot();
      try {
        return await arg(client);
      } catch (e) {
        tables = before as Tables;
        changed();
        throw e;
      }
    },
    async $disconnect() {},
    /** Replaces all data (used to load the persisted snapshot or a backup). */
    $load(data: Tables) {
      tables = Object.fromEntries(Object.keys(MODELS).map((m) => [m, Array.isArray(data?.[m]) ? data[m].map((r) => ({ ...r })) : []]));
    },
    $dump(): Tables {
      return snapshot() as Tables;
    },
  });
  return client;
}

export type MemoryPrisma = ReturnType<typeof createMemoryPrisma>;
