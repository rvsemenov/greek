import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";

mkdirSync(config.dataDir, { recursive: true });

export const db = new Database(join(config.dataDir, "greek.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY,
  name       TEXT UNIQUE NOT NULL,
  display    TEXT NOT NULL,
  pin_hash   TEXT,
  level      TEXT NOT NULL DEFAULT 'A2',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  item_id      TEXT NOT NULL,
  due          TEXT NOT NULL,
  stability    REAL NOT NULL,
  difficulty   REAL NOT NULL,
  elapsed_days INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  learning_steps INTEGER NOT NULL,
  reps         INTEGER NOT NULL,
  lapses       INTEGER NOT NULL,
  state        INTEGER NOT NULL,
  last_review  TEXT,
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id        INTEGER PRIMARY KEY,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  item_id   TEXT NOT NULL,
  rule      TEXT NOT NULL,
  tags      TEXT NOT NULL,
  answered  TEXT,
  correct   INTEGER NOT NULL,
  ms        INTEGER,
  peeked    INTEGER NOT NULL DEFAULT 0,
  ts        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS attempts_user_ts ON attempts(user_id, ts);
`);
