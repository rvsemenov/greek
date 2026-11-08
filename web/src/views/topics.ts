import { api, type RuleMeta } from "../api";
import { esc } from "../text";

const LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

export async function renderTopics(root: HTMLElement) {
  root.innerHTML = `<h1>Темы</h1><p class="muted">Загружаю…</p>`;

  const [{ rules }, { tests }] = await Promise.all([api.rules(), api.tests()]);

  const counts = new Map<string, number>();
  for (const t of tests) {
    if (t.kind === "level" && t.rule) counts.set(t.rule, (counts.get(t.rule) ?? 0) + t.count);
  }

  const byLevel = new Map<string, RuleMeta[]>();
  for (const r of rules) {
    const list = byLevel.get(r.level) ?? [];
    list.push(r);
    byLevel.set(r.level, list);
  }

  const sections = LEVEL_ORDER.filter((lvl) => byLevel.has(lvl)).map((lvl) => {
    const items = byLevel.get(lvl)!.map((r) => {
      const n = counts.get(r.id) ?? 0;
      const link = n > 0
        ? `<a class="topic-go" href="#/session/${encodeURIComponent(r.id)}">${n} вопр.</a>`
        : `<span class="muted">нет теста</span>`;
      return `<li class="topic ${n > 0 ? "" : "empty"}">
        <div><strong>${esc(r.title)}</strong><small>${esc(r.id)}</small></div>
        ${link}
      </li>`;
    });
    return `<section class="card"><h2>${lvl}</h2><ul class="topics">${items.join("")}</ul></section>`;
  });

  root.innerHTML = `<h1>Темы</h1>${sections.join("") || `<p class="muted">Правил нет.</p>`}`;
}
