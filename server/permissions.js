// Permission requests answered from the office. The PermissionRequest hook waits for the server's
// answer; while it waits, Claude's own dialog is not shown. So a request is only held while a Rebo
// page is open and visible (it sends a heartbeat), and is released to the app's dialog when the
// page goes away, when the user picks "Answer in Claude", or after HOLD_MAX_MS.
// AskUserQuestion is a permission request too: answering it means allowing it with the answers.
const crypto = require("crypto");
const { labelForTool } = require("./activity");

const PRESENCE_MS = 25 * 1000; // a page counts as watching for this long after its last heartbeat
const HOLD_MAX_MS = 9 * 60 * 1000; // under the hook's 600 s timeout
const CHECK_MS = 5000;
const ANSWER_MAX = 2000;

function createPermissions({ onChange }) {
  const pending = new Map(); // requestId -> { id, sessionId, toolName, input, since, res, timer }
  let lastSeenAt = 0;

  function presence() {
    lastSeenAt = Date.now();
  }

  function watching() {
    return Date.now() - lastSeenAt < PRESENCE_MS;
  }

  // Returns true when it took over the hook's response.
  function hold(payload, res) {
    if (!watching() || !payload.session_id) return false;
    // A newer request from the same session replaces an older one still waiting.
    for (const p of pending.values()) if (p.sessionId === payload.session_id) release(p.id, null);
    const id = crypto.randomUUID();
    const entry = { id, sessionId: payload.session_id, toolName: String(payload.tool_name || ""), input: payload.tool_input || {}, since: Date.now(), res };
    entry.timer = setInterval(() => {
      if (!watching() || Date.now() - entry.since > HOLD_MAX_MS) release(id, null);
    }, CHECK_MS);
    // The hook process was killed (the user answered or interrupted in the app).
    res.on("close", () => pending.has(id) && drop(id));
    pending.set(id, entry);
    onChange();
    return true;
  }

  // answer: { behavior: "allow" | "deny" | "app", answers?: { [question]: string } }
  function answer(sessionId, requestId, answer) {
    const entry = pending.get(requestId);
    if (!entry || entry.sessionId !== sessionId || !answer) return false;
    if (answer.behavior === "app") return release(requestId, null);
    if (answer.behavior === "deny") return release(requestId, decision({ behavior: "deny", message: "The user denied this from Rebo Studios." }));
    if (answer.behavior !== "allow") return false;
    if (entry.toolName !== "AskUserQuestion") return release(requestId, decision({ behavior: "allow" }));
    const answers = cleanAnswers(entry.input, answer.answers);
    if (!answers) return false;
    return release(requestId, decision({ behavior: "allow", updatedInput: { ...entry.input, answers } }));
  }

  function release(requestId, output) {
    const entry = pending.get(requestId);
    if (!entry) return false;
    drop(requestId);
    if (!entry.res.writableEnded) {
      entry.res.writeHead(200, { "Content-Type": "application/json" });
      entry.res.end(JSON.stringify(output || {}));
    }
    return true;
  }

  function drop(requestId) {
    const entry = pending.get(requestId);
    if (!entry) return;
    clearInterval(entry.timer);
    pending.delete(requestId);
    onChange();
  }

  function forSession(sessionId) {
    for (const p of pending.values()) if (p.sessionId === sessionId) return p;
    return null;
  }

  function toPublic() {
    return [...pending.values()].map((p) => ({
      id: p.id,
      sessionId: p.sessionId,
      toolName: p.toolName,
      label: labelForTool(p.toolName, p.input),
      detail: detailOf(p),
      since: p.since,
      questions: p.toolName === "AskUserQuestion" ? questionsOf(p.input) : null,
    }));
  }

  return { presence, hold, answer, forSession, toPublic };
}

function decision(d) {
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: d } };
}

function questionsOf(input) {
  const list = Array.isArray(input.questions) ? input.questions : [];
  return list.map((q) => ({
    question: String(q.question || ""),
    header: String(q.header || ""),
    multiSelect: !!q.multiSelect,
    options: (Array.isArray(q.options) ? q.options : []).map((o) => ({ label: String(o.label || ""), description: String(o.description || "") })),
  }));
}

// What the request would do, in full (the label is clipped to one line).
function detailOf(p) {
  const i = p.input;
  if (i.command) return String(i.command).slice(0, 1000);
  if (i.file_path) return String(i.file_path);
  if (i.url) return String(i.url);
  return "";
}

// One answer per question, keyed by the question text; only text, bounded.
function cleanAnswers(input, answers) {
  if (!answers || typeof answers !== "object") return null;
  const out = {};
  for (const q of questionsOf(input)) {
    const a = answers[q.question];
    if (typeof a !== "string" || !a.trim()) return null;
    out[q.question] = a.trim().slice(0, ANSWER_MAX);
  }
  return Object.keys(out).length ? out : null;
}

module.exports = { createPermissions };
