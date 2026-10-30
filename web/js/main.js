// Entry point: connects to the server stream, keeps the latest state and runs the render loop.
import { WORLD_W, WORLD_H, LANDMARKS, PLOTS, PALMS, PALETTE, hash, renderTerrain } from "./world.js";
import { drawHouse, drawLibrary, drawWorkshop, drawLighthouse, drawDock, drawHammock, drawBoat, drawPalm, drawColonist } from "./sprites.js";
import { createColonists } from "./colonists.js";
import { createHud } from "./hud.js";
import { createAlerts } from "./notify.js";
import { nightAmount } from "./daylight.js";

const canvas = document.getElementById("world");
const ctx = canvas.getContext("2d");
const world = document.createElement("canvas");
world.width = WORLD_W;
world.height = WORLD_H;
const wctx = world.getContext("2d");
const terrain = renderTerrain();

const colonists = createColonists();
const alerts = createAlerts(document.getElementById("alerts"));
const hud = createHud({
  counts: document.getElementById("counts"),
  needs: document.getElementById("needs"),
  sessions: document.getElementById("sessions"),
  onSelect: (id) => (selectedId = selectedId === id ? null : id),
});

let state = { now: Date.now(), projects: [], sessions: [] };
let clockOffset = 0;
let selectedId = null;
let view = { scale: 1, ox: 0, oy: 0 };
let plotByProject = new Map();

connect();

function connect() {
  const conn = document.getElementById("conn");
  const source = new EventSource("/events");
  source.onopen = () => (conn.dataset.state = "online");
  source.onerror = () => (conn.dataset.state = "offline");
  source.onmessage = (msg) => {
    state = JSON.parse(msg.data);
    clockOffset = state.now - Date.now();
    plotByProject = assignPlots(state);
    colonists.sync(state, (id) => plotByProject.get(id));
    alerts.update(state);
    hud.render(state, serverNow(), selectedId);
  };
}

// A project keeps its plot once it has one, so buildings never jump around. New projects take a
// free plot; when the island is full, a project with live sessions evicts the least recent idle one.
const PLOTS_KEY = "agentIsland.plots";
const plotIndex = loadPlots();
function loadPlots() {
  try {
    return new Map(JSON.parse(localStorage.getItem(PLOTS_KEY)) || []);
  } catch {
    return new Map();
  }
}
function savePlots() {
  try {
    localStorage.setItem(PLOTS_KEY, JSON.stringify([...plotIndex]));
  } catch {
    // Storage blocked: plots are reassigned on reload.
  }
}

function assignPlots(s) {
  const live = new Set(s.sessions.map((x) => x.projectId));
  const byId = new Map(s.projects.map((p) => [p.id, p]));
  for (const id of plotIndex.keys()) if (!byId.has(id)) plotIndex.delete(id);

  const ordered = [...s.projects].sort((a, b) => live.has(b.id) - live.has(a.id) || b.lastActiveAt - a.lastActiveAt);
  for (const p of ordered) {
    if (plotIndex.has(p.id)) continue;
    const used = new Set(plotIndex.values());
    let free = PLOTS.findIndex((_, i) => !used.has(i));
    if (free === -1 && live.has(p.id)) {
      const victim = [...plotIndex.keys()].filter((id) => !live.has(id)).sort((a, b) => byId.get(a).lastActiveAt - byId.get(b).lastActiveAt)[0];
      if (victim) {
        free = plotIndex.get(victim);
        plotIndex.delete(victim);
      }
    }
    if (free !== -1) plotIndex.set(p.id, free);
  }

  savePlots();
  const map = new Map();
  for (const [id, i] of plotIndex) map.set(id, { ...PLOTS[i], project: byId.get(id) });
  return map;
}

function serverNow() {
  return Date.now() + clockOffset;
}

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const fit = Math.min(canvas.width / WORLD_W, canvas.height / WORLD_H);
  // Whole-number scales keep pixels even, but waste too much screen above 2x; use the exact fit there.
  const scale = fit >= 1 && fit < 2 ? Math.floor(fit) : fit;
  view = { scale, ox: Math.round((canvas.width - WORLD_W * scale) / 2), oy: Math.round((canvas.height - WORLD_H * scale) / 2), dpr };
}
window.addEventListener("resize", resize);
new ResizeObserver(resize).observe(canvas.parentElement);
resize();

canvas.addEventListener("click", (ev) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) * view.dpr - view.ox) / view.scale;
  const y = ((ev.clientY - rect.top) * view.dpr - view.oy) / view.scale;
  const hit = colonists.hitTest(x, y);
  selectedId = hit ? (selectedId === hit.session.id ? null : hit.session.id) : null;
  hud.render(state, serverNow(), selectedId);
});

