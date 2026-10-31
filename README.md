# Agent Island

Pixel-art island that shows Claude Code sessions live. See `PLAN.md` (Portuguese) for the plan.

## Run

```bash
npm start                  # server on http://127.0.0.1:4848 (npm run dev restarts on changes)
npm run hooks:install      # adds the hooks to ~/.claude/settings.json (backup: settings.json.agent-island.bak)
npm run hooks:uninstall    # removes only the Agent Island hooks
npm run simulate -- 120    # fake sessions for 120 s, for testing the island
npm test
```

Open http://127.0.0.1:4848 and click "Enable alerts" to get the bell and system notifications.

## Layout

- `hooks/emit.js` — the hook: forwards the event to the server (1 s timeout, always exits 0). Async for most events; PreToolUse, PostToolUse and Stop run with `--sync` and print the server's answer, which delivers messages and stop requests sent from the page.
- `server/chat.js` — a chat's recent conversation (tail of its transcript) and the inbox of messages / stop requests waiting for that chat's next hook. A chat that is idle or closed only gets them when it runs again.
- `server/state.js` — island state from hook events (pure, tested in `tests/`).
- `server/activity.js` — tool → place on the island, short activity labels, project from `cwd`.
- `server/permissions.js` — permission requests and AskUserQuestion answered from the page. The PermissionRequest hook (`--sync --hold`) waits for the answer, but only while a Rebo page is open and visible (heartbeat on `POST /api/presence`); otherwise, or with "Answer in Claude", Claude's own dialog shows as usual.
- `server/index.js` — HTTP: `POST /hook`, `GET /events` (SSE), `GET /state`, `GET|POST /api/chat`, static files. Only answers Host `127.0.0.1`/`localhost` (DNS rebinding) and `/api/*` needs the `X-Rebo: 1` header (no cross-site requests).
- `web/js/scene/` — Three.js low-poly island: `stage.js` renderer/camera/lights, `layout.js` positions,
  `island.js` terrain and landmarks, `props.js` builders, `people.js` colonists, `materials.js` palette.
- `web/js/ui/` — `panels.js` counters/alerts/session list, `overlay.js` bubbles pinned to 3D, `icons.js` SVG icons.
- `web/js/notify.js` sound and notifications, `daylight.js` day/night, `main.js` entry.
- `web/vendor/` — Three.js r169 (vendored, works offline). `?hour=22` previews the night.

`AGENT_ISLAND_OFF=1` disables the hook; `AGENT_ISLAND_PORT` changes the port.
