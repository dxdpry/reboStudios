// Entry point: connects to the server stream, keeps the latest state and runs the render loop.
import * as THREE from "three";
import { createStage } from "./scene/stage.js";
import { buildIsland } from "./scene/island.js";
import { createPeople } from "./scene/people.js";
import { PLOTS } from "./scene/layout.js";
import { COLORS, hash, pick } from "./scene/materials.js";
import { createOverlay } from "./ui/overlay.js";
import { createPanels } from "./ui/panels.js";
import { ICONS } from "./ui/icons.js";
import { createAlerts } from "./notify.js";
import { nightAmount } from "./daylight.js";

const PLOTS_KEY = "agentIsland.plots";
// ?hour=22 previews another time of day (for checking the night look).
const HOUR_OVERRIDE = Number(new URLSearchParams(location.search).get("hour"));

const stageEl = document.getElementById("stage");
const stage = createStage(stageEl);
const island = buildIsland(stage.scene);
const people = createPeople(stage.scene, island.hammockBed);
const overlay = createOverlay(document.getElementById("overlay"), stage.camera, stage.renderer.domElement, (id) => select(id, false));
const panels = createPanels({
  counts: document.getElementById("counts"),
  alerts: document.getElementById("alerts"),
  sessions: document.getElementById("sessions"),
  sessionsBody: document.getElementById("sessions-body"),
  sessionsToggle: document.getElementById("sessions-toggle"),
  onSelect: (id, focus) => select(id, focus),
  colorOf: (projectId) => pick(COLORS.roof, hash(projectId) >>> 4),
});
const alerts = createAlerts(document.getElementById("alerts-toggle"));
window.agentIsland = { stage }; // for inspecting the scene from the devtools console

const recenter = document.getElementById("recenter");
recenter.innerHTML = ICONS.target;
recenter.addEventListener("click", () => stage.focusOn(null));

let state = { now: Date.now(), projects: [], sessions: [] };
let clockOffset = 0;
let selectedId = null;
let plotByProject = new Map();
const plotIndex = loadPlots();

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
    island.syncHouses(plotByProject);
    people.sync(state, (id) => plotByProject.get(id));
    alerts.update(state);
    if (selectedId && !state.sessions.some((s) => s.id === selectedId)) selectedId = null;
    panels.render(state, serverNow(), selectedId);
  };
}

function serverNow() {
  return Date.now() + clockOffset;
}

function select(id, focus) {
  selectedId = selectedId === id && !focus ? null : id;
  const entity = selectedId && people.get(selectedId);
  if (focus && entity) stage.focusOn(entity.model.root.position.clone().setY(0.8));
  panels.render(state, serverNow(), selectedId);
}

// A project keeps its plot once it has one, so houses never move. New projects take a free plot;
// when the island is full, a project with live sessions evicts the least recently active idle one.
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
  for (const [id, index] of plotIndex) map.set(id, { ...PLOTS[index], index, project: byId.get(id) });
  return map;
}

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

// Clicking a colonist selects it; clicking empty ground clears the selection.
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
stage.renderer.domElement.addEventListener("pointerdown", (ev) => (downAt = { x: ev.clientX, y: ev.clientY }));
stage.renderer.domElement.addEventListener("pointerup", (ev) => {
  if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 5) return;
  const rect = stage.renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, stage.camera);
  const hit = raycaster.intersectObjects(people.list().map((e) => e.model.root), true)[0];
  const key = hit && hit.object.userData.entityKey;
  selectedId = key ? key.split(":")[0] : null;
  panels.render(state, serverNow(), selectedId);
});

const clock = new THREE.Clock();
let lastPanelRender = 0;
function frame() {
  const dt = Math.min(0.1, clock.getDelta());
  const t = clock.elapsedTime;
  const now = new Date(serverNow());
  if (Number.isFinite(HOUR_OVERRIDE) && HOUR_OVERRIDE > 0) now.setHours(HOUR_OVERRIDE, 0);
  const night = nightAmount(now);
  stage.setNight(night);
  people.update(dt, t);
  const entities = people.list();
  island.update(t, {
    night,
    workshopBusy: entities.some((e) => e.place === "workshop" && e.pose === "hammer" && !e.walking),
    litProjects: new Set(state.sessions.filter((s) => s.status === "working" || s.status === "thinking" || s.status === "needsYou").map((s) => s.projectId)),
  });
  stage.render();
  overlay.update(entities, [...plotByProject.values()], selectedId);
  if (t - lastPanelRender > 1) {
    lastPanelRender = t;
    panels.render(state, serverNow(), selectedId);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
