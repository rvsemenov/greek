import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { config } from "./config.js";

export interface RuleMeta {
  id: string;
  title: string;
  level: string;
  tags: string[];
  requires: string[];
  source?: string;
}

export interface TestItem {
  id: string;
  type: string;
  prompt: string;
  options?: string[];
  answer: string;
  accept?: string[];
  why: string;
  words: string[];
  tags: string[];
  rule: string;
}

export interface TestFile {
  file: string;
  kind: "level" | "drill";
  rule?: string;
  level?: string;
  title: string;
  items: TestItem[];
}

interface Cached<T> {
  mtimeMs: number;
  value: T;
}

const cache = new Map<string, Cached<unknown>>();

// Файл перечитывается только когда изменился mtime: git pull на сервере подхватывается без перезапуска.
async function cachedFile<T>(path: string, parse: (text: string) => T): Promise<T> {
  const { mtimeMs } = await stat(path);
  const hit = cache.get(path) as Cached<T> | undefined;
  if (hit && hit.mtimeMs === mtimeMs) return hit.value;
  const value = parse(await readFile(path, "utf8"));
  cache.set(path, { mtimeMs, value });
  return value;
}

// Построчный разбор, как в tools/check-rules.py: это и есть контракт формата.
// Полный YAML не нужен, и заголовки вида «title: A: B» не ломают чтение.
function parseFrontmatter(text: string): { meta: Record<string, unknown>; body: string } | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return null;
  const meta: Record<string, unknown> = {};
  for (const line of text.slice(4, end).split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!m) return null;
    const raw = m[2].trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      meta[m[1]] = raw
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
    } else {
      meta[m[1]] = unquote(raw);
    }
  }
  return { meta, body: text.slice(end + 5) };
}

function unquote(s: string): string {
  return s.replace(/^(["'])(.*)\1$/, "$2");
}

function parseRule(text: string, id: string): RuleMeta & { body: string } {
  const parsed = parseFrontmatter(text);
  if (!parsed) throw new Error(`${id}: нет или битый frontmatter`);
  const { meta, body } = parsed;
  return {
    id: (meta.id as string) ?? id,
    title: (meta.title as string) ?? id,
    level: (meta.level as string) ?? id.split("/")[0],
    tags: (meta.tags as string[]) ?? [],
    requires: (meta.requires as string[]) ?? [],
    source: meta.source as string | undefined,
    body,
  };
}

async function walk(dir: string, filter: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, filter)));
    else if (filter(e.name)) out.push(p);
  }
  return out.sort();
}

export async function listRules(): Promise<(RuleMeta & { body: string })[]> {
  const root = join(config.contentDir, "source", "rules");
  const files = await walk(root, (n) => n.endsWith(".md") && n !== "README.md");
  const rules = await Promise.all(
    files.map((f) => {
      const id = relative(root, f).split(sep).join("/").replace(/\.md$/, "");
      return cachedFile(f, (text) => parseRule(text, id));
    }),
  );
  return rules;
}

export async function getRule(id: string) {
  const rules = await listRules();
  return rules.find((r) => r.id === id) ?? null;
}

export async function listTests(): Promise<TestFile[]> {
  const root = join(config.contentDir, "tests");
  const files = await walk(root, (n) => n.endsWith(".json"));
  const out: TestFile[] = [];
  for (const f of files) {
    const file = relative(config.contentDir, f).split(sep).join("/");
    let data;
    try {
      data = await cachedFile(f, (text) => JSON.parse(text));
    } catch (err) {
      console.error(`пропускаю ${file}: ${(err as Error).message}`);
      continue;
    }
    const isDrill = data.kind === "drill";
    const items: TestItem[] = (data.items ?? []).map((it: TestItem) => ({
      ...it,
      rule: isDrill ? it.rule : data.rule,
    }));
    out.push({
      file,
      kind: isDrill ? "drill" : "level",
      rule: isDrill ? undefined : data.rule,
      level: isDrill ? undefined : data.level,
      title: data.title ?? file,
      items,
    });
  }
  return out;
}

export interface IndexedItem {
  item: TestItem;
  file: string;
  level: string;
}

export async function itemIndex(): Promise<Map<string, IndexedItem>> {
  const index = new Map<string, IndexedItem>();
  for (const t of await listTests()) {
    for (const item of t.items) {
      const level = item.rule.split("/")[0];
      index.set(item.id, { item, file: t.file, level });
    }
  }
  return index;
}
