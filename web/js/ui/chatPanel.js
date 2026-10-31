// Side panel for a conversation. Two kinds:
//  - manager: the project's manager (click the person in the floor's corner). Messages are tasks:
//    the server runs Claude Code in the project's folder; the gear sets how many agents it may use,
//    the folder and the permission mode. Before its first task it shows the project's latest chat.
//  - chat: any live chat (from a desk, an alert or the session list); messages wait for the chat's
//    next hook, Stop ends its turn at the next tool call.
// Held permission requests and questions are answered here. All transcript text is set with textContent.
import { ICONS } from "./icons.js";
import { ago } from "./format.js";
import { createRequestBox, button, el } from "./requestBox.js";

const POLL_MS = 2500;
const AGENTS_MAX = 6;
const MODES = [
  ["bypassPermissions", "Full access (no prompts)"],
  ["acceptEdits", "Edit files, ask for commands"],
  ["default", "Ask before changes"],
  ["plan", "Plan only, change nothing"],
];

export function createChatPanel(root, { sessionFor, permissionFor, managerFor, onTeamChange, onClose }) {
  root.innerHTML = `
    <header class="chat-head">
      <span class="card-dot"></span>
      <div class="card-titles"><h2 class="chat-title"></h2><p class="chat-status"></p></div>
      <button class="chat-gear" type="button" aria-label="Manager settings" title="Manager settings" hidden>${ICONS.gear}</button>
      <button class="card-close" type="button" aria-label="Close">${ICONS.close}</button>
    </header>
    <div class="chat-settings" hidden></div>
    <p class="chat-note" hidden></p>
    <ol class="chat-log" aria-live="polite"></ol>
    <p class="chat-error" hidden></p>
    <div class="chat-request" hidden></div>
    <div class="chat-pending" hidden></div>
    <form class="chat-form">
      <textarea class="chat-input" rows="2" maxlength="8000" aria-label="Message"></textarea>
      <div class="chat-actions">
        <p class="chat-hint"></p>
        <button class="chat-stop" type="button" hidden>${ICONS.stop}<span>Stop</span></button>
        <button class="chat-send" type="submit">${ICONS.send}<span>Send</span></button>
      </div>
    </form>`;
  const q = (sel) => root.querySelector(sel);
  const log = q(".chat-log");
  const input = q(".chat-input");
  const pendingBox = q(".chat-pending");
  const settings = q(".chat-settings");
  const errorLine = q(".chat-error");
  const requestBox = createRequestBox(q(".chat-request"), (requestId, answer) => post("/api/chat", { type: "permission", id: sessionId(), requestId, answer }));
  q(".card-close").addEventListener("click", () => close());
  q(".chat-gear").addEventListener("click", () => {
    settings.hidden = !settings.hidden;
    if (!settings.hidden) renderSettings();
  });
  q(".chat-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    sendMessage();
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      sendMessage();
    }
    if (ev.key === "Escape") close();
  });
  q(".chat-stop").addEventListener("click", () => (isManager() ? post("/api/manager", { type: "stop", projectId: current.projectId }) : post("/api/chat", { type: "stop", id: current.id })));

  let current = null; // { kind: "manager", projectId, title } | { kind: "chat", id, title }
  let data = null; // last answer from the server
  let timer = null;
  let lastKey = "";
  let sendError = "";

  const isManager = () => current && current.kind === "manager";
  const keyOf = (c) => (c.kind === "manager" ? `m:${c.projectId}` : `c:${c.id}`);
  // The chat that hooks, the inbox and permission requests know: the manager's own once it has run.
  const sessionId = () => (isManager() ? (managerFor(current.projectId) || {}).sessionId || (data && data.status && data.status.sessionId) : current && current.id);

  function open(next) {
    if (current && keyOf(current) === keyOf(next)) return;
    current = next;
    data = null;
    lastKey = "";
    sendError = "";
    requestBox.reset();
    log.replaceChildren();
    settings.hidden = true;
    root.hidden = false;
    root.dataset.kind = next.kind;
    document.body.classList.add("chat-open");
    q(".chat-title").textContent = next.title;
    q(".chat-gear").hidden = !isManager();
    input.placeholder = isManager() ? "Give the manager a task…" : "Message Claude…";
    refresh();
    clearInterval(timer);
    timer = setInterval(refresh, POLL_MS);
    input.focus();
  }

  function close() {
    if (!current) return;
    current = null;
    clearInterval(timer);
    root.hidden = true;
    document.body.classList.remove("chat-open");
    onClose();
  }

  async function refresh() {
    if (!current) return;
    const key = keyOf(current);
    const url = isManager() ? `/api/manager?projectId=${encodeURIComponent(current.projectId)}` : `/api/chat?id=${encodeURIComponent(current.id)}`;
    try {
      const res = await fetch(url, { headers: { "X-Rebo": "1" } });
      const next = await res.json();
      if (!current || keyOf(current) !== key) return;
      data = next;
      renderLog(next.items || []);
      if (!settings.hidden) renderSettings();
    } catch {
      // Server restarting: the next poll tries again.
    }
    renderStatus();
  }

  function renderLog(items) {
    const key = `${items.length}|${items.length ? items[items.length - 1].at + items[items.length - 1].text.length : 0}`;
    if (key === lastKey) return;
    lastKey = key;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.replaceChildren(...(items.length ? groupTools(items).map(itemNode) : [el("li", "chat-empty", isManager() ? "No tasks yet. Tell the manager what to do." : "Nothing in this chat yet.")]));
    if (atBottom || log.dataset.filled !== "1") log.scrollTop = log.scrollHeight;
    log.dataset.filled = "1";
  }

  // Tool calls in a row become one line ("Reading a.js · Editing b.js · +3"), so replies stand out.
  function groupTools(items) {
    const out = [];
    for (const item of items) {
      const prev = out[out.length - 1];
      if (item.role === "tool" && prev && prev.role === "tool") prev.tools.push(item.text);
      else out.push(item.role === "tool" ? { ...item, tools: [item.text] } : item);
    }
    for (const item of out) {
      if (!item.tools) continue;
      const shown = item.tools.slice(-2);
      item.text = item.tools.length > 2 ? `${shown.join(" · ")} · +${item.tools.length - 2}` : shown.join(" · ");
    }
    return out;
  }

  function itemNode(item) {
    const li = el("li", `chat-item is-${item.role}`);
    if (item.role === "tool") li.append(el("span", "chat-tool", item.text));
    else li.append(el("div", "chat-bubble", item.text));
    li.title = new Date(item.at).toLocaleString();
    return li;
  }

  // Also called every second from main, so the status follows the live state between polls.
  function renderStatus() {
    if (!current) return;
    const { status, text, hint, canStop } = isManager() ? managerStatus() : chatStatus();
    root.dataset.status = status;
    q(".chat-status").textContent = text || "";
    q(".chat-hint").textContent = hint;
    q(".chat-stop").hidden = !canStop;

    const note = q(".chat-note");
    note.hidden = !(isManager() && data && data.historyFrom === "latest");
    note.textContent = "This is your latest chat on this project. Your first task continues it in the manager's own chat.";
    const error = sendError || (isManager() && data && data.status && data.status.lastResult && data.status.lastResult.error) || "";
    errorLine.hidden = !error || (isManager() && status === "running");
    errorLine.textContent = error === "Stopped" ? "Stopped." : error;

    const id = sessionId();
    requestBox.render(id ? permissionFor(id) : null);
    renderPending((data && data.pending) || { messages: [], stop: false });
  }

  function managerStatus() {
    const live = managerFor(current.projectId) || (data && data.status) || {};
    const s = live.sessionId && sessionFor(live.sessionId);
    if (s && s.status === "needsYou") return { status: "needsYou", text: `Waiting for you · ${(s.needsYou && s.needsYou.detail) || s.activity}`, hint: "Answer above first; the next message goes after it.", canStop: true };
    if (live.running) {
      const agents = s && s.helpers && s.helpers.length ? ` · ${s.helpers.length} agent${s.helpers.length > 1 ? "s" : ""}` : "";
      return { status: "running", text: `${(s && s.activity) || "Starting…"}${agents}`, hint: "Working. A new message reaches it after its current step.", canStop: true };
    }
    const last = live.lastResult;
    return { status: "idle", text: last ? `Ready · last task ${ago(Date.now() - last.at)} ago` : "Ready for a task", hint: "Enter sends · Shift+Enter new line", canStop: false };
  }

  function chatStatus() {
    const s = sessionFor(current.id);
    const pending = (data && data.pending) || { stop: false };
    if (!s || s.status === "ended") return { status: "closed", text: "Not open in Claude right now", hint: "Delivered when this chat runs again.", canStop: false };
    if (s.status === "needsYou")
      return { status: "needsYou", text: `Waiting for you · ${(s.needsYou && s.needsYou.detail) || s.activity}`, hint: permissionFor(s.id) ? "Answer above first; the message goes after it." : "Answer the request in Claude first; the message goes after it.", canStop: false };
    if (s.status === "working" || s.status === "thinking") return { status: "running", text: s.activity, hint: "Claude reads it after its current step.", canStop: !pending.stop };
    return { status: "idle", text: `Idle · ${ago(Date.now() - (s.lastEventAt || Date.now()))} ago`, hint: "Delivered when this chat runs again.", canStop: false };
  }

  function renderPending(pending) {
    const parts = pending.messages.map((m) => `“${m.text.length > 90 ? m.text.slice(0, 89) + "…" : m.text}”`);
    if (pending.stop) parts.unshift("Stop requested");
    pendingBox.hidden = !parts.length;
    if (!parts.length) return;
    const cancel = button("chat-pending-cancel", "Cancel", () => (isManager() ? post("/api/manager", { type: "cancel", projectId: current.projectId }) : post("/api/chat", { type: "cancel", id: current.id })));
    pendingBox.replaceChildren(el("span", "chat-pending-label", "Waiting to be delivered"), el("span", "chat-pending-text", parts.join(" · ")), cancel);
  }

  // Manager settings: agents it may run at once, its folder, what it may do without asking.
  function renderSettings() {
    if (!isManager() || !data || !data.team) return;
    if (settings.contains(document.activeElement) && document.activeElement.tagName === "SELECT") return;
    const team = data.team;
    const projectId = current.projectId;
    const change = (patch) => onTeamChange(projectId, patch).then(refresh);

    const agents = el("div", "set-row");
    const stepper = el("div", "set-stepper");
    const minus = button("set-step", "−", () => change({ maxAgents: team.maxAgents - 1 }));
    const plus = button("set-step", "+", () => change({ maxAgents: team.maxAgents + 1 }));
    minus.disabled = team.maxAgents <= 1;
    plus.disabled = team.maxAgents >= AGENTS_MAX;
    stepper.append(minus, el("span", "set-value", String(team.maxAgents)), plus);
    agents.append(el("span", "set-label", "Agents at once"), stepper);

    const folder = el("div", "set-row");
    const folderSelect = el("select", "set-select");
    const options = [...new Set([team.cwd, ...(data.folders || [])].filter(Boolean))];
    if (!options.length) folderSelect.append(el("option", "", "No folder yet"));
    for (const dir of options) {
      const o = el("option", "", dir);
      o.value = dir;
      o.selected = dir === team.cwd;
      folderSelect.append(o);
    }
    folderSelect.onchange = () => change({ cwd: folderSelect.value });
    const other = button("set-link", "Other…", () => {
      const dir = window.prompt("Full path of the project's folder", team.cwd || "");
      if (dir && dir.trim()) change({ cwd: dir.trim() });
    });
    folder.append(el("span", "set-label", "Folder"), folderSelect, other);

    const mode = el("div", "set-row");
    const modeSelect = el("select", "set-select");
    for (const [value, label] of MODES) {
      const o = el("option", "", label);
      o.value = value;
      o.selected = value === team.permissionMode;
      modeSelect.append(o);
    }
    modeSelect.onchange = () => change({ permissionMode: modeSelect.value });
    mode.append(el("span", "set-label", "Permissions"), modeSelect);

    settings.replaceChildren(agents, folder, mode);
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text || !current) return;
    const result = isManager() ? await post("/api/manager", { type: "message", projectId: current.projectId, text }) : await post("/api/chat", { type: "message", id: current.id, text });
    sendError = result.ok ? "" : result.error || "Could not send";
    if (result.ok) input.value = "";
    renderStatus();
  }

  async function post(url, body) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Rebo": "1" }, body: JSON.stringify(body) });
      const result = await res.json();
      refresh();
      return result;
    } catch {
      return { ok: false, error: "The Rebo server is not answering" };
    }
  }

  return {
    open,
    close,
    renderStatus,
    get chatId() {
      return current && current.kind === "chat" ? current.id : null;
    },
    get managerProjectId() {
      return isManager() ? current.projectId : null;
    },
    get isOpen() {
      return !!current;
    },
  };
}
