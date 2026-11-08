import { api, ApiError } from "../api";
import { esc } from "../text";

export async function renderSettings(root: HTMLElement) {
  const { user } = await api.me();
  root.innerHTML = `
    <section class="card">
      <h1>Настройки профиля</h1>
      <p>Профиль: <strong>${esc(user.display)}</strong> (${esc(user.name)})</p>
      <p class="muted">PIN: ${user.hasPin ? "задан" : "не задан, вход без PIN"}</p>
      <form class="form" id="pin-form">
        ${
          user.hasPin
            ? `<label>Текущий PIN
                 <input name="currentPin" inputmode="numeric" pattern="\\d{4}" maxlength="4" required autocomplete="off" />
               </label>`
            : ""
        }
        <label>${user.hasPin ? "Новый PIN (необязательно, 4 цифры)" : "PIN из 4 цифр"}
          <input name="pin" inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="off" />
        </label>
        <p class="error" id="pin-error" hidden></p>
        <p class="ok" id="pin-ok" hidden></p>
        <div class="row">
          <button type="submit" class="primary">${user.hasPin ? "Сменить PIN" : "Установить PIN"}</button>
          ${user.hasPin ? `<button type="button" id="remove-pin">Убрать PIN</button>` : ""}
        </div>
      </form>
    </section>
  `;

  const form = root.querySelector<HTMLFormElement>("#pin-form")!;
  const errorBox = root.querySelector<HTMLElement>("#pin-error")!;
  const okBox = root.querySelector<HTMLElement>("#pin-ok")!;

  async function save(pin: string) {
    const currentPin = user.hasPin ? (form.elements.namedItem("currentPin") as HTMLInputElement).value.trim() : "";
    errorBox.hidden = true;
    okBox.hidden = true;
    try {
      await api.setPin(currentPin, pin);
      await renderSettings(root);
      const ok = root.querySelector<HTMLElement>("#pin-ok");
      if (ok) {
        ok.textContent = pin ? "PIN сохранён" : "PIN убран";
        ok.hidden = false;
      }
    } catch (err) {
      errorBox.textContent = err instanceof ApiError ? err.message : "ошибка";
      errorBox.hidden = false;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const pin = (form.elements.namedItem("pin") as HTMLInputElement).value.trim();
    if (!pin && user.hasPin) {
      void save("");
      return;
    }
    if (!pin) {
      errorBox.textContent = "Введите 4 цифры";
      errorBox.hidden = false;
      return;
    }
    void save(pin);
  });

  root.querySelector<HTMLButtonElement>("#remove-pin")?.addEventListener("click", () => {
    if (confirm("Убрать PIN? Профиль будет открываться без него.")) void save("");
  });
}
