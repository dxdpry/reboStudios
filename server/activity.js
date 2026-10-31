// Turns raw hook data into island concepts: which place a tool sends the colonist to,
// a short human label for what it is doing, and which project a working directory belongs to.
const path = require("path");

const LABEL_MAX = 60;

const PLACE_BY_TOOL = {
  Read: "library",
  Grep: "library",
  Glob: "library",
  LS: "library",
  NotebookRead: "library",
  Edit: "site",
  MultiEdit: "site",
  Write: "site",
  NotebookEdit: "site",
  Bash: "workshop",
  PowerShell: "workshop",
  BashOutput: "workshop",
  KillShell: "workshop",
  WebSearch: "lighthouse",
  WebFetch: "lighthouse",
  Agent: "dock",
  Task: "dock",
};

function placeForTool(name = "") {
  if (PLACE_BY_TOOL[name]) return PLACE_BY_TOOL[name];
  if (/browser|chrome/i.test(name)) return "lighthouse";
  return "door";
}

function labelForTool(name = "", input = {}) {
  const file = base(input.file_path || input.notebook_path || input.path);
  switch (name) {
    case "Read":
      return clip(`Reading ${file}`);
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return clip(`Editing ${file}`);
    case "Write":
      return clip(`Writing ${file}`);
    case "Grep":
      return clip(`Searching "${input.pattern || ""}"`);
    case "Glob":
      return clip(`Looking for ${input.pattern || "files"}`);
    case "Bash":
    case "PowerShell":
      return clip(`$ ${input.command || ""}`);
    case "WebSearch":
      return clip(`Searching the web: ${input.query || ""}`);
    case "WebFetch":
      return clip(`Reading ${host(input.url)}`);
    case "AskUserQuestion":
      return "Asking you a question";
    case "Agent":
    case "Task":
      return clip(`Calling ${input.subagent_type || "a helper"}`);
  }
  if (name.startsWith("mcp__")) return clip(`Using ${name.split("__").pop()}`);
  return clip(`Using ${name || "a tool"}`);
}

// Worktrees live under <repo>/.claude/worktrees/<name>; they belong to the repo's project.
function projectFromCwd(cwd = "") {
  const normalized = String(cwd).replace(/\\/g, "/").replace(/\/+$/, "");
  const root = normalized.split("/.claude/worktrees/")[0] || "unknown";
  return { id: root.toLowerCase(), name: path.posix.basename(root) || root, cwd: root };
}

function base(file) {
  return file ? path.posix.basename(String(file).replace(/\\/g, "/")) : "a file";
}

function host(url) {
  try {
    return new URL(url).host;
  } catch {
    return "a page";
  }
}

function clip(text) {
  const line = String(text).split("\n")[0].trim();
  return line.length > LABEL_MAX ? line.slice(0, LABEL_MAX - 1) + "…" : line;
}

// A project is what the Claude app lists: a chat title. Same title = same project (case and
// spacing don't matter); a chat without a title stands alone.
function projectKey(title, chatId) {
  const t = String(title || "").toLowerCase().replace(/\s+/g, " ").trim();
  return t ? `t:${t}` : `c:${chatId}`;
}

module.exports = { placeForTool, labelForTool, projectFromCwd, projectKey, clip };
