// Rebo Studios server: receives Claude Code hook events, keeps the office state and streams it to the browser.
// Listens on 127.0.0.1 only. No dependencies.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { createState, applyEvent, prune, toPublic } = require("./state");
const { createHistory } = require("./history");
const { projectForFile, projectForCwd } = require("./projects");
const { createWorkspace } = require("./workspace");

const PORT = Number(process.env.AGENT_ISLAND_PORT) || 4848;
const ROOT = path.join(__dirname, "..");
const WEB_DIR = path.join(ROOT, "web");
const DATA_DIR = path.join(ROOT, "data");
const LOG_DIR = path.join(ROOT, "logs");
const LOG_FILE = path.join(LOG_DIR, "events.jsonl");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_LOG_BYTES = 20 * 1024 * 1024;
const BROADCAST_THROTTLE_MS = 100;
const SAVE_DEBOUNCE_MS = 2000;
const PRUNE_INTERVAL_MS = 5000;
const HISTORY_RESCAN_MS = 2 * 60 * 1000;
const TRANSCRIPT_DEBOUNCE_MS = 3000;
// Events after which the session's transcript has new tokens or time worth reading.
const TRANSCRIPT_EVENTS = new Set(["Stop", "SessionEnd", "SubagentStop", "PostToolUse", "PostToolUseFailure"]);
const RESOLVE = { projectForFile, projectForCwd };
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

const state = loadState();
const history = createHistory(path.join(DATA_DIR, "history.json"));
const workspace = createWorkspace(path.join(DATA_DIR, "workspace.json"));
const transcriptTimers = new Map();
const sseClients = new Set();
let broadcastTimer = null;
let saveTimer = null;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "POST" && url.pathname === "/hook") return handleHook(req, res);
  if (req.method === "GET" && url.pathname === "/events") return handleSse(req, res);
  if (req.method === "GET" && url.pathname === "/state") return json(res, 200, publicState());
  if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
  if (req.method === "GET" && url.pathname === "/api/chats") return json(res, 200, history.chats(String(url.searchParams.get("project") || "")));
  if (req.method === "POST" && url.pathname === "/api/workspace") return handleWorkspace(req, res);
  if (req.method === "GET") return serveStatic(url.pathname, res);
  json(res, 404, { error: "not found" });
});

function readJson(req, res, onBody) {
  let size = 0;
  const chunks = [];
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return req.destroy();
    chunks.push(chunk);
  });
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return json(res, 400, { error: "bad json" });
    }
    onBody(body);
  });
}

function handleHook(req, res) {
  readJson(req, res, (event) => {
    json(res, 200, { ok: true });
    appendLog(event);
    if (applyEvent(state, event.payload, Date.now(), RESOLVE)) changed();
    scheduleTranscriptScan(event.payload);
  });
}

// Page actions (monitor a project, categories). The custom header can't be sent cross-origin
// without a CORS preflight we never answer, so other websites can't drive this endpoint.
function handleWorkspace(req, res) {
  if (req.headers["x-rebo"] !== "1") return json(res, 403, { error: "forbidden" });
  readJson(req, res, (action) => {
    const ok = workspace.apply(action);
    json(res, ok ? 200 : 400, { ok });
    if (ok) changed();
  });
}

function scheduleTranscriptScan(payload) {
  const file = payload && payload.transcript_path;
  if (!file || !TRANSCRIPT_EVENTS.has(payload.hook_event_name)) return;
  clearTimeout(transcriptTimers.get(file));
  transcriptTimers.set(
    file,
    setTimeout(async () => {
      transcriptTimers.delete(file);
      await history.scanFile(file);
      history.persist();
      changed();
    }, TRANSCRIPT_DEBOUNCE_MS)
  );
}

function publicState() {
  const pub = toPublic(state, Date.now(), history.projects());
  workspace.fileNewProjects(pub.projects);
  pub.workspace = workspace.toPublic();
  return pub;
}

function handleSse(req, res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(`data: ${JSON.stringify(publicState())}\n\n`);
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
}

function serveStatic(pathname, res) {
  const file = path.normalize(path.join(WEB_DIR, pathname === "/" ? "index.html" : pathname));
  if (!file.startsWith(WEB_DIR)) return json(res, 403, { error: "forbidden" });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
}

function changed() {
  if (!broadcastTimer) {
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      const message = `data: ${JSON.stringify(publicState())}\n\n`;
      for (const client of sseClients) client.write(message);
    }, BROADCAST_THROTTLE_MS);
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, SAVE_DEBOUNCE_MS);
}

function loadState() {
  try {
    return { ...createState(), ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) };
  } catch {
    return createState();
  }
}

function saveState() {
  fs.writeFile(STATE_FILE, JSON.stringify(state), () => {});
}

function appendLog(event) {
  fs.stat(LOG_FILE, (err, stat) => {
    if (!err && stat.size > MAX_LOG_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + ".old");
    fs.appendFile(LOG_FILE, JSON.stringify(event) + "\n", () => {});
  });
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

setInterval(() => {
  if (prune(state, Date.now())) changed();
}, PRUNE_INTERVAL_MS);

// Keeps SSE connections alive through proxies and lets clients notice a dead server.
setInterval(() => {
  for (const client of sseClients) client.write(": ping\n\n");
}, 15000);

// History: one full scan at startup (only new lines after the first run), then a periodic
// incremental pass to catch sessions that ran while hooks were off.
function rescanHistory() {
  const started = Date.now();
  history
    .scanAll()
    .then(() => {
      console.log(`History scanned in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      changed();
    })
    .catch((err) => console.error("History scan failed:", err.message));
}
rescanHistory();
setInterval(rescanHistory, HISTORY_RESCAN_MS);

server.listen(PORT, "127.0.0.1", () => console.log(`Agent Island listening on http://127.0.0.1:${PORT}`));
