// Rebo Studios server: receives Claude Code hook events, keeps the office state and streams it to the browser.
// Listens on 127.0.0.1 only. No dependencies.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { createState, applyEvent, prune, toPublic } = require("./state");
const { createHistory } = require("./history");
const { projectForFile, projectForCwd } = require("./projects");
const { createWorkspace } = require("./workspace");
const { readChat, createControl } = require("./chat");
const { createPermissions } = require("./permissions");
const { createManager } = require("./manager");
const { createSkills } = require("./skills");

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
const RESOLVE = { projectForFile, projectForCwd, managerProject: (id) => workspace.managerProject(id) };
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

const state = loadState();
const history = createHistory(path.join(DATA_DIR, "history.json"));
const workspace = createWorkspace(path.join(DATA_DIR, "workspace.json"));
const control = createControl();
const permissions = createPermissions({ onChange: () => changed() });
// A manager's first chat is a fork of the project's latest one: its copied messages are not counted twice.
const manager = createManager({ workspace, control, onChange: () => changed(), onSession: (sessionId, projectId, run) => run.forked && history.markFork(sessionId, run.startedAt) });
const skills = createSkills(path.join(DATA_DIR, "secrets.json"));
const transcriptTimers = new Map();
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const CHAT_ID = /^[0-9a-f-]{8,64}$/i;
const sseClients = new Set();
let broadcastTimer = null;
let saveTimer = null;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  // Another site resolving its own name to 127.0.0.1 (DNS rebinding) arrives with a foreign Host.
  if (!ALLOWED_HOSTS.has(req.headers.host)) return json(res, 403, { error: "forbidden" });
  if (req.method === "POST" && url.pathname === "/hook") return handleHook(req, res);
  if (req.method === "GET" && url.pathname === "/events") return handleSse(req, res);
  if (req.method === "GET" && url.pathname === "/state") return json(res, 200, publicState());
  if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
  if (req.method === "GET" && url.pathname === "/api/chats") return json(res, 200, history.chats(String(url.searchParams.get("project") || "")));
  if (req.method === "POST" && url.pathname === "/api/workspace") return handleWorkspace(req, res);
  if (req.method === "GET" && url.pathname === "/api/chat") return handleChatRead(url, req, res);
  if (req.method === "POST" && url.pathname === "/api/chat") return handleChatAction(req, res);
  if (req.method === "POST" && url.pathname === "/api/presence") return handlePresence(req, res);
  if (req.method === "GET" && url.pathname === "/api/manager") return handleManagerRead(url, req, res);
  if (req.method === "POST" && url.pathname === "/api/manager") return handleManagerAction(req, res);
  if (req.method === "GET" && url.pathname === "/api/skills") return handleSkillsRead(url, req, res);
  if (req.method === "POST" && url.pathname === "/api/skills") return handleSkillsAction(req, res);
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

