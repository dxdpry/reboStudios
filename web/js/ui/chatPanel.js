// Side panel for one chat, opened from the (i) on its desk: the recent conversation, what Claude
// is doing now, and the remote controls (send a message, stop the current turn). Messages wait on
// the server until the chat's next hook, so the panel says when they are still pending.
// When the chat asks for permission (or asks a question) while the page is open, the request is
// held for the page: the panel shows Allow / Deny, or the question's options.
// All transcript text is set with textContent.
import { ICONS } from "./icons.js";
import { ago } from "./format.js";

const POLL_MS = 2500;

export function createChatPanel(root, { sessionFor, permissionFor, onClose }) {
  root.innerHTML = `
    <header class="chat-head">
      <span class="card-dot"></span>
      <div class="card-titles"><h2 class="chat-title"></h2><p class="chat-status"></p></div>
      <button class="card-close" type="button" aria-label="Close">${ICONS.close}</button>
    </header>
    <ol class="chat-log" aria-live="polite"></ol>
    <div class="chat-request" hidden></div>
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
  let requestKey = "";
  const requestBox = q(".chat-request");

  function open(next) {
    if (chat && chat.id === next.id) return;
    chat = next;
    lastKey = "";
    requestKey = "";
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
          ? permissionFor(chat.id)
            ? "Answer above first; the message goes after it."
            : "Answer the request in Claude first; the message goes after it."
          : "Delivered when this chat runs again.";

    renderRequest(permissionFor(chat.id));

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

  // Rebuilt only when the request changes, so a half-picked answer is not wiped every second.
  function renderRequest(request) {
    const key = request ? request.id : "";
    if (key === requestKey) return;
    requestKey = key;
    requestBox.hidden = !request;
    requestBox.replaceChildren();
    if (!request) return;
    const answer = (body) => act({ type: "permission", requestId: request.id, answer: body });
    const toApp = button("chat-req-secondary", "Answer in Claude", () => answer({ behavior: "app" }));
    toApp.title = "Show Claude's own dialog instead";

    if (!request.questions) {
      requestBox.append(el("p", "chat-req-title", "Claude asks for permission"), el("p", "chat-req-label", request.label));
      if (request.detail) requestBox.append(el("code", "chat-req-detail", request.detail));
      const row = el("div", "chat-req-actions");
      row.append(toApp, button("chat-req-deny", "Deny", () => answer({ behavior: "deny" })), button("chat-req-allow", "Allow", () => answer({ behavior: "allow" })));
      requestBox.append(row);
      return;
    }

    // A question: options as chips (one or several), or a typed answer.
    requestBox.append(el("p", "chat-req-title", request.questions.length > 1 ? "Claude has questions" : "Claude has a question"));
    const picked = request.questions.map(() => new Set());
    const typed = [];
    const submit = button("chat-req-allow", "Send answer", () => {
      const answers = {};
      request.questions.forEach((q, i) => {
        const text = typed[i].value.trim();
        answers[q.question] = text || [...picked[i]].join(", ");
      });
      answer({ behavior: "allow", answers });
    });
    const refresh = () => (submit.disabled = request.questions.some((q, i) => !picked[i].size && !typed[i].value.trim()));
    request.questions.forEach((q, i) => {
      const block = el("div", "chat-q");
      if (q.header) block.append(el("span", "chat-q-header", q.header));
      block.append(el("p", "chat-q-text", q.question));
      const options = el("div", "chat-q-options");
      for (const o of q.options) {
        const chip = button("chat-q-option", "", () => {
          if (!q.multiSelect) {
            picked[i].clear();
            options.querySelectorAll(".chat-q-option").forEach((c) => c.classList.remove("on"));
          }
          if (picked[i].has(o.label)) picked[i].delete(o.label);
          else picked[i].add(o.label);
          chip.classList.toggle("on", picked[i].has(o.label));
          refresh();
        });
        chip.append(el("span", "chat-q-label", o.label));
        if (o.description) chip.append(el("span", "chat-q-desc", o.description));
        options.append(chip);
      }
      const other = el("input", "chat-q-other");
      other.placeholder = "Or type your own answer";
      other.maxLength = 2000;
      other.addEventListener("input", refresh);
      typed.push(other);
      block.append(options, other);
      requestBox.append(block);
    });
    const row = el("div", "chat-req-actions");
    row.append(toApp, submit);
    requestBox.append(row);
    refresh();
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

function button(className, text, onClick) {
  const b = el("button", className, text || undefined);
  b.type = "button";
  b.onclick = onClick;
  return b;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
