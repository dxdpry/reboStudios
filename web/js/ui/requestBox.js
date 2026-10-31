// A held permission request inside the chat panel: Allow / Deny for a tool, or the options of
// Claude's question (one or several, or a typed answer). Rebuilt only when the request changes,
// so a half-picked answer is not wiped by the next refresh.

export function createRequestBox(box, onAnswer) {
  let key = "";

  function render(request) {
    const next = request ? request.id : "";
    if (next === key) return;
    key = next;
    box.hidden = !request;
    box.replaceChildren();
    if (!request) return;
    const answer = (body) => onAnswer(request.id, body);
    const toApp = button("chat-req-secondary", "Answer in Claude", () => answer({ behavior: "app" }));
    toApp.title = "Show Claude's own dialog instead";

    if (!request.questions) {
      box.append(el("p", "chat-req-title", "Claude asks for permission"), el("p", "chat-req-label", request.label));
      if (request.detail) box.append(el("code", "chat-req-detail", request.detail));
      const row = el("div", "chat-req-actions");
      row.append(toApp, button("chat-req-deny", "Deny", () => answer({ behavior: "deny" })), button("chat-req-allow", "Allow", () => answer({ behavior: "allow" })));
      box.append(row);
      return;
    }

    box.append(el("p", "chat-req-title", request.questions.length > 1 ? "Claude has questions" : "Claude has a question"));
    const picked = request.questions.map(() => new Set());
    const typed = [];
    const submit = button("chat-req-allow", "Send answer", () => {
      const answers = {};
      request.questions.forEach((q, i) => (answers[q.question] = typed[i].value.trim() || [...picked[i]].join(", ")));
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
      box.append(block);
    });
    const row = el("div", "chat-req-actions");
    row.append(toApp, submit);
    box.append(row);
    refresh();
  }

  function reset() {
    key = "";
    render(null);
  }

  return { render, reset };
}

export function button(className, text, onClick) {
  const b = el("button", className, text || undefined);
  b.type = "button";
  b.onclick = onClick;
  return b;
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
