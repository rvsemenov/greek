import { type Card, createEmptyCard, type Grade, fsrs, Rating, State } from "ts-fsrs";
import { db } from "./db.js";

const scheduler = fsrs();

// Ответ быстрее этого порога считается уверенным (Easy), см. OPTIONS.md §6.
const EASY_MS = 3000;

interface ProgressRow {
  item_id: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

export function rowToCard(row: ProgressRow): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

export function getProgress(userId: number, itemId: string): ProgressRow | undefined {
  return db
    .prepare("SELECT * FROM progress WHERE user_id = ? AND item_id = ?")
    .get(userId, itemId) as ProgressRow | undefined;
}

export function listProgress(userId: number, itemIds: string[]): Map<string, ProgressRow> {
  const out = new Map<string, ProgressRow>();
  if (itemIds.length === 0) return out;
  const rows = db
    .prepare(`SELECT * FROM progress WHERE user_id = ? AND item_id IN (${itemIds.map(() => "?").join(",")})`)
    .all(userId, ...itemIds) as ProgressRow[];
  for (const r of rows) out.set(r.item_id, r);
  return out;
}

export function gradeAnswer(input: { correct: boolean; ms?: number | null; peeked: boolean }): Rating {
  if (!input.correct) return Rating.Again;
  if (input.peeked) return Rating.Hard;
  if (input.ms != null && input.ms < EASY_MS) return Rating.Easy;
  return Rating.Good;
}

export function review(input: {
  userId: number;
  itemId: string;
  rule: string;
  tags: string[];
  correct: boolean;
  ms: number | null;
  peeked: boolean;
  answered: string | null;
}) {
  const now = new Date();
  const existing = getProgress(input.userId, input.itemId);
  const card = existing ? rowToCard(existing) : createEmptyCard(now);
  const rating = gradeAnswer(input);
  const next = scheduler.next(card, now, rating as Grade).card;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO progress (user_id, item_id, due, stability, difficulty, elapsed_days, scheduled_days,
         learning_steps, reps, lapses, state, last_review)
       VALUES (@user_id, @item_id, @due, @stability, @difficulty, @elapsed_days, @scheduled_days,
         @learning_steps, @reps, @lapses, @state, @last_review)
       ON CONFLICT(user_id, item_id) DO UPDATE SET
         due = excluded.due, stability = excluded.stability, difficulty = excluded.difficulty,
         elapsed_days = excluded.elapsed_days, scheduled_days = excluded.scheduled_days,
         learning_steps = excluded.learning_steps, reps = excluded.reps, lapses = excluded.lapses,
         state = excluded.state, last_review = excluded.last_review`,
    ).run({
      user_id: input.userId,
      item_id: input.itemId,
      due: next.due.toISOString(),
      stability: next.stability,
      difficulty: next.difficulty,
      elapsed_days: next.elapsed_days,
      scheduled_days: next.scheduled_days,
      learning_steps: next.learning_steps,
      reps: next.reps,
      lapses: next.lapses,
      state: next.state,
      last_review: next.last_review ? next.last_review.toISOString() : null,
    });

    db.prepare(
      `INSERT INTO attempts (user_id, item_id, rule, tags, answered, correct, ms, peeked, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.userId,
      input.itemId,
      input.rule,
      JSON.stringify(input.tags),
      input.answered,
      input.correct ? 1 : 0,
      input.ms,
      input.peeked ? 1 : 0,
      now.toISOString(),
    );
  })();

  return {
    rating: Rating[rating],
    state: State[next.state],
    due: next.due.toISOString(),
  };
}
