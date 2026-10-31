const test = require("node:test");
const assert = require("node:assert");
const { buildArgs, managerPrompt, agentsJson } = require("../server/workflow");

const PROJECT = { name: "Shop" };
const team = (extra) => ({ maxAgents: 3, permissionMode: "acceptEdits", workflow: "plan-build-review", sessionId: null, ...extra });
const argAfter = (args, flag) => args[args.indexOf(flag) + 1];

test("staged work gives the manager its three roles and the stages", () => {
  const args = buildArgs(PROJECT, team(), { id: "c1" });
  const agents = JSON.parse(argAfter(args, "--agents"));
  assert.deepStrictEqual(Object.keys(agents), ["planner", "builder", "reviewer"]);
  assert.ok(!agents.planner.tools.includes("Edit") && !agents.reviewer.tools.includes("Write"));
  assert.strictEqual(agents.builder.tools, undefined); // builders keep every tool
  const prompt = argAfter(args, "--append-system-prompt");
  assert.match(prompt, /1\. Plan/);
  assert.match(prompt, /at most 3 agents/);
  assert.match(prompt, /3\. Review/);
  assert.deepStrictEqual(args.slice(-3), ["--resume", "c1", "--fork-session"]);
});

test("plan-build leaves the reviewer out", () => {
  assert.deepStrictEqual(Object.keys(JSON.parse(agentsJson(team({ workflow: "plan-build" })))), ["planner", "builder"]);
  assert.doesNotMatch(managerPrompt(team({ workflow: "plan-build" })), /Review/);
});

test("direct work has no custom agents", () => {
  const args = buildArgs(PROJECT, team({ workflow: "direct", sessionId: "m1" }), { id: "c1" });
  assert.ok(!args.includes("--agents"));
  assert.deepStrictEqual(args.slice(-2), ["--resume", "m1"]);
  assert.match(argAfter(args, "--append-system-prompt"), /delegate them to subagents/);
});

test("one agent at a time is said plainly", () => {
  assert.match(managerPrompt(team({ maxAgents: 1 })), /one agent at a time/);
});

test("a new manager chat starts without history", () => {
  const args = buildArgs(PROJECT, team({ startFresh: true }), { id: "c1" });
  assert.ok(!args.includes("--resume"));
});
