// Island state built from hook events: projects (buildings) and sessions (colonists).
// applyEvent and prune are pure over the state object, so they can be tested without a server.
const { placeForTool, labelForTool, projectFromCwd, projectKey, clip } = require("./activity");

const ENDED_LINGER_MS = 20 * 1000;
const CHATS_IN_STATE = 8; // most recent chats per project sent to the page
const STALE_SESSION_MS = 2 * 60 * 60 * 1000;
const NEEDS_YOU_NOTIFICATIONS = new Set(["permission_prompt", "agent_needs_input", "elicitation_dialog"]);

function createState() {
  return { projects: {}, sessions: {} };
}

const WRITE_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
// Pure default; the server passes the filesystem-aware resolvers from projects.js.
const DEFAULT_RESOLVE = { projectForCwd: projectFromCwd, projectForFile: () => null };

function applyEvent(state, payload, now, resolve = DEFAULT_RESOLVE) {
  const id = payload && payload.session_id;
  const event = payload && payload.hook_event_name;
  if (!id || !event) return false;

  const session = state.sessions[id] || (state.sessions[id] = newSession(id, now));
  session.lastEventAt = now;
  if (payload.transcript_path) session.transcriptPath = payload.transcript_path;
  // Kept whole (not clipped): the title is the project key and must match the transcript's.
  if (payload.session_title) session.title = String(payload.session_title).slice(0, 120);
  // The project is the chat's title, as in the Claude app. The folder it writes to is kept as detail.
  const written = WRITE_TOOLS.has(payload.tool_name) && payload.tool_input && resolve.projectForFile(payload.tool_input.file_path || payload.tool_input.notebook_path);
  const folder = written || (session.folder ? null : resolve.projectForCwd(payload.cwd));
  if (folder) session.folder = { id: folder.id, name: folder.name, cwd: folder.cwd };
  // A manager chat started by Rebo belongs to its project even when the names differ.
  const managed = resolve.managerProject && resolve.managerProject(id);
  const key = managed || projectKey(session.title, id);
  session.projectId = touchProject(state, key, (managed && state.projects[managed] && state.projects[managed].name) || session.title || "Untitled chat", now).id;
  session.managed = !!managed;

  const tool = payload.tool_name;
  const toolLabel = tool ? labelForTool(tool, payload.tool_input || {}) : "";

  switch (event) {
    case "SessionStart":
      set(session, now, { status: "idle", place: "door", activity: "Waiting for a task" });
      return true;
    case "SubagentStart":
      session.helpers[payload.agent_id] = { id: payload.agent_id, type: payload.agent_type || "helper", place: "dock", activity: "Arriving", since: now };
      return true;
    case "SubagentStop":
      delete session.helpers[payload.agent_id];
      return true;
    case "PermissionRequest":
      session.needsYou = { reason: "permission", detail: toolLabel, since: now };
      session.status = "needsYou";
      return true;
    case "Notification":
      return applyNotification(session, payload, now);
    case "SessionEnd":
      session.helpers = {};
      session.needsYou = null;
      set(session, now, { status: "ended", place: "boat", activity: "Going home" });
      return true;
  }

  // Tool events coming from a subagent move the helper, not the main colonist.
  const helper = payload.agent_id && session.helpers[payload.agent_id];
  if (helper) {
    if (event === "PreToolUse") Object.assign(helper, { place: placeForTool(tool), activity: toolLabel, since: now });
    return true;
  }

  switch (event) {
    case "UserPromptSubmit":
      session.needsYou = null;
      set(session, now, { status: "thinking", place: "door", activity: "Thinking…" });
      return true;
    case "PreToolUse":
      session.needsYou = null;
      set(session, now, { status: "working", place: placeForTool(tool), activity: toolLabel });
      return true;
    case "PostToolUse":
    case "PostToolUseFailure":
      // Stay where the tool was used; the next tool moves the colonist. Avoids ping-pong walks.
      session.needsYou = null;
      set(session, now, { status: "thinking", activity: event === "PostToolUseFailure" ? "Hit an error, thinking…" : "Thinking…" });
      return true;
    case "Stop":
      session.needsYou = null;
      set(session, now, { status: "done", place: "beach", activity: "Finished" });
      return true;
  }
  return false;
}

function applyNotification(session, payload, now) {
  const type = payload.notification_type;
  if (NEEDS_YOU_NOTIFICATIONS.has(type)) {
    if (!session.needsYou) session.needsYou = { reason: type === "permission_prompt" ? "permission" : "question", detail: clip(payload.message || ""), since: now };
    session.status = "needsYou";
    return true;
  }
  if (type === "idle_prompt" && session.status !== "needsYou") {
    set(session, now, { status: "done", place: "beach", activity: "Waiting for your reply" });
    return true;
  }
  return false;
}

function prune(state, now) {
  let changed = false;
  for (const [id, session] of Object.entries(state.sessions)) {
    const ended = session.status === "ended" && now - session.since > ENDED_LINGER_MS;
    const stale = now - session.lastEventAt > STALE_SESSION_MS;
    if (ended || stale) {
      delete state.sessions[id];
      changed = true;
    }
  }
  return changed;
}

// Merges live projects with transcript history ({ id: { name, cwd, firstAt, lastAt, activeMs, prompts, tokens } }).
function toPublic(state, now, history = {}) {
  const sessions = Object.values(state.sessions).map((s) => ({ ...s, helpers: Object.values(s.helpers) }));
  const byId = new Map();
  for (const [id, h] of Object.entries(history)) {
    byId.set(id, {
      id,
      name: h.name,
      firstSeenAt: h.firstAt,
      lastActiveAt: h.lastAt,
      stats: statsOf(h),
      chatCount: (h.chats || []).length,
      chats: (h.chats || []).slice(0, CHATS_IN_STATE),
      folders: Object.values(h.folders || {}).map((f) => f.name),
      folderPaths: Object.values(h.folders || {}).map((f) => f.cwd).filter(Boolean),
    });
  }
  const inUse = new Set(sessions.map((s) => s.projectId));
  for (const p of Object.values(state.projects)) {
    // A project only seen live (no transcript history yet) disappears once nobody is on it.
    if (!byId.has(p.id) && !inUse.has(p.id)) continue;
    const merged = byId.get(p.id) || { ...p, stats: statsOf(null), chatCount: 0, chats: [], folders: [], folderPaths: [] };
    merged.firstSeenAt = Math.min(merged.firstSeenAt || p.firstSeenAt, p.firstSeenAt);
    merged.lastActiveAt = Math.max(merged.lastActiveAt || 0, p.lastActiveAt);
    byId.set(p.id, merged);
  }
  const projects = [...byId.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  return { now, projects, sessions };
}

function statsOf(h) {
  return h ? { activeMs: h.activeMs, prompts: h.prompts, tokens: h.tokens } : { activeMs: 0, prompts: 0, tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 } };
}

function touchProject(state, id, name, now) {
  const project = state.projects[id] || (state.projects[id] = { id, name, firstSeenAt: now });
  project.name = name;
  project.lastActiveAt = now;
  return project;
}

function newSession(id, now) {
  return { id, projectId: null, status: "idle", place: "door", activity: "Arriving", since: now, startedAt: now, lastEventAt: now, needsYou: null, helpers: {} };
}

function set(session, now, fields) {
  if (fields.place && fields.place !== session.place) session.since = now;
  if (fields.status && fields.status !== session.status) session.since = now;
  Object.assign(session, fields);
}

module.exports = { createState, applyEvent, prune, toPublic };
