import "./style.css";
import { api, type PublicUser } from "./api";
import { renderProfiles } from "./views/profiles";
import { renderTopics } from "./views/topics";
import { renderSession } from "./views/session";
import { renderStats } from "./views/stats";

const app = document.getElementById("app")!;
const nav = document.getElementById("nav")!;

function renderNav(user: PublicUser | null) {
  nav.innerHTML = "";
  if (!user) return;
  const stats = document.createElement("a");
  stats.href = "#/stats";
  stats.textContent = "Статистика";
  const who = document.createElement("a");
  who.href = "#/profiles";
  who.className = "who";
  who.textContent = user.display;
  nav.append(stats, who);
}

async function route() {
  let user: PublicUser | null = null;
  try {
    user = (await api.me()).user;
  } catch {
    user = null;
  }
  renderNav(user);

  const hash = location.hash || "#/topics";
  const [path, query] = hash.split("?");
  const sessionMatch = hash.match(/^#\/session\/(.+)$/);

  if (hash === "#/profiles" || !user) {
    renderProfiles(app, () => {
      location.hash = "#/topics";
      route();
    });
    return;
  }
  if (sessionMatch) {
    await renderSession(app, decodeURIComponent(sessionMatch[1]));
    return;
  }
  if (path === "#/stats") {
    const days = new URLSearchParams(query).get("days") === "30" ? 30 : 7;
    await renderStats(app, days);
    return;
  }
  await renderTopics(app);
}

window.addEventListener("hashchange", route);
route();
