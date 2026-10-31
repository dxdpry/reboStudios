// Reads Claude Code transcripts (~/.claude/projects/**/*.jsonl) to build per-project history:
// first activity, time Claude spent working, prompts and tokens. Files are read incrementally
// (byte offsets are persisted), so only new lines are parsed after the first full scan.
//
// Attribution is per turn: work is credited to the project of the last file Claude wrote in that
// session (see projects.js), falling back to the session's cwd before the first write.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { projectForFile, projectForCwd, isIgnored } = require("./projects");
const { projectKey } = require("./activity");

const TRANSCRIPTS_DIR = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
const IDLE_GAP_MS = 10 * 60 * 1000; // longer pauses inside a turn (waiting on you) are not counted
const WRITE_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_LINE_BYTES = 64 * 1024 * 1024;
const STORE_VERSION = 4; // bump to force a full rescan when the stored shape changes
// Openings of continued or interrupted chats that are not the user's own first prompt.
const CONTINUATION = /^(this session is being continued|caveat:|\[request interrupted)/i;

function createHistory(storeFile) {
  let store = load(storeFile);
  let scanning = null;

  async function scanAll(onProgress) {
    if (scanning) return scanning;
    scanning = (async () => {
      const files = listTranscripts();
      let done = 0;
      for (const file of files) {
        await scanFile(file);
        done++;
        if (onProgress && done % 10 === 0) onProgress(done, files.length);
      }
      save(storeFile, store);
    })().finally(() => (scanning = null));
    return scanning;
  }

  async function scanFile(file) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return;
    }
    const entry = store.files[file] || (store.files[file] = newFileEntry(file));
    if (stat.size < entry.offset) Object.assign(entry, newFileEntry(file)); // rewritten: start over
    const forkedAt = store.forks[path.basename(file, ".jsonl")];
    if (forkedAt && entry.copiedBefore !== forkedAt) Object.assign(entry, newFileEntry(file), { copiedBefore: forkedAt });
    if (stat.size === entry.offset) return;

    const fd = fs.openSync(file, "r");
    try {
      let position = entry.offset;
      let carry = "";
      const buffer = Buffer.alloc(CHUNK_BYTES);
      while (position < stat.size) {
        const read = fs.readSync(fd, buffer, 0, Math.min(CHUNK_BYTES, stat.size - position), position);
        if (!read) break;
        position += read;
        const text = carry + buffer.toString("utf8", 0, read);
        const lines = text.split("\n");
        carry = lines.pop();
        for (const line of lines) {
          if (line) handleLine(entry, line);
          entry.offset += Buffer.byteLength(line, "utf8") + 1;
        }
        if (carry.length > MAX_LINE_BYTES) {
          entry.offset += Buffer.byteLength(carry, "utf8");
          carry = "";
        }
        // Yield so hook events keep flowing during the first (long) scan.
        await new Promise((resolve) => setImmediate(resolve));
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  function handleLine(entry, line) {
    // Cheap filter before JSON.parse: only messages and chat titles matter.
    if (line.startsWith('{"type":"custom-title"')) return setTitle(entry, line);
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) return;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      return;
    }
    if (e.type !== "user" && e.type !== "assistant") return;
    const ts = Date.parse(e.timestamp);
    if (!Number.isFinite(ts)) return;
    // A forked chat starts with a copy of its parent's messages; they were already counted there.
    if (entry.copiedBefore && ts < entry.copiedBefore) return;
    // Chats run from temp/test folders are not projects.
    if (e.cwd && entry.folder === null && isIgnored(e.cwd + "/.")) entry.ignored = true;
    // The cwd is only a fallback main folder; "works in" lists the folders actually written.
    if (!entry.folder && e.cwd && !isIgnored(e.cwd + "/.")) entry.folder = projectForCwd(e.cwd).id;
    const totals = totalsFor(entry);

    const prompt = e.type === "user" && !e.isMeta && isRealPrompt(e.message);
    if (prompt && !entry.isSubagent) {
      totals.prompts++;
      if (!entry.firstPrompt) entry.firstPrompt = promptText(e.message);
    } else if (entry.lastAt && ts - entry.lastAt < IDLE_GAP_MS && ts > entry.lastAt && !entry.isSubagent) {
      totals.activeMs += ts - entry.lastAt;
    }
    entry.lastAt = ts;
    totals.firstAt = Math.min(totals.firstAt || ts, ts);
    totals.lastAt = Math.max(totals.lastAt || 0, ts);

    if (e.type === "assistant") {
      addUsage(entry, totals, e);
      for (const block of contentBlocks(e.message)) {
        if (block.type !== "tool_use" || !WRITE_TOOLS.has(block.name)) continue;
        const folder = projectForFile(block.input && (block.input.file_path || block.input.notebook_path));
        if (folder) noteFolder(entry, folder);
      }
    }
  }

  // Folders a chat wrote to (shown as "works in"); the first one seen is its main folder.
  function noteFolder(entry, folder) {
    entry.folders = entry.folders || {};
    entry.folders[folder.id] = { name: folder.name, cwd: folder.cwd };
    entry.folder = entry.folder || folder.id;
  }

  // Lines of one streamed message repeat its usage; count each message once, keeping the largest.
  function addUsage(entry, totals, e) {
    const key = (e.message && e.message.id) || e.requestId;
    const usage = sumUsage(e.message && e.message.usage);
    if (!usage) return;
    const previous = entry.lastUsageKey === key ? entry.lastUsage : null;
    for (const k of Object.keys(usage)) totals.tokens[k] += Math.max(0, usage[k] - (previous ? previous[k] : 0));
    if (!previous || usage.output >= previous.output) {
      entry.lastUsageKey = key;
      entry.lastUsage = usage;
    }
  }

  function totalsFor(entry) {
    if (!entry.totals) entry.totals = { firstAt: 0, lastAt: 0, activeMs: 0, prompts: 0, tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 } };
    return entry.totals;
  }

  function setTitle(entry, line) {
    try {
      const e = JSON.parse(line);
      if (e.customTitle) entry.title = String(e.customTitle).slice(0, 120);
    } catch {
      // A broken title line is not worth failing the scan for.
    }
  }

  // Projects as the Claude app shows them: chats grouped by title (a resumed chat keeps its title).
  // Subagent transcripts add their tokens to the chat that started them.
  function projects() {
    const byFile = new Map(Object.entries(store.files));
    const out = {};
    for (const [file, entry] of byFile) {
      if (entry.isSubagent || entry.ignored || !entry.totals) continue;
      const t = entry.totals;
      if (!t.prompts && t.activeMs < 60000) continue;
      const id = projectKey(entry.title, path.basename(file, ".jsonl"));
      const p = out[id] || (out[id] = { id, name: entry.title || entry.firstPrompt || "Untitled chat", firstAt: t.firstAt, lastAt: 0, activeMs: 0, prompts: 0, tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, chats: [], folders: {} });
      p.firstAt = Math.min(p.firstAt || t.firstAt, t.firstAt);
      p.lastAt = Math.max(p.lastAt, t.lastAt);
      p.activeMs += t.activeMs;
      p.prompts += t.prompts;
      addTokens(p.tokens, t.tokens);
      Object.assign(p.folders, entry.folders || {});
      p.chats.push({ id: path.basename(file, ".jsonl"), title: entry.firstPrompt || `Chat of ${dayLabel(t.firstAt)}`, firstAt: t.firstAt, lastAt: t.lastAt, activeMs: t.activeMs, prompts: t.prompts });
    }
    for (const [file, entry] of byFile) {
      if (!entry.isSubagent || !entry.totals) continue;
      const parent = byFile.get(path.join(path.dirname(path.dirname(file)), "..", path.basename(path.dirname(path.dirname(file))) + ".jsonl"));
      const owner = parent && out[projectKey(parent.title, path.basename(path.dirname(path.dirname(file))))];
      if (owner) addTokens(owner.tokens, entry.totals.tokens);
    }
    for (const p of Object.values(out)) p.chats.sort((a, b) => b.lastAt - a.lastAt);
    return out;
  }

  function persist() {
    save(storeFile, store);
  }

  // A chat forked from another (the manager's first run): its messages before `at` are copies.
  function markFork(chatId, at) {
    store.forks[chatId] = at;
    save(storeFile, store);
  }

  // Transcript file of a chat (its id is the file name).
  function fileFor(chatId) {
    return Object.keys(store.files).find((file) => !store.files[file].isSubagent && path.basename(file, ".jsonl") === chatId) || null;
  }

  return { scanAll, scanFile, projects, persist, fileFor, markFork, TRANSCRIPTS_DIR };
}

