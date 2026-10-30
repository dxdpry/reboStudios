// Entry point: connects to the server stream, keeps the latest state and runs the render loop.
import * as THREE from "three";
import { createStage } from "./scene/stage.js";
import { createTower } from "./scene/tower.js";
import { createPeople } from "./scene/people.js";
import { TOWER, ARCHIVE_BELOW_MS, floorBaseY, deskCount } from "./scene/towerLayout.js";
import { COLORS, hash, pick } from "./scene/materials.js";
import { createOverlay } from "./ui/overlay.js";
import { createPanels } from "./ui/panels.js";
import { createProjectCard } from "./ui/projectCard.js";
import { createDirectory } from "./ui/directory.js";
import { ICONS } from "./ui/icons.js";
import { createAlerts } from "./notify.js";
import { nightAmount } from "./daylight.js";

// ?hour=22 previews another time of day (for checking the night look).
const HOUR_OVERRIDE = Number(new URLSearchParams(location.search).get("hour"));

const stage = createStage(document.getElementById("stage"));
const tower = createTower(stage.scene);
const people = createPeople(stage.scene);
const overlay = createOverlay(document.getElementById("overlay"), stage.camera, stage.renderer.domElement, (id) => select(id, false), (id) => pickProject(id));
const card = createProjectCard(document.getElementById("project-card"), () => pickProject(null));
const directory = createDirectory(document.getElementById("directory"), { onPick: (id) => pickProject(id, true) });
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
window.agentTower = { stage }; // for inspecting the scene from the devtools console

const recenter = document.getElementById("recenter");
recenter.innerHTML = ICONS.target;
recenter.title = "Go to the top floor";
recenter.addEventListener("click", () => stage.focusOnY(floorMid(tower.count)));

let state = { now: Date.now(), projects: [], sessions: [] };
let clockOffset = 0;
let selectedId = null;
let selectedProjectId = null;
let floors = []; // [{ project, index }] bottom to top
let archived = [];
let firstState = true;

connect();

function connect() {
  const conn = document.getElementById("conn");
  const source = new EventSource("/events");
  source.onopen = () => (conn.dataset.state = "online");
  source.onerror = () => (conn.dataset.state = "offline");
  source.onmessage = (msg) => {
    state = JSON.parse(msg.data);
    clockOffset = state.now - Date.now();
    layoutFloors();
    people.sync(state, (id) => tower.floorIndexOf(id), tower.roofIndex(), (id) => deskCount(projectById(id)));
    alerts.update(state);
    if (selectedId && !state.sessions.some((s) => s.id === selectedId)) selectedId = null;
    if (firstState) {
      firstState = false;
      stage.focusOnY(floorMid(highestBusyFloor() || tower.count));
    }
    renderPanels();
  };
}

// Every project with real work (or someone on it now) gets a floor, oldest at the bottom.
function layoutFloors() {
  const live = new Set(state.sessions.filter((s) => s.status !== "ended").map((s) => s.projectId));
  const byAge = [...state.projects].sort((a, b) => (a.firstSeenAt || 0) - (b.firstSeenAt || 0));
  const withFloor = byAge.filter((p) => live.has(p.id) || (p.stats?.activeMs || 0) >= ARCHIVE_BELOW_MS);
  archived = byAge.filter((p) => !withFloor.includes(p)).reverse();
  tower.sync(withFloor);
  floors = withFloor.map((project, i) => ({ project, index: i + 1 }));
  stage.setScrollRange(2, floorBaseY(tower.count + 1) + 2);
}

function projectById(id) {
  return state.projects.find((p) => p.id === id);
}

function floorMid(index) {
  return floorBaseY(index) + TOWER.floorH / 2;
}

function highestBusyFloor() {
  const status = projectStatuses();
  return floors.filter((f) => status.has(f.project.id)).reduce((max, f) => Math.max(max, f.index), 0);
}

function serverNow() {
  return Date.now() + clockOffset;
}

function select(id, focus) {
  selectedId = selectedId === id && !focus ? null : id;
  const entity = selectedId && people.get(selectedId);
  if (focus && entity) stage.focusOnY(entity.model.root.position.y + 1);
  renderPanels();
}

function pickProject(id, focus) {
  selectedProjectId = selectedProjectId === id && !focus ? null : id;
  const index = selectedProjectId ? tower.floorIndexOf(selectedProjectId) : 0;
  if (focus && index) stage.focusOnY(floorMid(index));
  renderPanels();
}

function renderPanels() {
  const now = serverNow();
  panels.render(state, now, selectedId);
  card.render(selectedProjectId ? projectById(selectedProjectId) || null : null, state.sessions, now);
  directory.render(floors, archived, projectStatuses(), selectedProjectId);
}

// "running" while a session works in the project, "needsYou" while one waits for you.
function projectStatuses() {
  const map = new Map();
  for (const s of state.sessions) {
    if (s.status === "needsYou") map.set(s.projectId, "needsYou");
    else if ((s.status === "working" || s.status === "thinking") && map.get(s.projectId) !== "needsYou") map.set(s.projectId, "running");
  }
  return map;
}

// Click a person to select them, a floor to open its project; empty space clears both.
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
stage.renderer.domElement.addEventListener("pointerdown", (ev) => (downAt = { x: ev.clientX, y: ev.clientY }));
stage.renderer.domElement.addEventListener("pointerup", (ev) => {
  if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 5) return;
  const rect = stage.renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, stage.camera);
  const hit = raycaster.intersectObjects([...people.list().map((e) => e.model.root), ...tower.floorObjects()], true)[0];
  const key = hit && hit.object.userData.entityKey;
  selectedId = key ? key.split(":")[0] : null;
  if (!key) selectedProjectId = (hit && hit.object.userData.projectId) || null;
  renderPanels();
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
  const status = projectStatuses();
  tower.update(t, { night, statusByProject: status });
  stage.render();
  overlay.update(people.list(), floors, selectedId, status, selectedProjectId);
  if (t - lastPanelRender > 1) {
    lastPanelRender = t;
    renderPanels();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
