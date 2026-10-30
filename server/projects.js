// Finds which project a file belongs to. Sessions often start in one folder and edit files in
// another, so projects are identified by the files Claude writes, not by the session's cwd.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { projectFromCwd } = require("./activity");

const HOME = os.homedir().replace(/\\/g, "/").toLowerCase();
const MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "project.godot", "default.project.json", "ProjectSettings"];
const MARKER_EXTENSIONS = [".rbxl", ".rbxlx", ".uproject", ".sln"];
// Writes here are bookkeeping (memory, scratchpads, temp files), not project work.
const IGNORED_PREFIXES = [`${HOME}/.claude/`, `${HOME}/appdata/local/temp/`, `${HOME}/appdata/roaming/`];
// Without a marker, a file's project is its folder right under one of these.
const CONTAINERS = ["desktop", "downloads", "documents"].map((d) => `${HOME}/${d}`);

const rootCache = new Map();

function normalize(file) {
  return String(file || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function isIgnored(file) {
  const lower = normalize(file).toLowerCase();
  return !lower || IGNORED_PREFIXES.some((p) => lower.startsWith(p));
}

function hasMarker(dir) {
  try {
    const entries = fs.readdirSync(dir);
    return entries.some((e) => MARKERS.includes(e) || MARKER_EXTENSIONS.some((ext) => e.endsWith(ext)));
  } catch {
    return false;
  }
}

// Project root for a written file, or null when the write should not move the session.
function rootForFile(file) {
  if (isIgnored(file)) return null;
  const dir = path.posix.dirname(normalize(file));
  if (rootCache.has(dir)) return rootCache.get(dir);

  let root = null;
  // The outermost marker wins (a repo with nested package.json files is still one project).
  // The walk stops below the home folder, container folders like Desktop and the drive root.
  for (let current = dir; current.includes("/"); current = path.posix.dirname(current)) {
    const lower = current.toLowerCase();
    if (lower === HOME || CONTAINERS.includes(lower) || /^[a-z]:\/?$/i.test(current)) break;
    if (hasMarker(current)) root = current;
  }
  if (!root) root = fallbackRoot(dir);
  rootCache.set(dir, root);
  return root;
}

// No marker: the folder right under Desktop/Downloads/Documents, or two levels under the drive
// (C:/workspace/game), so files in subfolders still land in the same project.
function fallbackRoot(dir) {
  const parts = dir.split("/");
  const lower = dir.toLowerCase();
  const container = CONTAINERS.find((c) => lower.startsWith(c + "/"));
  if (container) return parts.slice(0, container.split("/").length + 1).join("/");
  if (!lower.startsWith(HOME + "/") && parts.length >= 3) return parts.slice(0, 3).join("/");
  return dir;
}

function projectForFile(file) {
  const root = rootForFile(file);
  return root ? projectFromCwd(root) : null;
}

// Project of a session's working directory, resolved the same way as written files.
function projectForCwd(cwd) {
  return (cwd && projectForFile(normalize(cwd) + "/.")) || projectFromCwd(cwd);
}

module.exports = { rootForFile, projectForFile, projectForCwd, isIgnored };