function listTranscripts() {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      const full = path.join(dir, d.name);
      if (d.isDirectory() && depth < 4) walk(full, depth + 1);
      else if (d.isFile() && d.name.endsWith(".jsonl")) out.push(full);
    }
  };
  walk(TRANSCRIPTS_DIR, 0);
  return out;
}

function newFileEntry(file) {
  return { offset: 0, folder: null, lastAt: 0, lastUsageKey: null, lastUsage: null, isSubagent: /[\\/]subagents[\\/]/.test(file) };
}

function promptText(message) {
  const content = message && message.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? (content.find((c) => c && c.type === "text") || {}).text : "";
  const clean = String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  // Automatic summaries at the start of a continued chat say nothing about it; wait for a real prompt.
  if (!clean || CONTINUATION.test(clean)) return null;
  return clean.slice(0, 80);
}

function isRealPrompt(message) {
  if (!message) return false;
  if (typeof message.content === "string") return true;
  return Array.isArray(message.content) && !message.content.some((c) => c && c.type === "tool_result");
}

function contentBlocks(message) {
  return message && Array.isArray(message.content) ? message.content : [];
}

// Newer transcripts put the real numbers in usage.iterations; older ones in usage itself.
function sumUsage(u) {
  if (!u) return null;
  const parts = Array.isArray(u.iterations) && u.iterations.length ? u.iterations : [u];
  const total = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  for (const p of parts) {
    total.input += p.input_tokens || 0;
    total.output += p.output_tokens || 0;
    total.cacheWrite += p.cache_creation_input_tokens || 0;
    total.cacheRead += p.cache_read_input_tokens || 0;
  }
  return total;
}

function dayLabel(ms) {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function addTokens(into, from) {
  for (const k of Object.keys(into)) into[k] += from[k] || 0;
}

function load(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data.version === STORE_VERSION) return { forks: {}, ...data };
  } catch {
    // First run or unreadable store: rebuild from the transcripts.
  }
  return { version: STORE_VERSION, files: {}, forks: {} };
}

function save(file, store) {
  fs.writeFile(file, JSON.stringify(store), () => {});
}

module.exports = { createHistory };
