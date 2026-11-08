import { api, type StatBucket } from "../api";
import { esc } from "../text";

const MIN_SAMPLE_NOTE = "Меньше 5 попыток — пока мало данных, процент ни о чём не говорит.";

function bar(percent: number): string {
  return `<span class="bar"><span style="width:${Math.min(100, Math.max(0, percent))}%"></span></span>`;
}

function bucketRows(items: StatBucket[]): string {
  return items
    .map(
      (b) => `<tr class="${b.enough ? "" : "muted"}">
        <td>${esc(b.key)}</td>
        <td class="num">${b.total}</td>
        <td class="num">${b.enough ? `${b.errorRate}%` : "—"}</td>
        <td class="bar-cell">${b.enough ? bar(b.errorRate) : ""}</td>
      </tr>`,
    )
    .join("");
}

export async function renderStats(root: HTMLElement, days: number) {
  root.innerHTML = `<p class="muted">Считаю…</p>`;
  const [stats, compare] = await Promise.all([api.stats(days), api.compare(days)]);

  const strong = stats.byTag.filter((b) => b.enough).slice(0, 8);
  const weak = strong.filter((b) => b.errorRate > 0);
  const sparse = stats.byTag.filter((b) => !b.enough);
  const maxDay = Math.max(1, ...stats.perDay.map((d) => d.count));

  root.innerHTML = `
    <h1>Статистика</h1>
    <div class="period">
      <a class="button ${days === 7 ? "primary" : ""}" href="#/stats?days=7">7 дней</a>
      <a class="button ${days === 30 ? "primary" : ""}" href="#/stats?days=30">30 дней</a>
    </div>

    <section class="card summary-row">
      <div><span class="big">${stats.total}</span><small>ответов</small></div>
      <div><span class="big">${stats.total ? 100 - stats.errorRate : 0}%</span><small>верно</small></div>
    </section>

    <section class="card">
      <h2>Слабые места</h2>
      ${
        weak.length
          ? `<table class="stat-table"><thead><tr><th>Тег</th><th class="num">Ответов</th><th class="num">Ошибок</th><th></th></tr></thead>
             <tbody>${bucketRows(weak)}</tbody></table>`
          : `<p class="muted">Пока нет тегов с ошибками и достаточным количеством ответов.</p>`
      }
      ${sparse.length ? `<p class="muted note">${esc(MIN_SAMPLE_NOTE)}</p>` : ""}
    </section>

    <section class="card">
      <h2>По правилам</h2>
      ${
        stats.byRule.length
          ? `<table class="stat-table"><thead><tr><th>Правило</th><th class="num">Ответов</th><th class="num">Ошибок</th><th></th></tr></thead>
             <tbody>${bucketRows(stats.byRule)}</tbody></table>`
          : `<p class="muted">За период ответов нет.</p>`
      }
    </section>

    <section class="card">
      <h2>По дням</h2>
      ${
        stats.perDay.length
          ? `<div class="days">${stats.perDay
              .map(
                (d) => `<div class="day" title="${esc(d.day)}: ${d.count}">
                  <span style="height:${Math.round((d.count / maxDay) * 100)}%"></span>
                  <small>${esc(d.day.slice(5))}</small></div>`,
              )
              .join("")}</div>`
          : `<p class="muted">За период ответов нет.</p>`
      }
    </section>

    <section class="card">
      <h2>Сравнение профилей</h2>
      <table class="stat-table"><thead><tr><th>Профиль</th><th class="num">Ответов</th><th class="num">Верно</th></tr></thead>
        <tbody>${compare.users
          .map((u) => `<tr><td>${esc(u.display)}</td><td class="num">${u.total}</td><td class="num">${u.right}</td></tr>`)
          .join("")}</tbody></table>
    </section>

    <section class="card">
      <h2>Выгрузка для агента</h2>
      <p class="muted note">Файл JSONL, по строке на ответ. Нужен агенту, чтобы собрать добивочный тест.</p>
      <p>
        <a class="button" href="/api/mistakes.jsonl?days=${days}" download>Все ответы</a>
        <a class="button" href="/api/mistakes.jsonl?days=${days}&onlyWrong=1" download>Только ошибки</a>
      </p>
    </section>
  `;
}
