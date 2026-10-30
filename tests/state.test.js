const test = require("node:test");
const assert = require("node:assert");
const { createState, applyEvent, prune, toPublic } = require("../server/state");
const { projectFromCwd, placeForTool } = require("../server/activity");

const CWD = "C:\\Users\\LOW\\Desktop\\demo";
const ev = (hook_event_name, extra = {}) => ({ session_id: "s1", cwd: CWD, hook_event_name, ...extra });

test("tools send the colonist to the right place", () => {
  assert.equal(placeForTool("Read"), "library");
  assert.equal(placeForTool("Edit"), "site");
  assert.equal(placeForTool("Bash"), "workshop");
  assert.equal(placeForTool("WebSearch"), "lighthouse");
  assert.equal(placeForTool("mcp__Claude_Browser__navigate"), "lighthouse");
  assert.equal(placeForTool("Agent"), "dock");
  assert.equal(placeForTool("mcp__ccd_turn__update_plan"), "door");
});

test("worktrees belong to their repo project", () => {
  const main = projectFromCwd("C:\\work\\shop");
  const tree = projectFromCwd("C:/work/shop/.claude/worktrees/fix-cart");
  assert.equal(tree.id, main.id);
  assert.equal(tree.name, "shop");
});

test("a full turn: prompt, tool, permission, approval, stop", () => {
  const s = createState();
  applyEvent(s, ev("SessionStart"), 0);
  applyEvent(s, ev("UserPromptSubmit"), 1);
  assert.equal(s.sessions.s1.status, "thinking");

  applyEvent(s, ev("PreToolUse", { tool_name: "Bash", tool_input: { command: "npm test" } }), 2);
  assert.equal(s.sessions.s1.place, "workshop");
  assert.equal(s.sessions.s1.activity, "$ npm test");

  applyEvent(s, ev("PermissionRequest", { tool_name: "Bash", tool_input: { command: "npm test" } }), 3);
  assert.equal(s.sessions.s1.status, "needsYou");
  assert.equal(s.sessions.s1.needsYou.detail, "$ npm test");

  applyEvent(s, ev("PostToolUse", { tool_name: "Bash" }), 4);
  assert.equal(s.sessions.s1.needsYou, null);
  assert.equal(s.sessions.s1.place, "workshop", "stays where the tool ran");

  applyEvent(s, ev("Stop"), 5);
  assert.equal(s.sessions.s1.status, "done");
  assert.equal(s.sessions.s1.place, "beach");
});

test("subagent tools move the helper, not the main colonist", () => {
  const s = createState();
  applyEvent(s, ev("PreToolUse", { tool_name: "Agent", tool_input: { subagent_type: "Explore" } }), 0);
  applyEvent(s, ev("SubagentStart", { agent_id: "a1", agent_type: "Explore" }), 1);
  applyEvent(s, ev("PreToolUse", { agent_id: "a1", tool_name: "Read", tool_input: { file_path: "C:\\x\\api.ts" } }), 2);
  assert.equal(s.sessions.s1.place, "dock");
  assert.equal(s.sessions.s1.helpers.a1.place, "library");
  assert.equal(s.sessions.s1.helpers.a1.activity, "Reading api.ts");
  applyEvent(s, ev("SubagentStop", { agent_id: "a1" }), 3);
  assert.equal(toPublic(s, 3).sessions[0].helpers.length, 0);
});

test("permission notification without PermissionRequest still raises the flag", () => {
  const s = createState();
  applyEvent(s, ev("Notification", { notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" }), 0);
  assert.equal(s.sessions.s1.status, "needsYou");
  assert.equal(s.sessions.s1.needsYou.reason, "permission");
});

test("ended sessions leave after a while, stale ones are dropped", () => {
  const s = createState();
  applyEvent(s, ev("SessionEnd", { reason: "other" }), 0);
  applyEvent(s, { ...ev("UserPromptSubmit"), session_id: "s2" }, 0);
  assert.equal(prune(s, 1000), false);
  assert.equal(prune(s, 21 * 1000), true);
  assert.deepEqual(Object.keys(s.sessions), ["s2"]);
  prune(s, 3 * 60 * 60 * 1000);
  assert.deepEqual(Object.keys(s.sessions), []);
  assert.equal(Object.keys(s.projects).length, 1, "projects (buildings) stay");
});

test("a session moves to the project of the files it writes", () => {
  const s = createState();
  const resolve = {
    projectForCwd: () => ({ id: "c:/home/notes", name: "notes", cwd: "C:/home/notes" }),
    projectForFile: (f) => (f && f.includes("game") ? { id: "c:/work/game", name: "game", cwd: "C:/work/game" } : null),
  };
  applyEvent(s, ev("UserPromptSubmit"), 0, resolve);
  assert.equal(s.sessions.s1.projectId, "c:/home/notes");
  applyEvent(s, ev("PreToolUse", { tool_name: "Read", tool_input: { file_path: "C:/work/game/a.lua" } }), 1, resolve);
  assert.equal(s.sessions.s1.projectId, "c:/home/notes", "reading does not move it");
  applyEvent(s, ev("PreToolUse", { tool_name: "Edit", tool_input: { file_path: "C:/work/game/a.lua" } }), 2, resolve);
  assert.equal(s.sessions.s1.projectId, "c:/work/game");
  applyEvent(s, ev("Stop"), 3, resolve);
  assert.equal(s.sessions.s1.projectId, "c:/work/game", "and stays there");
});

test("public projects merge live state with transcript history", () => {
  const s = createState();
  applyEvent(s, ev("UserPromptSubmit"), 5000);
  const history = {
    [Object.keys(s.projects)[0]]: { name: "demo", cwd: "C:/Users/LOW/Desktop/demo", firstAt: 1000, lastAt: 2000, activeMs: 7200000, prompts: 12, tokens: { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 } },
    "c:/old/thing": { name: "thing", cwd: "C:/old/thing", firstAt: 10, lastAt: 20, activeMs: 1, prompts: 1, tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 } },
  };
  const pub = toPublic(s, 6000, history);
  assert.equal(pub.projects.length, 2);
  assert.equal(pub.projects[0].stats.prompts, 12);
  assert.equal(pub.projects[0].firstSeenAt, 1000, "started when history says");
  assert.equal(pub.projects[0].lastActiveAt, 5000);
});

test("events without a session are ignored", () => {
  const s = createState();
  assert.equal(applyEvent(s, { hook_event_name: "Stop" }, 0), false);
  assert.equal(applyEvent(s, null, 0), false);
});