// Hooks run with --sync (PreToolUse, PostToolUse, Stop) wait for this answer: it carries the
// messages and stop requests sent from the page, in Claude Code's hook output format.
function handleHook(req, res) {
  readJson(req, res, (event) => {
    const payload = event.payload || {};
    const sync = req.headers["x-rebo-sync"] === "1" && payload.session_id;
    appendLog(event);
    if (applyEvent(state, payload, Date.now(), RESOLVE)) changed();
    scheduleTranscriptScan(payload);
    // A permission request waits here for an answer from the page (only while a page is watching).
    if (sync && payload.hook_event_name === "PermissionRequest" && permissions.hold(payload, res)) return;
    const output = sync ? control.take(payload.session_id, payload.hook_event_name) : null;
    json(res, 200, output || {});
    if (output) changed();
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

function handleChatRead(url, req, res) {
  if (req.headers["x-rebo"] !== "1") return json(res, 403, { error: "forbidden" });
  const id = String(url.searchParams.get("id") || "");
  if (!CHAT_ID.test(id)) return json(res, 400, { error: "bad id" });
  const session = state.sessions[id];
  const file = (session && session.transcriptPath) || history.fileFor(id);
  json(res, 200, { id, items: readChat(file), pending: control.pending(id) });
}

// Message, stop or cancel for one chat; delivered by that chat's next hook.
function handleChatAction(req, res) {
  if (req.headers["x-rebo"] !== "1") return json(res, 403, { error: "forbidden" });
  readJson(req, res, (action) => {
    const id = String(action.id || "");
    if (!CHAT_ID.test(id)) return json(res, 400, { error: "bad id" });
    if (action.type === "permission") {
      const ok = permissions.answer(id, String(action.requestId || ""), action.answer);
      if (ok && action.answer.behavior !== "app" && state.sessions[id]) {
        Object.assign(state.sessions[id], { needsYou: null, status: "working", activity: action.answer.behavior === "deny" ? "Permission denied" : "Going on…" });
        changed();
      }
      return json(res, ok ? 200 : 400, { ok });
    }
    const ok =
      action.type === "message" ? control.queue(id, action.text) : action.type === "stop" ? control.requestStop(id) : action.type === "cancel" ? control.cancel(id) : false;
    json(res, ok ? 200 : 400, { ok, pending: control.pending(id) });
  });
}

function projectFor(id) {
  return publicState().projects.find((p) => p.id === id) || null;
}

// The folder the project's manager works in: chosen in its settings, else the main one it wrote to.
function folderOf(project) {
  const team = workspace.teamOf(project.id);
  return team.cwd || (project.folderPaths || []).find((dir) => fs.existsSync(dir)) || null;
}

// The manager's chat: its own once it has run, before that the project's latest chat (read-only).
function handleManagerRead(url, req, res) {
  if (req.headers["x-rebo"] !== "1") return json(res, 403, { error: "forbidden" });
  const project = projectFor(String(url.searchParams.get("projectId") || ""));
  if (!project) return json(res, 404, { error: "no such project" });
  const team = workspace.teamOf(project.id);
  const status = manager.statusOf(project.id);
  const chatId = status.sessionId || (!team.startFresh && project.chats[0] && project.chats[0].id) || null;
  const session = chatId && state.sessions[chatId];
  const file = chatId && ((session && session.transcriptPath) || history.fileFor(chatId));
  json(res, 200, {
    projectId: project.id,
    historyFrom: status.sessionId ? "manager" : team.startFresh ? null : chatId ? "latest" : null,
    items: readChat(file),
    pending: chatId ? control.pending(chatId) : { messages: [], stop: false },
    status,
    team: { maxAgents: team.maxAgents, permissionMode: team.permissionMode, workflow: team.workflow, cwd: folderOf(project) },
    folders: project.folderPaths || [],
  });
}

function handleManagerAction(req, res) {
  if (req.headers["x-rebo"] !== "1") return json(res, 403, { error: "forbidden" });
  readJson(req, res, (action) => {
    const project = projectFor(String(action.projectId || ""));
    if (!project) return json(res, 404, { ok: false, error: "no such project" });
    const sessionId = manager.statusOf(project.id).sessionId;
    if (action.type === "message") {
      const result = manager.send({ ...project, folderPaths: [folderOf(project)].filter(Boolean) }, action.text);
      return json(res, result.ok ? 200 : 400, result);
    }
    if (action.type === "stop") return json(res, 200, { ok: manager.stop(project.id) });
    if (action.type === "cancel") return json(res, 200, { ok: !!sessionId && control.cancel(sessionId) });
    json(res, 400, { ok: false });
  });
}

function handleSkillsRead(url, req, res) {
  if (req.headers["x-rebo"] !== "1") return json(res, 403, { error: "forbidden" });
  const project = projectFor(String(url.searchParams.get("projectId") || ""));
  if (!project) return json(res, 404, { error: "no such project" });
  const cwd = folderOf(project);
  json(res, 200, { cwd, skills: cwd ? skills.list(cwd) : [] });
}

function handleSkillsAction(req, res) {
  if (req.headers["x-rebo"] !== "1") return json(res, 403, { error: "forbidden" });
  readJson(req, res, async (action) => {
    try {
      if (action.type === "search") return json(res, 200, await skills.search(action.query));
      if (action.type === "preview") return json(res, 200, await skills.preview(String(action.githubUrl || "")));
      const project = projectFor(String(action.projectId || ""));
      const cwd = project && folderOf(project);
      if (!cwd) return json(res, 400, { ok: false, error: "Pick the project's folder in the manager settings first" });
      if (action.type === "install") return json(res, 200, await skills.install(cwd, String(action.githubUrl || "")));
      if (action.type === "remove") return json(res, 200, { ok: skills.remove(cwd, String(action.folder || "")) });
      json(res, 400, { ok: false });
    } catch (err) {
      json(res, 200, { ok: false, error: err.message });
    }
  });
}

// Heartbeat from a visible page: permission requests are only held while someone is watching.
function handlePresence(req, res) {
  if (req.headers["x-rebo"] !== "1") return json(res, 403, { error: "forbidden" });
  permissions.presence();
  json(res, 200, { ok: true });
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
  pub.permissions = permissions.toPublic();
  pub.managers = manager.toPublic();
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
  control.prune(Date.now());
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
