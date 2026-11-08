// Сравнение ответов из OPTIONS.md §4.3: без ударений, ς → σ, без регистра.
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{Mn}/gu, "").normalize("NFC");
}

export function normalizeGreek(s: string): string {
  return stripAccents(s)
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export type Verdict =
  | { kind: "exact" }
  | { kind: "accent"; expected: string }
  | { kind: "wrong" };

// Точное совпадение — верно. Совпадение только с точностью до ударения — тоже верно,
// но показываем подсказку, какое ударение правильное.
export function judge(input: string, accepted: string[]): Verdict {
  const typed = input.trim();
  // Регистр и ς/σ не считаются ошибкой ударения: сравниваем с ними, но с ударением.
  const caseFolded = (s: string) => s.trim().toLowerCase().replace(/ς/g, "σ").normalize("NFC");
  if (accepted.some((a) => caseFolded(a) === caseFolded(typed))) return { kind: "exact" };
  const loose = normalizeGreek(typed);
  const hit = accepted.find((a) => normalizeGreek(a) === loose);
  if (hit) return { kind: "accent", expected: hit };
  return { kind: "wrong" };
}

export function shuffle<T>(xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
