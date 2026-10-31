// Stand-in for `claude -p --output-format stream-json`: echoes its arguments and the prompt.
let prompt = "";
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  const resumed = args.includes("--resume") ? args[args.indexOf("--resume") + 1] : null;
  const id = args.includes("--fork-session") || !resumed ? "11111111-2222-3333-4444-555555555555" : resumed;
  const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  out({ type: "system", subtype: "init", session_id: id, cwd: process.cwd() });
  out({ type: "assistant", session_id: id, message: { content: [{ type: "text", text: `got: ${prompt}` }] } });
  if (prompt.includes("slow")) return setTimeout(() => out({ type: "result", session_id: id, is_error: false, result: "done" }), 5000);
  out({ type: "result", session_id: id, is_error: prompt.includes("fail"), result: prompt.includes("fail") ? "it failed" : "done", total_cost_usd: 0.01, args });
});
