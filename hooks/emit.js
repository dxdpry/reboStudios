// Claude Code hook: forwards the event JSON from stdin to the local Agent Island server.
// With --sync (PreToolUse, PostToolUse, Stop) it prints the server's answer, which carries the
// messages and stop requests sent from the page. Must never slow down or break a session:
// short timeout, swallow every error, always exit 0.
const http = require("http");

const PORT = Number(process.env.AGENT_ISLAND_PORT) || 4848;
const TIMEOUT_MS = 1000;
const SYNC = process.argv.includes("--sync");

if (process.env.AGENT_ISLAND_OFF === "1") process.exit(0);

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", send);
process.stdin.on("error", () => process.exit(0));

function send() {
  const body = JSON.stringify({ receivedAt: Date.now(), payload: safeParse(raw) });
  const req = http.request(
    {
      host: "127.0.0.1",
      port: PORT,
      path: "/hook",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...(SYNC ? { "X-Rebo-Sync": "1" } : {}) },
      timeout: TIMEOUT_MS,
    },
    (res) => {
      let answer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (answer += chunk));
      res.on("end", () => {
        if (SYNC && res.statusCode === 200 && answer.length > 2) process.stdout.write(answer);
        process.exit(0);
      });
    }
  );
  req.on("timeout", () => req.destroy());
  req.on("error", () => process.exit(0));
  req.end(body);
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { unparsed: text.slice(0, 2000) };
  }
}
