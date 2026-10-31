// The user's own organisation of projects: categories (like the Claude app's sidebar groups) and
// which projects are "monitored" (get a floor in the tower). Persisted in data/workspace.json.
// First run copies the Claude app's groups from data/claude-groups.json (title -> group).
// Each project with a floor also has a team: how many agents its manager may run at once, the
// folder the manager works in, the permission mode and the manager's own chat (session id).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const NAME_MAX = 40;
const CATEGORY_MAX = 30;
const OTHER = { id: "other", name: "Other" };
const MAX_AGENTS = 6;
const DEFAULT_TEAM = { maxAgents: 3, cwd: null, permissionMode: "bypassPermissions", workflow: "plan-build-review", sessionId: null, startFresh: false };
const WORKFLOWS = new Set(["plan-build-review", "plan-build", "direct"]);
const PERMISSION_MODES = new Set(["bypassPermissions", "acceptEdits", "default", "plan"]);

function createWorkspace(file) {
  const claude = loadClaudeGroups(path.join(path.dirname(file), "claude-groups.json"));
  let data = load(file, claude);

  function save() {
    fs.writeFile(file, JSON.stringify(data, null, 2), () => {});
  }

  // Projects seen for the first time go to the category their chat has in the Claude app (or Other), once.
  function fileNewProjects(projects) {
    let changed = false;
    for (const p of projects) {
      if (data.projectCategory[p.id]) continue;
      const group = claude.titles.get(String(p.name).toLowerCase().trim());
      const category = group && data.categories.find((c) => c.name === group);
      data.projectCategory[p.id] = category ? category.id : OTHER.id;
      changed = true;
    }
    if (changed) save();
  }

  // Applies one user action. Returns false (and changes nothing) for anything invalid.
  function apply(action) {
    if (!action || typeof action !== "object") return false;
    const id = typeof action.projectId === "string" ? action.projectId.slice(0, 500) : null;
    switch (action.type) {
      case "monitor": {
        if (!id || typeof action.on !== "boolean") return false;
        data.monitored = data.monitored.filter((m) => m !== id);
        if (action.on) data.monitored.push(id);
        break;
      }
      case "setCategory": {
        if (!id || !data.categories.some((c) => c.id === action.categoryId)) return false;
        data.projectCategory[id] = action.categoryId;
        break;
      }
      case "addCategory": {
        const name = cleanName(action.name);
        if (!name || data.categories.length >= CATEGORY_MAX) return false;
        data.categories.splice(data.categories.length - 1, 0, { id: `c-${crypto.randomUUID().slice(0, 8)}`, name });
        break;
      }
      case "renameCategory": {
        const name = cleanName(action.name);
        const category = data.categories.find((c) => c.id === action.categoryId && c.id !== OTHER.id);
        if (!name || !category) return false;
        category.name = name;
        break;
      }
      case "setTeam": {
        if (!id) return false;
        const team = teamOf(id);
        if (action.maxAgents !== undefined) {
          const n = Number(action.maxAgents);
          if (!Number.isInteger(n) || n < 1 || n > MAX_AGENTS) return false;
          team.maxAgents = n;
        }
        if (action.permissionMode !== undefined) {
          if (!PERMISSION_MODES.has(action.permissionMode)) return false;
          team.permissionMode = action.permissionMode;
        }
        if (action.workflow !== undefined) {
          if (!WORKFLOWS.has(action.workflow)) return false;
          team.workflow = action.workflow;
        }
        // A new manager chat: the next task starts without history (no resume, no fork).
        if (action.newChat === true) {
          team.sessionId = null;
          team.startFresh = true;
        }
        if (action.cwd !== undefined) {
          if (!isDirectory(action.cwd)) return false;
          team.cwd = path.resolve(action.cwd);
        }
        data.teams[id] = team;
        break;
      }
      case "deleteCategory": {
        if (action.categoryId === OTHER.id || !data.categories.some((c) => c.id === action.categoryId)) return false;
        data.categories = data.categories.filter((c) => c.id !== action.categoryId);
        for (const [pid, cid] of Object.entries(data.projectCategory)) if (cid === action.categoryId) data.projectCategory[pid] = OTHER.id;
        break;
      }
      default:
        return false;
    }
    save();
    return true;
  }

  function teamOf(projectId) {
    return { ...DEFAULT_TEAM, ...(data.teams[projectId] || {}) };
  }

  // Set by the server, not by page actions: the manager's chat once its first run started.
  function setManagerSession(projectId, sessionId) {
    data.teams[projectId] = { ...teamOf(projectId), sessionId, startFresh: false };
    save();
  }

  function managerProject(sessionId) {
    for (const [pid, team] of Object.entries(data.teams)) if (team.sessionId === sessionId) return pid;
    return null;
  }

  function toPublic() {
    return data;
  }

  return { apply, fileNewProjects, toPublic, teamOf, setManagerSession, managerProject };
}

function cleanName(name) {
  return typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";
}

function load(file, claude) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(data.categories) && Array.isArray(data.monitored) && data.projectCategory) return { teams: {}, ...data };
  } catch {
    // First run: start from the Claude app's groups.
  }
  const categories = claude.groups.map((name, i) => ({ id: `c-claude${i}`, name }));
  return { categories: [...categories, OTHER], projectCategory: {}, monitored: [], teams: {} };
}

function isDirectory(dir) {
  try {
    return typeof dir === "string" && path.isAbsolute(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function loadClaudeGroups(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const titles = new Map(Object.entries(data.titles || {}).map(([title, group]) => [title.toLowerCase().trim(), group]));
    return { groups: Array.isArray(data.groups) ? data.groups.map(String) : [], titles };
  } catch {
    return { groups: [], titles: new Map() };
  }
}

module.exports = { createWorkspace };
