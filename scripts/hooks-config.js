// Adds or removes the Agent Island hooks in the user-level Claude Code settings.
// Usage: node scripts/hooks-config.js install | uninstall
// Our entries are recognized by the emit.js path, so other hooks are never touched.
const fs = require("fs");
const os = require("os");
const path = require("path");

const EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Notification",
  "Stop",
  "SubagentStart",
  "SubagentStop",
];
const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest"]);

const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const settingsPath = path.join(configDir, "settings.json");
const emitPath = path.resolve(__dirname, "..", "hooks", "emit.js").replace(/\\/g, "/");
const command = `node "${emitPath}"`;

const mode = process.argv[2];
if (mode !== "install" && mode !== "uninstall") {
  console.error("Usage: node scripts/hooks-config.js install | uninstall");
  process.exit(1);
}

const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8")) : {};
fs.writeFileSync(`${settingsPath}.agent-island.bak`, JSON.stringify(settings, null, 2));

const hooks = settings.hooks || {};
for (const event of Object.keys(hooks)) {
  hooks[event] = hooks[event]
    .map((group) => ({ ...group, hooks: (group.hooks || []).filter((h) => !String(h.command || "").includes(emitPath)) }))
    .filter((group) => group.hooks.length > 0);
  if (hooks[event].length === 0) delete hooks[event];
}

if (mode === "install") {
  for (const event of EVENTS) {
    const group = { hooks: [{ type: "command", command, async: true, timeout: 5 }] };
    if (TOOL_EVENTS.has(event)) group.matcher = "*";
    (hooks[event] = hooks[event] || []).push(group);
  }
}

settings.hooks = hooks;
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log(`${mode === "install" ? "Installed" : "Removed"} Agent Island hooks in ${settingsPath}`);
