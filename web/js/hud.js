// DOM panels next to the island: counters, "Needs you" cards and the session list.
// All user-derived text goes through textContent (commands and file names come from hooks).
import { looksFor } from "./sprites.js";

const STATUS_LABEL = {
  needsYou: "Needs you",
  working: "Working",
  thinking: "Thinking",
  done: "Done",
  idle: "Idle",
  ended: "Leaving",
};
const STATUS_ORDER = { needsYou: 0, working: 1, thinking: 2, idle: 3, done: 4, ended: 5 };
const REASON_LABEL = { permission: "Wants permission", question: "Has a question" };

export function createHud({ counts, needs, sessions, onSelect }) {
  function render(state, now, selectedId) {
    const projectName = new Map(state.projects.map((p) => [p.id, p.name]));
    const live = state.sessions.filter((s) => s.status !== "ended");
    renderCounts(live);
    renderNeeds(live.filter((s) => s.status === "needsYou"), projectName, now);
    renderSessions(live, projectName, now, selectedId);
  }

  function renderCounts(live) {
    const n = (status) => live.filter((s) => s.status === status).length;
    counts.replaceChildren(
      chip(`${n("working") + n("thinking")} working`, "working"),
      chip(`${n("needsYou")} need you`, n("needsYou") ? "needsYou" : "muted"),
      chip(`${n("done") + n("idle")} resting`, "done")
    );
  }

  function renderNeeds(list, projectName, now) {
    needs.hidden = list.length === 0;
    if (!list.length) return needs.replaceChildren();
    const cards = list
      .sort((a, b) => (a.needsYou?.since || 0) - (b.needsYou?.since || 0))
      .map((s) => {
        const card = el("button", "needs-card");
        card.append(
          el("div", "needs-top", `${projectName.get(s.projectId) || "?"} · ${REASON_LABEL[s.needsYou?.reason] || "Needs you"}`),
          el("div", "needs-detail", s.needsYou?.detail || s.activity),
          el("div", "needs-time", `waiting ${ago(now - (s.needsYou?.since || s.since))}`)
        );
        card.onclick = () => onSelect(s.id);
        return card;
      });
    needs.replaceChildren(el("h2", "", "Needs you"), ...cards);
  }

  function renderSessions(list, projectName, now, selectedId) {
    if (!list.length) {
      sessions.replaceChildren(el("h2", "", "Colonists"), el("p", "empty", "Nobody on the island. Start a Claude Code session and a colonist will arrive."));
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
      group.append(el("h3", "", projectName.get(id) || "?"));
      for (const s of items) group.append(row(s, now, selectedId));
      return group;
    });
    sessions.replaceChildren(el("h2", "", "Colonists"), ...groups);
  }

  function row(s, now, selectedId) {
    const item = el("button", `row${s.id === selectedId ? " selected" : ""}`);
    const dot = el("span", "dot");
    dot.style.background = looksFor(s.id).shirt;
    const main = el("div", "row-main");
    main.append(el("div", "row-title", s.title || `Session ${s.id.slice(0, 4)}`), el("div", "row-activity", s.activity));
    const side = el("div", "row-side");
    side.append(el("span", `pill ${s.status}`, STATUS_LABEL[s.status] || s.status), el("span", "row-time", ago(now - s.since)));
    if (s.helpers?.length) side.append(el("span", "row-helpers", `+${s.helpers.length} helper${s.helpers.length > 1 ? "s" : ""}`));
    item.append(dot, main, side);
    item.onclick = () => onSelect(s.id);
    return item;
  }

  return { render };
}

function chip(text, kind) {
  return el("span", `chip ${kind}`, text);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function ago(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}
