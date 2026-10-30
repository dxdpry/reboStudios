// Agent Island server: receives Claude Code hook events, keeps the island state and streams it to the browser.
// Listens on 127.0.0.1 only. No dependencies.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { createState, applyEvent, prune, toPublic } = require("./state");

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
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

const state = loadState();
const sseClients = new Set();
let broadcastTimer = null;
let saveTimer = null;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "POST" && url.pathname === "/hook") return handleHook(req, res);
  if (req.method === "GET" && url.pathname === "/events") return handleSse(req, res);
  if (req.method === "GET" && url.pathname === "/state") return json(res, 200, toPublic(state, Date.now()));
  if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
  if (req.method === "GET") return serveStatic(url.pathname, res);
  json(res, 404, { error: "not found" });
});

function handleHook(req, res) {
  let size = 0;
  const chunks = [];
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return req.destroy();
    chunks.push(chunk);
  });
  req.on("end", () => {
    let event;
    try {
      event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return json(res, 400, { error: "bad json" });
    }
    json(res, 200, { ok: true });
    appendLog(event);
    if (applyEvent(state, event.payload, Date.now())) changed();
  });
}

function handleSse(req, res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(`data: ${JSON.stringify(toPublic(state, Date.now()))}\n\n`);
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
      const message = `data: ${JSON.stringify(toPublic(state, Date.now()))}\n\n`;
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

server.listen(PORT, "127.0.0.1", () => console.log(`Agent Island listening on http://127.0.0.1:${PORT}`));
