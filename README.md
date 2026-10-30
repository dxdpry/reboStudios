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
- `web/js/scene/` — Three.js low-poly island: `stage.js` renderer/camera/lights, `layout.js` positions,
  `island.js` terrain and landmarks, `props.js` builders, `people.js` colonists, `materials.js` palette.
- `web/js/ui/` — `panels.js` counters/alerts/session list, `overlay.js` bubbles pinned to 3D, `icons.js` SVG icons.
- `web/js/notify.js` sound and notifications, `daylight.js` day/night, `main.js` entry.
- `web/vendor/` — Three.js r169 (vendored, works offline). `?hour=22` previews the night.

`AGENT_ISLAND_OFF=1` disables the hook; `AGENT_ISLAND_PORT` changes the port.
