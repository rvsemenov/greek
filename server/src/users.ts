import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "./db.js";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export interface UserRow {
  id: number;
  name: string;
  display: string;
  pin_hash: string | null;
  level: string;
  created_at: string;
}

export interface PublicUser {
  id: number;
  name: string;
  display: string;
  level: string;
  hasPin: boolean;
}

const NAME_RE = /^[\p{L}\p{N}_-]{1,32}$/u;
const PIN_RE = /^\d{4}$/;

export function toPublic(u: UserRow): PublicUser {
  return { id: u.id, name: u.name, display: u.display, level: u.level, hasPin: u.pin_hash !== null };
}

export function validName(name: unknown): name is string {
  return typeof name === "string" && NAME_RE.test(name);
}

export function validPin(pin: unknown): pin is string {
  return typeof pin === "string" && PIN_RE.test(pin);
}

async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt, 32);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function checkPin(pin: string | undefined, stored: string | null): Promise<boolean> {
  if (stored === null) return true;
  if (!pin) return false;
  const [, saltHex, keyHex] = stored.split("$");
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(pin, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function findUser(name: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE name = ?").get(name) as UserRow | undefined;
}

export function findUserById(id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function listUsers(): PublicUser[] {
  const rows = db.prepare("SELECT * FROM users ORDER BY name").all() as UserRow[];
  return rows.map(toPublic);
}

export async function createUser(input: { name: string; display?: string; pin?: string; level?: string }) {
  const pinHash = input.pin ? await hashPin(input.pin) : null;
  const info = db
    .prepare("INSERT INTO users (name, display, pin_hash, level, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(input.name, input.display ?? input.name, pinHash, input.level ?? "A2", new Date().toISOString());
  return toPublic(findUserById(Number(info.lastInsertRowid))!);
}
