// The bookshelf: skills a project's agents can use. Lists the project's own skills
// (<folder>/.claude/skills/*/SKILL.md), searches the SkillsMP marketplace and installs a skill from
// its GitHub folder after the user has seen what it contains. Third-party skills can carry scripts
// or instructions that call out to the network, so the preview lists every file and flags them.
// The SkillsMP key comes from data/secrets.json or SKILLSMP_API_KEY, never from the repository.
const fs = require("fs");
const path = require("path");

const SEARCH_URL = "https://skillsmp.com/api/v1/skills/search";
const MAX_FILES = 40;
const MAX_FILE_BYTES = 200 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const MAX_DEPTH = 3;
const REMOVED_DIR = path.join(__dirname, "..", "data", "removed-skills");
const SCRIPT_EXT = /\.(py|sh|bash|js|mjs|cjs|ts|ps1|bat|cmd|rb|pl|php|go|rs)$/i;
const BINARY_EXT = /\.(exe|dll|so|dylib|bin|msi|app|jar|zip|tar|gz|7z|rar)$/i;
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const RED_FLAGS = [
  [/\b(curl|wget|Invoke-WebRequest|requests\.(get|post)|http\.request|urllib)\b/i, "downloads or sends data over the network"],
  [/\b(eval|exec|execSync|spawn|subprocess|os\.system|child_process)\b/i, "runs other programs or code"],
  [/base64|atob\(|frombase64/i, "decodes hidden (base64) content"],
  [/rm\s+-rf|Remove-Item\s.*-Recurse|del\s+\/s|shutil\.rmtree/i, "deletes files"],
  [/\.ssh\/|id_rsa|\.aws\/|(api[_-]?key|secret|password)\s*[:=]\s*["']?\w{8,}/i, "contains or reads keys or passwords"],
  [/ignore (all|previous|prior) instructions|do not tell the user|without asking/i, "tries to steer the agent around the user"],
];

function createSkills(secretsFile) {
  const reviewed = new Map(); // githubUrl -> { files, at }: install writes exactly what was previewed

  function apiKey() {
    if (process.env.SKILLSMP_API_KEY) return process.env.SKILLSMP_API_KEY;
    try {
      return JSON.parse(fs.readFileSync(secretsFile, "utf8")).skillsmpApiKey || null;
    } catch {
      return null;
    }
  }

  async function search(query) {
    const key = apiKey();
    if (!key) return { ok: false, error: "No SkillsMP key: add skillsmpApiKey to data/secrets.json" };
    const q = String(query || "").trim().slice(0, 120);
    if (!q) return { ok: false, error: "Type what the skills should help with" };
    const url = `${SEARCH_URL}?${new URLSearchParams({ q, limit: "12", sortBy: "stars" })}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) return { ok: false, error: (body.error && body.error.message) || `SkillsMP answered ${res.status}` };
    return {
      ok: true,
      results: body.data.skills.map((s) => ({ id: s.id, name: s.name, author: s.author, description: String(s.description || "").slice(0, 400), stars: s.stars || 0, githubUrl: s.githubUrl, skillUrl: s.skillUrl })),
    };
  }

  // Skills already on the project's shelf.
  function list(cwd) {
    const dir = path.join(cwd, ".claude", "skills");
    let names;
    try {
      names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
    return names.map((name) => {
      const meta = frontmatter(readText(path.join(dir, name, "SKILL.md")));
      return { folder: name, name: meta.name || name, description: (meta.description || "").slice(0, 300) };
    });
  }

  // Downloads the skill's files (in memory) and reports what is inside, without installing.
  async function preview(githubUrl) {
    const source = parseGithub(githubUrl);
    if (!source) return { ok: false, error: "This skill has no GitHub folder to install from" };
    const files = [];
    await collect(source, source.path, 0, files);
    reviewed.set(githubUrl, { files, at: Date.now() });
    const skillMd = files.find((f) => f.path.toLowerCase() === "skill.md");
    if (!skillMd) return { ok: false, error: "No SKILL.md in that folder" };
    const warnings = [];
    for (const f of files) {
      if (f.binary) warnings.push(`${f.path}: program or archive (not installed)`);
      else if (SCRIPT_EXT.test(f.path)) warnings.push(`${f.path}: script the agent may run`);
      for (const [re, why] of RED_FLAGS) if (!f.binary && re.test(f.text)) warnings.push(`${f.path}: ${why}`);
    }
    return { ok: true, source: githubUrl, name: frontmatter(skillMd.text).name || path.posix.basename(source.path), skillMd: skillMd.text.slice(0, 20000), files: files.map((f) => ({ path: f.path, bytes: f.bytes, binary: !!f.binary })), warnings: [...new Set(warnings)] };
  }

  async function install(cwd, githubUrl) {
    const seen = reviewed.get(githubUrl);
    if (!seen || Date.now() - seen.at > PREVIEW_TTL_MS) return { ok: false, error: "Open the preview again before installing" };
    const files = seen.files;
    const skillMd = files.find((f) => f.path.toLowerCase() === "skill.md");
    const folder = safeName(frontmatter(skillMd.text).name || path.posix.basename(parseGithub(githubUrl).path));
    const target = path.join(cwd, ".claude", "skills", folder);
    if (fs.existsSync(target)) return { ok: false, error: `"${folder}" is already on this shelf` };
    for (const f of files) {
      if (f.binary) continue;
      const out = path.join(target, ...f.path.split("/"));
      if (!out.startsWith(target + path.sep)) continue;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, f.text);
    }
    fs.writeFileSync(path.join(target, ".rebo-source.json"), JSON.stringify({ source: githubUrl, installedAt: new Date().toISOString() }, null, 2));
    return { ok: true, folder };
  }

  // Taking a skill off the shelf moves it to data/removed-skills (nothing is deleted).
  function remove(cwd, folder) {
    const name = safeName(folder);
    const from = path.join(cwd, ".claude", "skills", name);
    if (name !== folder || !fs.existsSync(path.join(from, "SKILL.md"))) return false;
    fs.mkdirSync(REMOVED_DIR, { recursive: true });
    fs.renameSync(from, path.join(REMOVED_DIR, `${Date.now()}-${name}`));
    return true;
  }

  return { search, list, preview, install, remove };
}

// https://github.com/{owner}/{repo}/tree/{branch}/{path}
function parseGithub(url) {
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/tree\/([\w.-]+)\/(.+?)\/?$/.exec(String(url || ""));
  return m ? { owner: m[1], repo: m[2], branch: m[3], path: decodeURIComponent(m[4]) } : null;
}

async function collect(source, dir, depth, files) {
  const api = `https://api.github.com/repos/${source.owner}/${source.repo}/contents/${encodeURI(dir)}?ref=${encodeURIComponent(source.branch)}`;
  const res = await fetch(api, { headers: { Accept: "application/vnd.github+json", "User-Agent": "rebo-studios" } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const entries = await res.json();
  if (!Array.isArray(entries)) throw new Error("Not a folder");
  for (const e of entries) {
    if (files.length >= MAX_FILES) return;
    const rel = e.path.slice(source.path.length + 1);
    if (e.type === "dir") {
      if (depth < MAX_DEPTH) await collect(source, e.path, depth + 1, files);
      continue;
    }
    if (e.type !== "file") continue;
    if (BINARY_EXT.test(e.name) || e.size > MAX_FILE_BYTES || totalBytes(files) + e.size > MAX_TOTAL_BYTES) {
      files.push({ path: rel, bytes: e.size, binary: true });
      continue;
    }
    const raw = await fetch(e.download_url, { headers: { "User-Agent": "rebo-studios" } });
    const text = await raw.text();
    files.push({ path: rel, bytes: e.size, text, binary: text.includes("\u0000") });
  }
}

function totalBytes(files) {
  return files.reduce((n, f) => n + (f.binary ? 0 : f.bytes), 0);
}

function frontmatter(text) {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text || "");
  const out = {};
  if (!m) return out;
  let key = null;
  for (const line of m[1].split("\n")) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      out[key] = kv[2].replace(/^[>|]-?\s*$/, "").replace(/^["']|["']$/g, "");
    } else if (key && /^\s+/.test(line)) out[key] = `${out[key]} ${line.trim()}`.trim();
  }
  return out;
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function safeName(name) {
  return String(name || "skill").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 60) || "skill";
}

module.exports = { createSkills, parseGithub, frontmatter };
