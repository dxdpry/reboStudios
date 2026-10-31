// Glass panels around the island: status counters, "Needs you" alert cards and the session list.
// All hook-derived text goes through textContent.
import { ICONS } from "./icons.js";
import { ago } from "./format.js";

const STATUS_LABEL = { needsYou: "Needs you", working: "Working", thinking: "Thinking", done: "Done", idle: "Idle" };
const STATUS_ORDER = { needsYou: 0, working: 1, thinking: 2, idle: 3, done: 4 };
const REASON_LABEL = { permission: "Wants permission", question: "Has a question" };

export function createPanels({ counts, alerts, sessions, sessionsBody, sessionsToggle, onSelect, onOpenChat, colorOf }) {
  sessionsToggle.addEventListener("click", () => sessions.classList.toggle("collapsed"));
  // Phones start with the list folded so the island stays visible.
  if (window.matchMedia("(max-width: 760px)").matches) sessions.classList.add("collapsed");
  sessions.querySelector(".panel-chevron").innerHTML = ICONS.chevron;
  sessions.querySelector(".panel-icon").innerHTML = ICONS.users;

  const countEls = {};
  for (const [key, label] of [["working", "Working"], ["needsYou", "Needs you"], ["resting", "Resting"]]) {
    const item = el("div", `count ${key}`);
    const num = el("span", "count-num", "0");
    item.append(el("span", "count-label", label), num);
    counts.append(item);
    countEls[key] = { item, num };
  }

  function render(state, now, selectedId) {
    const projectName = new Map(state.projects.map((p) => [p.id, p.name]));
    const live = state.sessions.filter((s) => s.status !== "ended");
    renderCounts(live);
    renderAlerts(live.filter((s) => s.status === "needsYou"), projectName, now);
    renderSessions(live, projectName, now, selectedId);
  }

  function renderCounts(live) {
    const n = (...statuses) => live.filter((s) => statuses.includes(s.status)).length;
    const values = { working: n("working", "thinking"), needsYou: n("needsYou"), resting: n("done", "idle") };
    for (const [key, { item, num }] of Object.entries(countEls)) {
      num.textContent = String(values[key]);
      item.classList.toggle("active", values[key] > 0);
    }
  }

  // Cards are kept per session so the entry animation only plays when an alert first appears.
  const alertCards = new Map();
  function renderAlerts(list, projectName, now) {
    const ordered = list.sort((a, b) => (a.needsYou?.since || 0) - (b.needsYou?.since || 0));
    for (const s of ordered) {
      if (!alertCards.has(s.id)) alertCards.set(s.id, buildAlertCard(s.id));
      const card = alertCards.get(s.id);
      card.project.textContent = projectName.get(s.projectId) || "Session";
      card.reason.textContent = REASON_LABEL[s.needsYou?.reason] || "Needs you";
      card.detail.textContent = s.needsYou?.detail || s.activity;
      card.time.textContent = `waiting ${ago(now - (s.needsYou?.since || s.since))}`;
    }
    const live = new Set(ordered.map((s) => s.id));
    for (const id of alertCards.keys()) if (!live.has(id)) alertCards.delete(id);
    // Re-inserting a node restarts its CSS animation, so only touch the DOM when the list changed.
    const wanted = ordered.map((s) => alertCards.get(s.id).root);
    const current = [...alerts.children];
    if (wanted.length !== current.length || wanted.some((node, i) => node !== current[i])) alerts.replaceChildren(...wanted);
  }

  function buildAlertCard(id) {
    const root = el("article", "alert-card");
    const head = el("header", "alert-head");
    const icon = el("span", "alert-icon");
    icon.innerHTML = ICONS.alert;
    const project = el("strong");
    const reason = el("span", "alert-reason");
    head.append(icon, project, reason);
    const detail = el("code", "alert-detail");
    const time = el("span", "alert-time");
    const show = el("button", "alert-show", "Answer");
    show.type = "button";
    show.onclick = () => {
      onSelect(id, true);
      onOpenChat(id);
    };
    const foot = el("footer", "alert-foot");
    foot.append(time, show);
    root.append(head, detail, foot);
    return { root, project, reason, detail, time };
  }

  function renderSessions(list, projectName, now, selectedId) {
    sessions.querySelector(".panel-count").textContent = String(list.length);
    if (!list.length) {
      sessionsBody.replaceChildren(el("p", "empty", "Nobody at work yet. Start a Claude Code session and someone will take the elevator up."));
      return;
    }
    const byProject = new Map();
    for (const s of list) {
      if (!byProject.has(s.projectId)) byProject.set(s.projectId, []);
      byProject.get(s.projectId).push(s);
    }
    const groups = [...byProject.entries()].map(([id, items]) => {
      items.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.startedAt - b.startedAt);
      const group = el("section", "group");
      const title = el("h3", "group-title");
      const swatch = el("span", "group-swatch");
      swatch.style.background = colorOf(id);
      title.append(swatch, el("span", "", projectName.get(id) || "Project"));
      group.append(title);
      for (const s of items) group.append(row(s, now, selectedId));
      return group;
    });
    sessionsBody.replaceChildren(...groups);
  }

  function row(s, now, selectedId) {
    const item = el("button", `row${s.id === selectedId ? " selected" : ""}`);
    item.type = "button";
    const main = el("div", "row-main");
    main.append(el("div", "row-title", s.title || `Session ${s.id.slice(0, 4)}`), el("div", "row-activity", s.activity));
    const side = el("div", "row-side");
    side.append(el("span", `pill ${s.status}`, STATUS_LABEL[s.status] || s.status), el("span", "row-time", ago(now - s.since)));
    if (s.helpers?.length) side.append(el("span", "row-helpers", `+${s.helpers.length} helper${s.helpers.length > 1 ? "s" : ""}`));
    item.append(main, side);
    item.onclick = () => {
      onSelect(s.id, true);
      onOpenChat(s.id);
    };
    return item;
  }

  return { render };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
