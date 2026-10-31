// A chat seen from the office: its recent conversation (read from the tail of the transcript) and
// the remote controls. Messages and stop requests wait in an inbox until the chat's next hook that
// can answer (PostToolUse, PreToolUse or Stop), because a Claude Code session can only be reached
// through its hooks.
const fs = require("fs");
const { labelForTool } = require("./activity");

const TAIL_BYTES = 3 * 1024 * 1024;
const MAX_ITEMS = 80;
const TEXT_MAX = 4000;
const MESSAGE_MAX = 4000;
const MAX_QUEUED = 5;
const INBOX_TTL_MS = 6 * 60 * 60 * 1000;

// Last turns of a transcript: prompts, Claude's replies and one line per tool call.
function readChat(file) {
  if (!file) return [];
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift(); // cut in the middle
    const items = [];
    for (const line of lines) {
      if (!line.startsWith('{"') || !/"type":"(user|assistant)"/.test(line)) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.isSidechain || e.isMeta) continue;
      items.push(...itemsOf(e));
    }
    return items.slice(-MAX_ITEMS);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function itemsOf(e) {
  const at = Date.parse(e.timestamp) || 0;
  const content = e.message && e.message.content;
  if (e.type === "user") {
    if (typeof content === "string") return prompt(content, at);
    if (!Array.isArray(content) || content.some((c) => c && c.type === "tool_result")) return [];
    return prompt(content.filter((c) => c && c.type === "text").map((c) => c.text).join("\n"), at);
  }
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const c of content) {
    if (c.type === "text" && c.text.trim()) out.push({ role: "assistant", text: clipText(c.text), at });
    else if (c.type === "tool_use") out.push({ role: "tool", text: labelForTool(c.name, c.input || {}), at });
  }
  return out;
}

// Real prompts only: the app also stores reminders and command wrappers as user lines.
function prompt(text, at) {
  const clean = String(text || "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  if (!clean || /^<(command|local-command|task-notification)/.test(clean)) return [];
  if (/^\[Request interrupted/.test(clean)) return [{ role: "tool", text: "Interrupted", at }];
  return [{ role: "user", text: clipText(clean), at }];
}

function clipText(text) {
  return text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) + "…" : text;
}

function createControl() {
  const inbox = new Map(); // chatId -> { messages: [{ text, at }], stop: boolean, at }

  function boxFor(id) {
    if (!inbox.has(id)) inbox.set(id, { messages: [], stop: false, at: Date.now() });
    return inbox.get(id);
  }

  function queue(id, text) {
    const clean = String(text || "").trim().slice(0, MESSAGE_MAX);
    if (!id || !clean) return false;
    const box = boxFor(id);
    if (box.messages.length >= MAX_QUEUED) return false;
    box.messages.push({ text: clean, at: Date.now() });
    box.at = Date.now();
    return true;
  }

  function requestStop(id) {
    if (!id) return false;
    const box = boxFor(id);
    box.stop = true;
    box.at = Date.now();
    return true;
  }

  function cancel(id) {
    return inbox.delete(id);
  }

  function pending(id) {
    const box = inbox.get(id);
    return box ? { messages: box.messages.map((m) => ({ text: m.text, at: m.at })), stop: box.stop } : { messages: [], stop: false };
  }

  // Hook output for a session's hook event, consuming what it delivers; null when there is nothing.
  function take(id, event) {
    const box = inbox.get(id);
    if (!box) return null;
    if (box.stop && (event === "PreToolUse" || event === "PostToolUse")) {
      box.stop = false;
      const note = box.messages.length ? ` Message waiting: ${joined(box.messages)}` : "";
      box.messages = [];
      inbox.delete(id);
      return { continue: false, stopReason: `Stopped from Rebo Studios.${note}` };
    }
    if (event === "Stop") {
      box.stop = false; // already stopping
      if (!box.messages.length) return done(id, null);
      const text = joined(box.messages);
      box.messages = [];
      return done(id, { decision: "block", reason: `The user sent this message from Rebo Studios (their dashboard of Claude sessions). Treat it as a new prompt from them:\n\n${text}` });
    }
    if (event === "PostToolUse" && box.messages.length) {
      const text = joined(box.messages);
      box.messages = [];
      return done(id, {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: `The user sent this message from Rebo Studios (their dashboard of Claude sessions) while you were working. Read it now and take it into account:\n\n${text}`,
        },
      });
    }
    return null;
  }

  function done(id, output) {
    const box = inbox.get(id);
    if (box && !box.messages.length && !box.stop) inbox.delete(id);
    return output;
  }

  function prune(now) {
    for (const [id, box] of inbox) if (now - box.at > INBOX_TTL_MS) inbox.delete(id);
  }

  return { queue, requestStop, cancel, pending, take, prune };
}

function joined(messages) {
  return messages.map((m) => m.text).join("\n\n");
}

module.exports = { readChat, createControl };
