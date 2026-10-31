const test = require("node:test");
const assert = require("node:assert");
const { createControl } = require("../server/chat");

test("a message waits for PostToolUse and is delivered once", () => {
  const c = createControl();
  assert.ok(c.queue("a1", "use the blue button"));
  assert.strictEqual(c.take("a1", "PreToolUse"), null);
  const out = c.take("a1", "PostToolUse");
  assert.match(out.hookSpecificOutput.additionalContext, /use the blue button/);
  assert.strictEqual(c.take("a1", "PostToolUse"), null);
  assert.deepStrictEqual(c.pending("a1"), { messages: [], stop: false });
});

test("a message sent near the end of a turn makes Claude continue", () => {
  const c = createControl();
  c.queue("a1", "now run the tests");
  const out = c.take("a1", "Stop");
  assert.strictEqual(out.decision, "block");
  assert.match(out.reason, /now run the tests/);
  assert.strictEqual(c.take("a1", "Stop"), null);
});

test("stop ends the turn at the next tool call", () => {
  const c = createControl();
  c.requestStop("a1");
  assert.strictEqual(c.take("a1", "PreToolUse").continue, false);
  assert.strictEqual(c.take("a1", "PreToolUse"), null);
});

test("a stop request left when the turn ends is dropped", () => {
  const c = createControl();
  c.requestStop("a1");
  assert.strictEqual(c.take("a1", "Stop"), null);
  assert.strictEqual(c.take("a1", "PreToolUse"), null);
});

test("empty and excess messages are refused", () => {
  const c = createControl();
  assert.strictEqual(c.queue("a1", "   "), false);
  for (let i = 0; i < 5; i++) assert.ok(c.queue("a1", `m${i}`));
  assert.strictEqual(c.queue("a1", "one more"), false);
  assert.ok(c.cancel("a1"));
  assert.deepStrictEqual(c.pending("a1").messages, []);
});
