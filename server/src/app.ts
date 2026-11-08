import { existsSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { getRule, listRules, listTests, itemIndex } from "./content.js";
import { listProgress, review } from "./srs.js";
import {
  checkPin,
  createUser,
  findUser,
  findUserById,
  listUsers,
  toPublic,
  validName,
  validPin,
  type UserRow,
} from "./users.js";

const COOKIE = "greek_sid";
const YEAR_SECONDS = 365 * 24 * 60 * 60;

declare module "fastify" {
  interface FastifyRequest {
    user?: UserRow;
  }
}

export function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  app.register(cookie, { secret: config.sessionSecret });

  app.decorateRequest("user", undefined);

  if (existsSync(join(config.webDist, "index.html"))) {
    app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "не найдено" });
    });
  }

  async function requireUser(req: FastifyRequest, reply: FastifyReply) {
    const raw = req.cookies[COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : { valid: false, value: null };
    const user = unsigned.valid && unsigned.value ? findUserById(Number(unsigned.value)) : undefined;
    if (!user) {
      return reply.code(401).send({ error: "не выбран профиль" });
    }
    req.user = user;
  }

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/users", async () => ({ users: listUsers() }));

  app.post<{ Body: { name?: unknown; display?: unknown; pin?: unknown } }>("/api/users", async (req, reply) => {
    const { name, display, pin } = req.body ?? {};
    if (!validName(name)) return reply.code(400).send({ error: "имя: 1–32 буквы, цифры, _ или -" });
    if (pin !== undefined && pin !== null && pin !== "" && !validPin(pin)) {
      return reply.code(400).send({ error: "PIN — ровно 4 цифры или пусто" });
    }
    if (findUser(name)) return reply.code(409).send({ error: "такой профиль уже есть" });
    const user = await createUser({
      name,
      display: typeof display === "string" && display.trim() ? display.trim() : name,
      pin: typeof pin === "string" && pin ? pin : undefined,
    });
    return reply.code(201).send({ user });
  });

  app.post<{ Body: { name?: unknown; pin?: unknown } }>("/api/session", async (req, reply) => {
    const { name, pin } = req.body ?? {};
    if (!validName(name)) return reply.code(400).send({ error: "нет имени профиля" });
    const user = findUser(name);
    if (!user) return reply.code(404).send({ error: "профиль не найден" });
    const ok = await checkPin(typeof pin === "string" ? pin : undefined, user.pin_hash);
    if (!ok) return reply.code(401).send({ error: "неверный PIN" });
    reply.setCookie(COOKIE, String(user.id), {
      signed: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: YEAR_SECONDS,
      secure: config.cookieSecure,
    });
    return { user: toPublic(user) };
  });

  app.post("/api/session/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", { preHandler: requireUser }, async (req) => ({ user: toPublic(req.user!) }));

  app.get("/api/content/rules", async () => {
    const rules = await listRules();
    return {
      rules: rules.map(({ body: _body, ...meta }) => meta),
    };
  });

  app.get<{ Params: { "*": string } }>("/api/content/rules/*", async (req, reply) => {
    const rule = await getRule(req.params["*"]);
    if (!rule) return reply.code(404).send({ error: "правило не найдено" });
    return rule;
  });

  app.get("/api/content/tests", async () => {
    const tests = await listTests();
    return {
      tests: tests.map((t) => ({
        file: t.file,
        kind: t.kind,
        rule: t.rule,
        level: t.level,
        title: t.title,
        count: t.items.length,
      })),
    };
  });

  app.get<{ Querystring: { rule?: string; limit?: string } }>(
    "/api/queue",
    { preHandler: requireUser },
    async (req) => {
      const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 100);
      const index = await itemIndex();
      const candidates = [...index.values()]
        .filter((e) => !req.query.rule || e.item.rule === req.query.rule)
        .map((e) => e.item);
      const progress = listProgress(req.user!.id, candidates.map((c) => c.id));
      const now = Date.now();

      const due = candidates
        .filter((c) => progress.has(c.id) && new Date(progress.get(c.id)!.due).getTime() <= now)
        .sort((a, b) => new Date(progress.get(a.id)!.due).getTime() - new Date(progress.get(b.id)!.due).getTime());
      const fresh = candidates.filter((c) => !progress.has(c.id));

      const items = [...due, ...fresh].slice(0, limit).map((item) => ({
        ...item,
        due: progress.get(item.id)?.due ?? null,
        isNew: !progress.has(item.id),
      }));
      return { items, total: candidates.length, due: due.length, new: fresh.length };
    },
  );

  app.post<{ Body: { itemId?: unknown; correct?: unknown; ms?: unknown; peeked?: unknown; answered?: unknown } }>(
    "/api/review",
    { preHandler: requireUser },
    async (req, reply) => {
      const { itemId, correct, ms, peeked, answered } = req.body ?? {};
      if (typeof itemId !== "string") return reply.code(400).send({ error: "нет itemId" });
      if (typeof correct !== "boolean") return reply.code(400).send({ error: "correct — boolean" });
      const index = await itemIndex();
      const entry = index.get(itemId);
      if (!entry) return reply.code(404).send({ error: "вопрос не найден" });

      const result = review({
        userId: req.user!.id,
        itemId,
        rule: entry.item.rule,
        tags: entry.item.tags,
        correct,
        ms: typeof ms === "number" && Number.isFinite(ms) ? Math.round(ms) : null,
        peeked: peeked === true,
        answered: typeof answered === "string" ? answered : null,
      });
      return { itemId, ...result };
    },
  );

  return app;
}
