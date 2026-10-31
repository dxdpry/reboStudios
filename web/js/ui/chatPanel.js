// Side panel for one chat, opened from the (i) on its desk: the recent conversation, what Claude
// is doing now, and the remote controls (send a message, stop the current turn). Messages wait on
// the server until the chat's next hook, so the panel says when they are still pending.
// All transcript text is set with textContent.
import { ICONS } from "./icons.js";
import { ago } from "./format.js";

const POLL_MS = 2500;

export function createChatPanel(root, { sessionFor, onClose }) {
  root.innerHTML = `
    <header class="chat-head">
      <span class="card-dot"></span>
      <div class="card-titles"><h2 class="chat-title"></h2><p class="chat-status"></p></div>
      <button class="card-close" type="button" aria-label="Close">${ICONS.close}</button>
    </header>
    <ol class="chat-log" aria-live="polite"></ol>
    <div class="chat-pending" hidden></div>
    <form class="chat-form">
      <textarea class="chat-input" rows="2" maxlength="4000" placeholder="Message Claude…" aria-label="Message to Claude"></textarea>
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
  q(".card-close").addEventListener("click", () => close());
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
  q(".chat-stop").addEventListener("click", () => act({ type: "stop" }));

  let chat = null; // { id, title }
  let timer = null;
  let lastKey = "";
  let pending = { messages: [], stop: false };

  function open(next) {
    if (chat && chat.id === next.id) return;
    chat = next;
    lastKey = "";
    log.replaceChildren();
    pending = { messages: [], stop: false };
    root.hidden = false;
    document.body.classList.add("chat-open");
    q(".chat-title").textContent = chat.title;
    refresh();
    clearInterval(timer);
    timer = setInterval(refresh, POLL_MS);
    input.focus();
  }

  function close() {
    if (!chat) return;
    chat = null;
    clearInterval(timer);
    root.hidden = true;
    document.body.classList.remove("chat-open");
    onClose();
  }

  async function refresh() {
    if (!chat) return;
    const id = chat.id;
    try {
      const res = await fetch(`/api/chat?id=${encodeURIComponent(id)}`, { headers: { "X-Rebo": "1" } });
      const data = await res.json();
      if (!chat || chat.id !== id) return;
      pending = data.pending;
      renderLog(data.items || []);
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
    log.replaceChildren(
      ...(items.length ? items.map(itemNode) : [el("li", "chat-empty", "Nothing in this chat yet.")])
    );
    if (atBottom || log.dataset.filled !== "1") log.scrollTop = log.scrollHeight;
    log.dataset.filled = "1";
  }

  function itemNode(item) {
    const li = el("li", `chat-item ${item.role}`);
    if (item.role === "tool") li.append(el("span", "chat-tool", item.text));
    else li.append(el("div", "chat-bubble", item.text));
    li.title = new Date(item.at).toLocaleString();
    return li;
  }

  // Called every frame batch from main as well, so status follows the live state between polls.
  function renderStatus() {
    if (!chat) return;
    const s = sessionFor(chat.id);
    const status = !s || s.status === "ended" ? "closed" : s.status === "needsYou" ? "needsYou" : s.status === "working" || s.status === "thinking" ? "running" : "idle";
    root.dataset.status = status;
    const text = {
      running: s && s.activity,
      needsYou: s && `Waiting for you · ${(s.needsYou && s.needsYou.detail) || s.activity}`,
      idle: s && `Idle · ${ago(Date.now() - (s.lastEventAt || Date.now()))} ago`,
      closed: "Not open in Claude right now",
    }[status];
    q(".chat-status").textContent = text || "";
    q(".chat-stop").hidden = status !== "running" || pending.stop;
    q(".chat-hint").textContent =
      status === "running"
        ? "Claude reads it after its current step."
        : status === "needsYou"
          ? "Answer the request in Claude first; the message goes after it."
          : "Delivered when this chat runs again.";

    const parts = pending.messages.map((m) => `“${m.text.length > 90 ? m.text.slice(0, 89) + "…" : m.text}”`);
    if (pending.stop) parts.unshift("Stop requested");
    pendingBox.hidden = !parts.length;
    if (parts.length) {
      pendingBox.replaceChildren(el("span", "chat-pending-label", "Waiting to be delivered"), el("span", "chat-pending-text", parts.join(" · ")));
      const cancel = el("button", "chat-pending-cancel", "Cancel");
      cancel.type = "button";
      cancel.onclick = () => act({ type: "cancel" });
      pendingBox.append(cancel);
    }
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text || !chat) return;
    if (await act({ type: "message", text })) input.value = "";
  }

  async function act(action) {
    if (!chat) return false;
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json", "X-Rebo": "1" }, body: JSON.stringify({ ...action, id: chat.id }) });
      const data = await res.json();
      if (data.pending) pending = data.pending;
      renderStatus();
      return !!data.ok;
    } catch {
      return false;
    }
  }

  return {
    open,
    close,
    renderStatus,
    get chatId() {
      return chat ? chat.id : null;
    },
  };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
