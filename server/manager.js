// The manager of a project: runs Claude Code headless (claude -p) in the project's folder with the
// user's task. Its first run continues the project's latest chat as a fork (so it knows the
// history); later runs resume the manager's own chat. While a run is going, new messages go to the
// inbox (delivered by the chat's hooks); Stop kills the run. Subagents it starts show up as agents
// at the floor's desks through the usual hook events.
const { spawn, execFile } = require("child_process");
const fs = require("fs");

const CLAUDE = process.env.REBO_CLAUDE || "claude";
const MESSAGE_MAX = 8000;
const ERROR_MAX = 400;

// When the server itself was started from inside a Claude session (the desktop app, a terminal
// running claude), it inherits that session's variables, which make a child claude try the host's
// login instead of its own. The manager runs as a plain claude with the user's own login.
function cleanEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW|ANTHROPIC_BASE_URL)/.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function managerPrompt(maxAgents) {
  const agents =
    maxAgents === 1
      ? "Do the work yourself, or with at most one subagent at a time."
      : `When a task has independent parts, delegate them to subagents (Agent tool), with at most ${maxAgents} subagents running at the same time. Do small tasks yourself.`;
  return [
    "You are the manager of this project inside Rebo Studios, the user's dashboard that shows their projects as an office.",
    "The user sends you tasks from there. Plan each task, do it, and report back briefly in the user's language.",
    agents,
  ].join(" ");
}

// command/prefixArgs let tests run a stand-in for the claude binary.
function createManager({ workspace, control, onChange, onSession, command = CLAUDE, prefixArgs = [] }) {
  const runs = new Map(); // projectId -> { child, sessionId, startedAt, output }
  const lastResult = new Map(); // projectId -> { at, error, costUsd }

  // project: { id, name, chats, folderPaths }. Returns { ok, queued?, error? }.
  function send(project, text) {
    const message = String(text || "").trim().slice(0, MESSAGE_MAX);
    if (!project || !message) return { ok: false, error: "Empty message" };
    const team = workspace.teamOf(project.id);
    const active = runs.get(project.id);
    if (active) {
      if (!active.sessionId) return { ok: false, error: "Still starting, try again in a moment" };
      return control.queue(active.sessionId, message) ? { ok: true, queued: true } : { ok: false, error: "Too many messages waiting" };
    }
    const cwd = team.cwd || (project.folderPaths || []).find(isDirectory);
    if (!cwd) return { ok: false, error: "Pick the project's folder in the manager settings first" };

    const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", team.permissionMode, "--append-system-prompt", managerPrompt(team.maxAgents), "-n", project.name];
    const latestChat = (project.chats || [])[0];
    if (team.sessionId) args.push("--resume", team.sessionId);
    else if (latestChat) args.push("--resume", latestChat.id, "--fork-session");

    let child;
    try {
      child = spawn(command, [...prefixArgs, ...args], { cwd, env: cleanEnv(process.env), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      return { ok: false, error: `Could not start Claude Code: ${err.message}` };
    }
    const run = { child, sessionId: team.sessionId, startedAt: Date.now(), output: "", forked: !team.sessionId && !!latestChat };
    runs.set(project.id, run);
    lastResult.delete(project.id);
    child.stdin.end(message);

    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        handleLine(project.id, run, buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (run.output = (run.output + chunk).slice(-ERROR_MAX)));
    child.on("error", (err) => finish(project.id, run, { error: err.code === "ENOENT" ? "Claude Code (claude) is not installed or not in PATH" : err.message }));
    child.on("close", (code) => finish(project.id, run, code && !lastResult.has(project.id) ? { error: run.output.trim() || `Claude Code exited with code ${code}` } : null));
    onChange();
    return { ok: true };
  }

  function handleLine(projectId, run, line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.session_id && run.sessionId !== event.session_id) {
      run.sessionId = event.session_id;
      workspace.setManagerSession(projectId, event.session_id);
      onSession(event.session_id, projectId, run);
      onChange();
    }
    if (event.type === "result") {
      lastResult.set(projectId, { at: Date.now(), error: event.is_error ? String(event.result || "Failed").slice(0, ERROR_MAX) : null, costUsd: event.total_cost_usd || 0 });
    }
  }

  function finish(projectId, run, failure) {
    if (runs.get(projectId) !== run) return;
    runs.delete(projectId);
    if (failure) lastResult.set(projectId, { at: Date.now(), error: String(failure.error).slice(0, ERROR_MAX), costUsd: 0 });
    onChange();
  }

  // Kills the run with everything it started (shells, subagents).
  function stop(projectId) {
    const run = runs.get(projectId);
    if (!run) return false;
    if (process.platform === "win32") execFile("taskkill", ["/pid", String(run.child.pid), "/T", "/F"], () => {});
    else run.child.kill("SIGTERM");
    lastResult.set(projectId, { at: Date.now(), error: "Stopped", costUsd: 0 });
    return true;
  }

  function statusOf(projectId) {
    const run = runs.get(projectId);
    const result = lastResult.get(projectId) || null;
    return { running: !!run, startedAt: run ? run.startedAt : null, sessionId: run ? run.sessionId : workspace.teamOf(projectId).sessionId, lastResult: result };
  }

  function toPublic() {
    const out = {};
    for (const id of new Set([...runs.keys(), ...lastResult.keys()])) out[id] = statusOf(id);
    return out;
  }

  return { send, stop, statusOf, toPublic };
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

module.exports = { createManager, managerPrompt };
