// Fake Claude Code sessions for testing the island without real agents.
// Usage: node scripts/simulate.js [seconds]   (default 120). Sends the same payloads the hooks send.
const http = require("http");

const PORT = Number(process.env.AGENT_ISLAND_PORT) || 4848;
const DURATION_S = Number(process.argv[2]) || 120;
const TICK_MS = 1500;

const SESSIONS = [
  { id: "sim-aaaa-1", cwd: "C:\\sim\\pixel-farm", title: "Fix boss spawn" },
  { id: "sim-bbbb-2", cwd: "C:\\sim\\pixel-farm", title: "Shop UI" },
  { id: "sim-cccc-3", cwd: "C:\\sim\\todo-api", title: "Database policies" },
  { id: "sim-dddd-4", cwd: "C:\\sim\\voice-chat", title: "Screen share" },
  { id: "sim-eeee-5", cwd: "C:\\sim\\space-shooter", title: "Enemy waves" },
];

const TOOLS = [
  ["Read", { file_path: "src/server/BossService.lua" }],
  ["Grep", { pattern: "SpawnBoss" }],
  ["Edit", { file_path: "src/client/ShopController.lua" }],
  ["Write", { file_path: "docs/notes.md" }],
  ["Bash", { command: "npm test" }],
  ["Bash", { command: "git status" }],
  ["WebSearch", { query: "roblox MessagingService limits" }],
  ["Agent", { subagent_type: "Explore" }],
];

function post(payload) {
  const body = JSON.stringify({ receivedAt: Date.now(), payload });
  const req = http.request({ host: "127.0.0.1", port: PORT, path: "/hook", method: "POST", headers: { "Content-Type": "application/json" } }, (res) => res.resume());
  req.on("error", (err) => console.error("server not reachable:", err.message));
  req.end(body);
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const base = (s) => ({ session_id: s.id, cwd: s.cwd, session_title: s.title, transcript_path: "" });

for (const s of SESSIONS) {
  post({ ...base(s), hook_event_name: "SessionStart", source: "startup" });
  post({ ...base(s), hook_event_name: "UserPromptSubmit", prompt: "(simulated)" });
}

const phase = new Map(SESSIONS.map((s) => [s.id, { waitingTicks: 0, helper: null }]));

const timer = setInterval(() => {
  for (const s of SESSIONS) {
    const p = phase.get(s.id);
    if (p.waitingTicks > 0) {
      if (--p.waitingTicks === 0) post({ ...base(s), hook_event_name: "PostToolUse", tool_name: "Bash" });
      continue;
    }
    const roll = Math.random();
    if (roll < 0.05) {
      post({ ...base(s), hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "rm -rf build && npm run deploy" } });
      p.waitingTicks = 6;
    } else if (roll < 0.12) {
      post({ ...base(s), hook_event_name: "Stop" });
    } else if (roll < 0.18) {
      post({ ...base(s), hook_event_name: "UserPromptSubmit", prompt: "(simulated)" });
    } else if (roll < 0.24 && !p.helper) {
      p.helper = `agent-${s.id}-${Date.now()}`;
      post({ ...base(s), hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "Explore" } });
      post({ ...base(s), hook_event_name: "SubagentStart", agent_id: p.helper, agent_type: "Explore" });
    } else if (p.helper && roll < 0.4) {
      const [tool, input] = pick(TOOLS.slice(0, 3));
      post({ ...base(s), hook_event_name: "PreToolUse", agent_id: p.helper, agent_type: "Explore", tool_name: tool, tool_input: input });
      if (Math.random() < 0.3) {
        post({ ...base(s), hook_event_name: "SubagentStop", agent_id: p.helper });
        p.helper = null;
      }
    } else {
      const [tool, input] = pick(TOOLS.slice(0, 7));
      post({ ...base(s), hook_event_name: "PreToolUse", tool_name: tool, tool_input: input });
    }
  }
}, TICK_MS);

setTimeout(() => {
  clearInterval(timer);
  for (const s of SESSIONS) post({ ...base(s), hook_event_name: "SessionEnd", reason: "other" });
  console.log("Simulation finished; sessions sent SessionEnd.");
  setTimeout(() => process.exit(0), 300);
}, DURATION_S * 1000);

console.log(`Simulating ${SESSIONS.length} sessions for ${DURATION_S}s on port ${PORT}...`);
