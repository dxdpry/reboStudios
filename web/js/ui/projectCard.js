// Glass card with a project's history: when it started, time Claude worked on it, prompts, tokens.
import { ICONS } from "./icons.js";
import { ago, hours, compact, freshTokens, date } from "./format.js";
import { tierFor } from "../scene/island.js";

const TIER_NAMES = ["Hut", "Cottage", "House", "Manor"];
const NEXT_TIER_HOURS = [1, 5, 20];

export function createProjectCard(root, onClose) {
  root.innerHTML = `
    <header class="card-head">
      <span class="card-dot"></span>
      <div class="card-titles"><h2 class="card-name"></h2><p class="card-path"></p></div>
      <button class="card-close" type="button" aria-label="Close">${ICONS.close}</button>
    </header>
    <p class="card-status"></p>
    <dl class="card-grid">
      <div><dt>Started</dt><dd data-k="started"></dd></div>
      <div><dt>Time with Claude</dt><dd data-k="hours"></dd></div>
      <div><dt>Prompts</dt><dd data-k="prompts"></dd></div>
      <div><dt>Tokens</dt><dd data-k="tokens"></dd></div>
    </dl>
    <div class="card-tokens"></div>
    <div class="card-level"><span class="level-name"></span><span class="level-bar"><span></span></span><span class="level-next"></span></div>`;
  root.querySelector(".card-close").addEventListener("click", onClose);
  const q = (sel) => root.querySelector(sel);

  function render(project, sessions, now) {
    root.hidden = !project;
    if (!project) return;
    const stats = project.stats || { activeMs: 0, prompts: 0, tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 } };
    const live = sessions.filter((s) => s.projectId === project.id && s.status !== "ended");
    const status = live.some((s) => s.status === "needsYou") ? "needsYou" : live.some((s) => s.status === "working" || s.status === "thinking") ? "running" : "idle";
    root.dataset.status = status;
    q(".card-name").textContent = project.name;
    q(".card-path").textContent = project.cwd || "";
    q(".card-status").textContent =
      status === "idle"
        ? `Idle · last activity ${ago(now - project.lastActiveAt)} ago`
        : `${status === "needsYou" ? "Waiting for you" : "Running"} · ${live.length} session${live.length > 1 ? "s" : ""} on it now`;
    q('[data-k="started"]').textContent = date(project.firstSeenAt);
    q('[data-k="hours"]').textContent = hours(stats.activeMs);
    q('[data-k="prompts"]').textContent = String(stats.prompts);
    q('[data-k="tokens"]').textContent = compact(freshTokens(stats.tokens));
    const t = stats.tokens;
    q(".card-tokens").textContent = `in ${compact(t.input)} · out ${compact(t.output)} · cache write ${compact(t.cacheWrite)} · cache read ${compact(t.cacheRead)}`;

    const tier = tierFor(project);
    q(".level-name").textContent = TIER_NAMES[tier];
    const next = NEXT_TIER_HOURS[tier];
    const worked = stats.activeMs / 3600000;
    const from = tier === 0 ? 0 : NEXT_TIER_HOURS[tier - 1];
    q(".level-bar span").style.width = next ? `${Math.min(100, ((worked - from) / (next - from)) * 100)}%` : "100%";
    q(".level-next").textContent = next ? `${TIER_NAMES[tier + 1]} at ${next} h` : "Max level";
  }

  return { render };
}
