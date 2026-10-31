const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const { createPermissions } = require("../server/permissions");

function fakeRes() {
  const res = new EventEmitter();
  res.writableEnded = false;
  res.writeHead = () => {};
  res.end = (body) => {
    res.writableEnded = true;
    res.body = JSON.parse(body);
  };
  return res;
}

const QUESTION = { questions: [{ question: "Which color?", header: "Color", multiSelect: false, options: [{ label: "Blue", description: "" }, { label: "Red", description: "" }] }] };

test("nothing is held while no page is watching", () => {
  const p = createPermissions({ onChange() {} });
  assert.strictEqual(p.hold({ session_id: "s1", tool_name: "Bash", tool_input: { command: "ls" } }, fakeRes()), false);
});

test("allow and deny answer the waiting hook", () => {
  const p = createPermissions({ onChange() {} });
  p.presence();
  const res = fakeRes();
  assert.ok(p.hold({ session_id: "s1", tool_name: "Bash", tool_input: { command: "npm run deploy" } }, res));
  const [req] = p.toPublic();
  assert.strictEqual(req.detail, "npm run deploy");
  assert.strictEqual(p.answer("other", req.id, { behavior: "allow" }), false);
  assert.ok(p.answer("s1", req.id, { behavior: "deny" }));
  assert.strictEqual(res.body.hookSpecificOutput.decision.behavior, "deny");
  assert.deepStrictEqual(p.toPublic(), []);
});

test("a question is answered by allowing it with the answers", () => {
  const p = createPermissions({ onChange() {} });
  p.presence();
  const res = fakeRes();
  p.hold({ session_id: "s1", tool_name: "AskUserQuestion", tool_input: QUESTION }, res);
  const [req] = p.toPublic();
  assert.strictEqual(req.questions[0].options.length, 2);
  assert.strictEqual(p.answer("s1", req.id, { behavior: "allow", answers: {} }), false);
  assert.ok(p.answer("s1", req.id, { behavior: "allow", answers: { "Which color?": "Blue" } }));
  const d = res.body.hookSpecificOutput.decision;
  assert.strictEqual(d.behavior, "allow");
  assert.deepStrictEqual(d.updatedInput.answers, { "Which color?": "Blue" });
  assert.strictEqual(d.updatedInput.questions.length, 1);
});

test("answer in Claude releases the hook with no decision", () => {
  const p = createPermissions({ onChange() {} });
  p.presence();
  const res = fakeRes();
  p.hold({ session_id: "s1", tool_name: "Bash", tool_input: { command: "ls" } }, res);
  assert.ok(p.answer("s1", p.toPublic()[0].id, { behavior: "app" }));
  assert.deepStrictEqual(res.body, {});
});
