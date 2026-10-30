// Island state built from hook events: projects (buildings) and sessions (colonists).
// applyEvent and prune are pure over the state object, so they can be tested without a server.
const { placeForTool, labelForTool, projectFromCwd, clip } = require("./activity");

const ENDED_LINGER_MS = 20 * 1000;
const STALE_SESSION_MS = 2 * 60 * 60 * 1000;
const NEEDS_YOU_NOTIFICATIONS = new Set(["permission_prompt", "agent_needs_input", "elicitation_dialog"]);

function createState() {
  return { projects: {}, sessions: {} };
}

function applyEvent(state, payload, now) {
  const id = payload && payload.session_id;
  const event = payload && payload.hook_event_name;
  if (!id || !event) return false;

  const project = touchProject(state, payload.cwd, now);
  const session = state.sessions[id] || (state.sessions[id] = newSession(id, now));
  session.projectId = project.id;
  session.lastEventAt = now;
  if (payload.transcript_path) session.transcriptPath = payload.transcript_path;
  if (payload.session_title) session.title = clip(payload.session_title);

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

function toPublic(state, now) {
  const sessions = Object.values(state.sessions).map((s) => ({ ...s, helpers: Object.values(s.helpers) }));
  const projects = Object.values(state.projects).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  return { now, projects, sessions };
}

function touchProject(state, cwd, now) {
  const { id, name, cwd: root } = projectFromCwd(cwd);
  const project = state.projects[id] || (state.projects[id] = { id, name, cwd: root, firstSeenAt: now });
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
