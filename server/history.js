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

const TRANSCRIPTS_DIR = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
const IDLE_GAP_MS = 10 * 60 * 1000; // longer pauses inside a turn (waiting on you) are not counted
const WRITE_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_LINE_BYTES = 64 * 1024 * 1024;

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
    // Cheap filter before JSON.parse: only user and assistant messages matter.
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
    if (!entry.project && e.cwd && isIgnored(e.cwd + "/.")) entry.project = "unknown"; // temp/test folders
    if (!entry.project && e.cwd) {
      const project = projectForCwd(e.cwd);
      entry.project = project.id;
      store.names[project.id] = store.names[project.id] || { name: project.name, cwd: project.cwd };
    }
    const bucket = bucketFor(entry);

    const prompt = e.type === "user" && !e.isMeta && isRealPrompt(e.message);
    if (prompt && !entry.isSubagent) {
      bucket.prompts++;
    } else if (entry.lastAt && ts - entry.lastAt < IDLE_GAP_MS && ts > entry.lastAt && !entry.isSubagent) {
      bucket.activeMs += ts - entry.lastAt;
    }
    entry.lastAt = ts;
    bucket.firstAt = Math.min(bucket.firstAt || ts, ts);
    bucket.lastAt = Math.max(bucket.lastAt || 0, ts);

    if (e.type === "assistant") {
      addUsage(entry, bucket, e);
      for (const block of contentBlocks(e.message)) {
        if (block.type !== "tool_use" || !WRITE_TOOLS.has(block.name)) continue;
        const project = projectForFile(block.input && (block.input.file_path || block.input.notebook_path));
        if (project) {
          entry.project = project.id;
          store.names[project.id] = { name: project.name, cwd: project.cwd };
        }
      }
    }
  }

  // Lines of one streamed message repeat its usage; count each message once, keeping the largest.
  function addUsage(entry, bucket, e) {
    const key = (e.message && e.message.id) || e.requestId;
    const usage = sumUsage(e.message && e.message.usage);
    if (!usage) return;
    const previous = entry.lastUsageKey === key ? entry.lastUsage : null;
    for (const k of Object.keys(usage)) bucket.tokens[k] += Math.max(0, usage[k] - (previous ? previous[k] : 0));
    if (!previous || usage.output >= previous.output) {
      entry.lastUsageKey = key;
      entry.lastUsage = usage;
    }
  }

  function bucketFor(entry) {
    const id = entry.project || "unknown";
    if (!store.projects[id]) store.projects[id] = { firstAt: 0, lastAt: 0, activeMs: 0, prompts: 0, tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 } };
    return store.projects[id];
  }

  function projects() {
    const out = {};
    for (const [id, stats] of Object.entries(store.projects)) {
      if (id === "unknown") continue;
      out[id] = { ...stats, ...(store.names[id] || nameFromId(id)) };
    }
    return out;
  }

  function persist() {
    save(storeFile, store);
  }

  return { scanAll, scanFile, projects, persist, TRANSCRIPTS_DIR };
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
  return { offset: 0, project: null, lastAt: 0, lastUsageKey: null, lastUsage: null, isSubagent: /[\\/]subagents[\\/]/.test(file) };
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

function nameFromId(id) {
  const cwd = id.replace(/\/+$/, "");
  return { name: path.posix.basename(cwd) || cwd, cwd };
}

function load(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data.version === 1) return data;
  } catch {
    // First run or unreadable store: rebuild from the transcripts.
  }
  return { version: 1, files: {}, projects: {}, names: {} };
}

function save(file, store) {
  fs.writeFile(file, JSON.stringify(store), () => {});
}

module.exports = { createHistory };
