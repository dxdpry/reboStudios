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

- `hooks/emit.js` — the hook: forwards the event to the server (async, 1 s timeout, always exits 0).
- `server/state.js` — island state from hook events (pure, tested in `tests/`).
- `server/activity.js` — tool → place on the island, short activity labels, project from `cwd`.
- `server/index.js` — HTTP: `POST /hook`, `GET /events` (SSE), `GET /state`, static files.
- `web/js/` — `world.js` layout and terrain, `sprites.js` pixel art, `colonists.js` movement and poses,
  `hud.js` panels, `notify.js` sound and notifications, `daylight.js` day/night, `main.js` entry.

`AGENT_ISLAND_OFF=1` disables the hook; `AGENT_ISLAND_PORT` changes the port.