let last = performance.now();
function frame(nowMs) {
  const dt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  const t = nowMs / 1000;
  colonists.update(dt);
  drawWorld(t);
  present(t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setInterval(() => hud.render(state, serverNow(), selectedId), 1000);

function drawWorld(t) {
  const night = nightAmount(new Date(serverNow()));
  wctx.drawImage(terrain, 0, 0);
  drawWaterSparkles(t);

  const entities = colonists.list();
  const busyProjects = new Set(state.sessions.filter((s) => s.status === "working" || s.status === "thinking").map((s) => s.projectId));
  const workshopBusy = entities.some((e) => e.place === "workshop" && e.pose === "hammer" && !e.walking);

  const drawables = [];
  for (const [id, plot] of plotByProject) {
    const roof = PALETTE.roof[hash(id) % PALETTE.roof.length];
    drawables.push({ y: plot.y, draw: () => drawHouse(wctx, plot.x, plot.y, roof, busyProjects.has(id) || night > 0.5, t) });
  }
  drawables.push({ y: LANDMARKS.library.y, draw: () => drawLibrary(wctx, LANDMARKS.library.x, LANDMARKS.library.y) });
  drawables.push({ y: LANDMARKS.workshop.y, draw: () => drawWorkshop(wctx, LANDMARKS.workshop.x, LANDMARKS.workshop.y, t, workshopBusy) });
  drawables.push({ y: LANDMARKS.lighthouse.y, draw: () => drawLighthouse(wctx, LANDMARKS.lighthouse.x, LANDMARKS.lighthouse.y, t, night > 0.4) });
  drawables.push({ y: LANDMARKS.beach.y - 1, draw: () => drawHammock(wctx, LANDMARKS.beach.x + 6, LANDMARKS.beach.y + 1) });
  for (const palm of PALMS) drawables.push({ y: palm.y, draw: () => drawPalm(wctx, palm.x, palm.y, t) });

  for (const e of entities) {
    if (e.place === "boat" && !e.walking) {
      const bx = e.x + e.departedFor * colonists.BOAT_SPEED;
      drawables.push({ y: e.y + 2, draw: () => drawLeavingBoat(e, bx, t) });
      continue;
    }
    const pose = e.walking && e.pose !== "flag" ? "walk" : e.pose;
    drawables.push({ y: e.y, draw: () => drawColonist(wctx, { ...e, pose }, t) });
  }

  drawDock(wctx, LANDMARKS.dock.x, LANDMARKS.dock.y);
  drawables.sort((a, b) => a.y - b.y).forEach((d) => d.draw());
  drawNight(night, t);
}

function drawLeavingBoat(e, bx, t) {
  const alpha = Math.max(0, 1 - e.departedFor / 12);
  wctx.save();
  wctx.globalAlpha = alpha;
  drawBoat(wctx, Math.round(bx), Math.round(e.y + 2 + Math.sin(t * 2)));
  drawColonist(wctx, { ...e, y: e.y - 1, pose: "idle", walking: false }, t);
  wctx.restore();
}

function drawWaterSparkles(t) {
  wctx.fillStyle = "rgba(255,255,255,0.7)";
  for (let i = 0; i < 26; i++) {
    const h = hash(`sparkle${i}`);
    const x = h % WORLD_W;
    const y = (h >>> 9) % WORLD_H;
    const nx = (x - 160) / 136;
    const ny = (y - 92) / 70;
    if (nx * nx + ny * ny < 1.35) continue;
    if (Math.floor(t * 1.5 + (h % 7)) % 4 !== 0) continue;
    wctx.fillRect(x, y, 3, 1);
  }
}

function drawNight(night, t) {
  if (night <= 0) return;
  wctx.fillStyle = `rgba(16, 22, 58, ${0.5 * night})`;
  wctx.fillRect(0, 0, WORLD_W, WORLD_H);
  wctx.fillStyle = `rgba(255, 215, 94, ${0.5 * night})`;
  for (const [id, plot] of plotByProject) {
    if (!state.sessions.some((s) => s.projectId === id && s.status !== "ended")) continue;
    wctx.fillRect(plot.x - 8, plot.y - 8, 3, 3);
    wctx.fillRect(plot.x + 5, plot.y - 8, 3, 3);
  }
}

function present(t) {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = PALETTE.water;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(world, view.ox, view.oy, WORLD_W * view.scale, WORLD_H * view.scale);
  drawLabels(t);
}

// Text is drawn at screen resolution on top of the scaled world so it stays sharp.
function drawLabels(t) {
  const s = view.scale;
  const font = Math.max(10, Math.round(4.2 * s));
  ctx.font = `${font}px "Pixelify Sans", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const plot of plotByProject.values()) label(plot.project.name, plot.x, plot.y + 2, "#2a2233", "rgba(246,243,234,0.85)");

  const showAll = view.scale >= 3;
  for (const e of colonists.list()) {
    if (e.small || e.place === "boat") continue;
    const selected = e.session.id === selectedId;
    if (!selected && e.session.status !== "needsYou" && !showAll) continue;
    const text = selected || e.session.status === "needsYou" ? e.session.needsYou?.detail || e.session.activity : e.session.activity;
    const color = e.session.status === "needsYou" ? "#fff" : "#2a2233";
    const bg = e.session.status === "needsYou" ? "rgba(224,74,63,0.95)" : selected ? "rgba(255,215,94,0.95)" : "rgba(246,243,234,0.8)";
    label(text, e.x, e.y - 22, color, bg);
  }

  function label(text, wx, wy, color, bg) {
    const x = view.ox + wx * s;
    const y = view.oy + wy * s;
    const w = ctx.measureText(text).width + font * 0.8;
    ctx.fillStyle = bg;
    ctx.fillRect(Math.round(x - w / 2), Math.round(y - font * 0.15), Math.round(w), Math.round(font * 1.3));
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
}
