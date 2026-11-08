import { marked } from "marked";
import { api, type Item } from "../api";
import { esc, judge, shuffle } from "../text";

const TEXT_TYPES = new Set(["inflect", "cloze", "translate"]);

interface State {
  items: Item[];
  index: number;
  correct: number;
  startedAt: number;
  peeked: boolean;
  answered: boolean;
}

export async function renderSession(root: HTMLElement, ruleId: string) {
  root.innerHTML = `<p class="muted">Загружаю…</p>`;

  let rule;
  try {
    rule = await api.rule(ruleId);
  } catch {
    root.innerHTML = `<p class="error">Правило ${esc(ruleId)} не найдено.</p>`;
    return;
  }

  const queue = await api.queue(ruleId, 20);

  const state: State = {
    items: queue.items,
    index: 0,
    correct: 0,
    startedAt: 0,
    peeked: false,
    answered: false,
  };

  const card = document.createElement("section");
  card.className = "card session";
  card.innerHTML = `
    <header class="session-head">
      <a href="#/topics" class="back">← Темы</a>
      <h1>${esc(rule.title)}</h1>
      <div class="session-meta">
        <span id="progress"></span>
        <button class="ghost" id="open-rule">Правило</button>
      </div>
    </header>
    <div id="body"></div>
    <dialog id="rule-sheet" class="rule-sheet">
      <div class="sheet-head">
        <strong>${esc(rule.title)}</strong>
        <button class="ghost" id="close-rule">Закрыть</button>
      </div>
      <p class="muted sheet-note" id="peek-note" hidden>Подглядывание засчитано: ответ оценится как «трудно».</p>
      <div class="rule-body">${marked.parse(rule.body, { async: false })}</div>
    </dialog>
  `;
  root.replaceChildren(card);

  bindRuleButton(card, () => {
    if (!state.answered) state.peeked = true;
    return state.peeked;
  });

  if (queue.items.length === 0) {
    card.querySelector<HTMLElement>("#body")!.innerHTML = `
      <p>На сегодня по этой теме всё сделано: новых вопросов нет, повторений тоже нет.</p>
      <p><a class="button" href="#/topics">К темам</a></p>`;
    return;
  }

  showQuestion(card, state);
}

function bindRuleButton(root: HTMLElement, onOpen: () => boolean) {
  const dialog = root.querySelector<HTMLDialogElement>("#rule-sheet");
  const open = root.querySelector<HTMLButtonElement>("#open-rule");
  const close = root.querySelector<HTMLButtonElement>("#close-rule");
  const note = root.querySelector<HTMLElement>("#peek-note");
  open?.addEventListener("click", () => {
    const peeked = onOpen();
    if (note) note.hidden = !peeked;
    dialog?.showModal();
  });
  close?.addEventListener("click", () => dialog?.close());
}

function showQuestion(card: HTMLElement, state: State) {
  const body = card.querySelector<HTMLElement>("#body")!;
  const progress = card.querySelector<HTMLElement>("#progress")!;

  if (state.index >= state.items.length) {
    showSummary(card, state);
    return;
  }

  const item = state.items[state.index];
  progress.textContent = `${state.index + 1} / ${state.items.length}`;
  state.peeked = false;
  state.answered = false;
  state.startedAt = performance.now();

  if (item.type === "choice" || item.type === "article") {
    body.innerHTML = `
      <p class="prompt">${esc(item.prompt)}</p>
      <div class="options">
        ${shuffle(item.options ?? []).map((o) => `<button class="option" data-value="${esc(o)}">${esc(o)}</button>`).join("")}
      </div>
      <div id="feedback"></div>`;
    body.querySelectorAll<HTMLButtonElement>(".option").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (state.answered) return;
        void submit(card, state, btn.dataset.value ?? "", true);
      });
    });
  } else if (TEXT_TYPES.has(item.type)) {
    body.innerHTML = `
      <p class="prompt">${esc(item.prompt)}</p>
      <form class="answer-form">
        <input name="answer" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus />
        <button type="submit" class="primary">Проверить</button>
      </form>
      <div id="feedback"></div>`;
    const form = body.querySelector<HTMLFormElement>("form")!;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (state.answered) return;
      const value = (form.elements.namedItem("answer") as HTMLInputElement).value;
      void submit(card, state, value, false);
    });
  } else {
    body.innerHTML = `<p class="error">Тип «${esc(item.type)}» пока не поддерживается.</p>`;
  }
}

async function submit(card: HTMLElement, state: State, typed: string, isChoice: boolean) {
  const item = state.items[state.index];
  state.answered = true;
  const ms = Math.round(performance.now() - state.startedAt);

  const accepted = item.accept?.length ? item.accept : [item.answer];
  const verdict = isChoice
    ? { kind: typed === item.answer ? ("exact" as const) : ("wrong" as const) }
    : judge(typed, accepted);
  const correct = verdict.kind !== "wrong";
  if (correct) state.correct++;

  card.querySelectorAll<HTMLButtonElement>(".option").forEach((btn) => {
    btn.disabled = true;
    if (btn.dataset.value === item.answer) btn.classList.add("right");
    else if (btn.dataset.value === typed && !correct) btn.classList.add("wrong");
  });
  card.querySelectorAll<HTMLInputElement>("input[name=answer]").forEach((i) => (i.disabled = true));
  card.querySelectorAll<HTMLButtonElement>(".answer-form button").forEach((b) => (b.disabled = true));

  const feedback = card.querySelector<HTMLElement>("#feedback")!;
  const headline =
    verdict.kind === "wrong"
      ? `<p class="verdict wrong">Неверно. Правильно: <strong>${esc(item.answer)}</strong></p>`
      : verdict.kind === "accent"
        ? `<p class="verdict accent">Правильно, но ударение: <strong>${esc(verdict.expected)}</strong></p>`
        : `<p class="verdict right">Верно</p>`;
  feedback.innerHTML = `${headline}
    <p class="why">${esc(item.why)}</p>
    <button class="primary" id="next">${state.index + 1 < state.items.length ? "Дальше" : "Итог"}</button>`;
  feedback.querySelector("#next")!.addEventListener("click", () => {
    state.index++;
    showQuestion(card, state);
  });

  try {
    await api.review({
      itemId: item.id,
      correct,
      ms,
      peeked: state.peeked,
      answered: typed,
    });
  } catch (err) {
    feedback.insertAdjacentHTML("beforeend", `<p class="error">Не сохранилось: ${esc(String(err))}</p>`);
  }
}

function showSummary(card: HTMLElement, state: State) {
  const body = card.querySelector<HTMLElement>("#body")!;
  const pct = Math.round((state.correct / state.items.length) * 100);
  body.innerHTML = `
    <div class="summary">
      <p class="big">${state.correct} / ${state.items.length}</p>
      <p class="muted">${pct}% верно</p>
      <p>
        <button class="primary" id="again">Ещё раз</button>
        <a class="button" href="#/topics">К темам</a>
      </p>
    </div>`;
  card.querySelector<HTMLElement>("#progress")!.textContent = "";
  card.querySelector<HTMLButtonElement>("#again")!.addEventListener("click", () => location.reload());
}
