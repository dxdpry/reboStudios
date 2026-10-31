const test = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const { createManager } = require("../server/manager");
const { createControl } = require("../server/chat");

const FAKE = path.join(__dirname, "fixtures", "fake-claude.js");

function setup() {
  const teams = {};
  const workspace = {
    teamOf: (id) => ({ maxAgents: 2, cwd: null, permissionMode: "acceptEdits", sessionId: null, ...(teams[id] || {}) }),
    setManagerSession: (id, sessionId) => (teams[id] = { ...(teams[id] || {}), sessionId }),
  };
  const sessions = [];
  let changes = 0;
  const control = createControl();
  const manager = createManager({ workspace, control, onChange: () => changes++, onSession: (sid, pid, run) => sessions.push({ sid, pid, forked: run.forked }), command: process.execPath, prefixArgs: [FAKE] });
  return { manager, teams, sessions, control, changes: () => changes };
}

const PROJECT = { id: "t:shop", name: "Shop", chats: [{ id: "aaaaaaaa-0000-0000-0000-000000000000" }], folderPaths: [os.tmpdir()] };
const finished = (manager, id) =>
  new Promise((resolve) => {
    const tick = setInterval(() => {
      if (!manager.statusOf(id).running) {
        clearInterval(tick);
        resolve(manager.statusOf(id));
      }
    }, 50);
  });

test("the first task forks the latest chat and keeps the manager's session", async () => {
  const { manager, teams, sessions } = setup();
  assert.deepStrictEqual(manager.send(PROJECT, "add a cart"), { ok: true });
  assert.strictEqual(manager.statusOf(PROJECT.id).running, true);
  const status = await finished(manager, PROJECT.id);
  assert.strictEqual(status.lastResult.error, null);
  assert.strictEqual(teams[PROJECT.id].sessionId, "11111111-2222-3333-4444-555555555555");
  assert.deepStrictEqual(sessions, [{ sid: "11111111-2222-3333-4444-555555555555", pid: PROJECT.id, forked: true }]);
});

test("later tasks resume the manager's own chat", async () => {
  const { manager, teams, sessions } = setup();
  teams[PROJECT.id] = { sessionId: "99999999-0000-0000-0000-000000000000" };
  manager.send(PROJECT, "next task");
  await finished(manager, PROJECT.id);
  assert.strictEqual(sessions.length, 0); // same session, nothing new to record
});

test("a failed task reports its error", async () => {
  const { manager } = setup();
  manager.send(PROJECT, "please fail");
  const status = await finished(manager, PROJECT.id);
  assert.strictEqual(status.lastResult.error, "it failed");
});

test("a message during a run waits in the inbox; stop ends the run", async () => {
  const { manager, control } = setup();
  manager.send(PROJECT, "slow job");
  await new Promise((r) => setTimeout(r, 400));
  assert.deepStrictEqual(manager.send(PROJECT, "also do this"), { ok: true, queued: true });
  assert.strictEqual(control.pending("11111111-2222-3333-4444-555555555555").messages[0].text, "also do this");
  assert.ok(manager.stop(PROJECT.id));
  const status = await finished(manager, PROJECT.id);
  assert.strictEqual(status.lastResult.error, "Stopped");
});

test("no folder, no run", () => {
  const { manager } = setup();
  const result = manager.send({ ...PROJECT, folderPaths: [] }, "hello");
  assert.strictEqual(result.ok, false);
});
