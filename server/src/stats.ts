import { db } from "./db.js";

// Минимум попыток, с которого тег или правило считаются статистически заметными (OPTIONS.md §6).
export const MIN_SAMPLE = 5;

export interface AttemptRow {
  item_id: string;
  rule: string;
  tags: string;
  answered: string | null;
  correct: number;
  ms: number | null;
  peeked: number;
  ts: string;
}

export function since(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function attemptsSince(userId: number, days: number): AttemptRow[] {
  return db
    .prepare(
      `SELECT item_id, rule, tags, answered, correct, ms, peeked, ts
       FROM attempts WHERE user_id = ? AND ts >= ? ORDER BY ts`,
    )
    .all(userId, since(days)) as AttemptRow[];
}

interface Bucket {
  key: string;
  total: number;
  right: number;
}

function tally(rows: AttemptRow[], keysOf: (r: AttemptRow) => string[]) {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    for (const key of keysOf(r)) {
      const b = map.get(key) ?? { key, total: 0, right: 0 };
      b.total++;
      b.right += r.correct;
      map.set(key, b);
    }
  }
  return [...map.values()]
    .map((b) => ({
      key: b.key,
      total: b.total,
      right: b.right,
      errorRate: b.total ? Math.round(((b.total - b.right) / b.total) * 100) : 0,
      enough: b.total >= MIN_SAMPLE,
    }))
    .sort((a, b) => Number(b.enough) - Number(a.enough) || b.errorRate - a.errorRate || b.total - a.total);
}

export function userStats(userId: number, days: number) {
  const rows = attemptsSince(userId, days);
  const right = rows.reduce((s, r) => s + r.correct, 0);

  const perDay = new Map<string, number>();
  for (const r of rows) {
    const day = r.ts.slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  return {
    days,
    total: rows.length,
    right,
    errorRate: rows.length ? Math.round(((rows.length - right) / rows.length) * 100) : 0,
    byRule: tally(rows, (r) => [r.rule]),
    byTag: tally(rows, (r) => (JSON.parse(r.tags) as string[]) ?? []),
    perDay: [...perDay.entries()].sort().map(([day, count]) => ({ day, count })),
  };
}

export function compareUsers(days: number) {
  return db
    .prepare(
      `SELECT u.display AS display, u.name AS name, COUNT(a.id) AS total,
              COALESCE(SUM(a.correct), 0) AS right
       FROM users u LEFT JOIN attempts a ON a.user_id = u.id AND a.ts >= ?
       GROUP BY u.id ORDER BY total DESC, u.name`,
    )
    .all(since(days)) as { display: string; name: string; total: number; right: number }[];
}

export function mistakesJsonl(userId: number, days: number, onlyWrong: boolean): string {
  const rows = attemptsSince(userId, days).filter((r) => !onlyWrong || r.correct === 0);
  return rows
    .map((r) =>
      JSON.stringify({
        ts: r.ts,
        item: r.item_id,
        rule: r.rule,
        tags: JSON.parse(r.tags),
        answered: r.answered,
        correct: r.correct === 1,
        ms: r.ms,
        peeked: r.peeked === 1,
      }),
    )
    .join("\n")
    .concat(rows.length ? "\n" : "");
}
