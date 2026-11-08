import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? "0.0.0.0",
  // Контент (правила, слова, тесты) лежит в корне репозитория.
  contentDir: resolve(process.env.CONTENT_DIR ?? resolve(here, "../..")),
  dataDir: resolve(process.env.DATA_DIR ?? resolve(here, "../../data")),
  webDist: resolve(process.env.WEB_DIST ?? resolve(here, "../../web/dist")),
  sessionSecret: process.env.SESSION_SECRET ?? "dev-only-change-me",
  cookieSecure: process.env.COOKIE_SECURE === "1",
};
