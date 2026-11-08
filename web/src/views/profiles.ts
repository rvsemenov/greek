import { api, ApiError, type PublicUser } from "../api";
import { esc } from "../text";

export async function renderProfiles(root: HTMLElement, onDone: () => void) {
  root.innerHTML = `
    <section class="card">
      <h1>Кто учится?</h1>
      <div class="profiles" id="profiles"></div>
      <div id="pin-box"></div>
    </section>
    <section class="card">
      <h2>Новый профиль</h2>
      <form id="new-form" class="form">
        <label>Имя (латиницей или кириллицей, без пробелов)
          <input name="name" required maxlength="32" autocomplete="off" />
        </label>
        <label>Как показывать
          <input name="display" maxlength="32" autocomplete="off" />
        </label>
        <label>PIN из 4 цифр (необязательно)
          <input name="pin" inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="off" />
        </label>
        <p class="error" id="new-error" hidden></p>
        <button type="submit" class="primary">Создать и войти</button>
      </form>
    </section>
  `;

  const list = root.querySelector<HTMLElement>("#profiles")!;
  const pinBox = root.querySelector<HTMLElement>("#pin-box")!;
  const errorBox = root.querySelector<HTMLElement>("#new-error")!;

  const { users } = await api.users();
  if (users.length === 0) {
    list.innerHTML = `<p class="muted">Профилей пока нет — создай первый ниже.</p>`;
  }
  for (const u of users) {
    const btn = document.createElement("button");
    btn.className = "profile";
    btn.innerHTML = `<span class="avatar">${esc(u.display.slice(0, 1).toUpperCase())}</span>
      <span>${esc(u.display)}</span>
      <small>${u.level}${u.hasPin ? " · 🔒" : ""}</small>`;
    btn.addEventListener("click", () => {
      if (u.hasPin) askPin(u);
      else void login(u, undefined);
    });
    list.append(btn);
  }

  function askPin(u: PublicUser) {
    pinBox.innerHTML = `
      <form class="form pin-form">
        <p>PIN для <strong>${esc(u.display)}</strong></p>
        <input name="pin" inputmode="numeric" pattern="\\d{4}" maxlength="4" autofocus autocomplete="off" />
        <p class="error" hidden></p>
        <button type="submit" class="primary">Войти</button>
      </form>`;
    const form = pinBox.querySelector<HTMLFormElement>("form")!;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const pin = (form.elements.namedItem("pin") as HTMLInputElement).value;
      void login(u, pin, form.querySelector<HTMLElement>(".error")!);
    });
  }

  async function login(u: PublicUser, pin: string | undefined, errEl?: HTMLElement) {
    try {
      await api.login(u.name, pin ?? "");
      onDone();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "не удалось войти";
      if (errEl) {
        errEl.textContent = msg;
        errEl.hidden = false;
      }
    }
  }

  root.querySelector<HTMLFormElement>("#new-form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    const display = (form.elements.namedItem("display") as HTMLInputElement).value.trim() || name;
    const pin = (form.elements.namedItem("pin") as HTMLInputElement).value.trim();
    try {
      await api.createUser(name, display, pin);
      await api.login(name, pin);
      onDone();
    } catch (err) {
      errorBox.textContent = err instanceof ApiError ? err.message : "ошибка";
      errorBox.hidden = false;
    }
  });
}
