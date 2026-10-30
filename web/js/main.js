// Entry point: connects to the server stream, keeps the latest state and runs the render loop.
import * as THREE from "three";
import { createStage } from "./scene/stage.js";
import { createTower } from "./scene/tower.js";
import { createPeople } from "./scene/people.js";
import { TOWER, floorBaseY, floorTopY, deskCount } from "./scene/towerLayout.js";
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
const FLOORS_PER_SCREEN = 10;
const ROOF_EXTRA = 7; // roof terrace and crane above the top floor
const BUILDING_MARGIN = 1.5;

const stage = createStage(document.getElementById("stage"));
const tower = createTower(stage.scene);
const people = createPeople(stage.scene);
const overlay = createOverlay(document.getElementById("overlay"), stage.camera, stage.renderer.domElement, (id) => select(id, false), (id) => openProject(id));
const card = createProjectCard(document.getElementById("project-card"), () => closeProject());
const directory = createDirectory(document.getElementById("directory"), {
  open: (id) => openProject(id),
  monitor: (projectId, on) => send({ type: "monitor", projectId, on }),
  setCategory: (projectId, categoryId) => send({ type: "setCategory", projectId, categoryId }),
  addCategory: (name) => send({ type: "addCategory", name }),
  renameCategory: (categoryId, name) => send({ type: "renameCategory", categoryId, name }),
  deleteCategory: (categoryId) => send({ type: "deleteCategory", categoryId }),
});
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
window.reboStudios = { stage }; // for inspecting the scene from the devtools console

const recenter = document.getElementById("recenter");
recenter.innerHTML = ICONS.target;
recenter.title = "Go to the top floor";
recenter.addEventListener("click", () => (focusedProjectId ? closeProject() : stage.scrollTo(topScrollY())));

const backButton = document.getElementById("back");
backButton.addEventListener("click", () => closeProject());
const emptyHint = document.getElementById("empty-hint");

let state = { now: Date.now(), projects: [], sessions: [], workspace: { categories: [], projectCategory: {}, monitored: [] } };
let clockOffset = 0;
let selectedId = null;
let selectedProjectId = null;
let focusedProjectId = null; // floor mode
let floors = []; // [{ project, index }] bottom to top
let floorsKey = "";

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
    if (focusedProjectId && !tower.floorIndexOf(focusedProjectId)) closeProject();
    renderPanels();
  };
}

async function send(action) {
  try {
    await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json", "X-Rebo": "1" }, body: JSON.stringify(action) });
  } catch {
    // The stream reconnects on its own; the change is simply not applied.
  }
}

// Only monitored projects get a floor, oldest at the bottom.
function layoutFloors() {
  const monitored = new Set(state.workspace.monitored);
  const withFloor = state.projects.filter((p) => monitored.has(p.id)).sort((a, b) => (a.firstSeenAt || 0) - (b.firstSeenAt || 0));
  tower.sync(withFloor);
  floors = withFloor.map((project, i) => ({ project, index: i + 1 }));
  emptyHint.hidden = floors.length > 0;
  const key = floors.map((f) => f.project.id).join("|");
  if (key !== floorsKey) {
    floorsKey = key;
    if (!focusedProjectId) showBuilding(true);
  }
}

// The view fits up to ten floors; with more, it scrolls between the lobby and the roof.
function showBuilding(toTop) {
  const n = floors.length;
  const visible = Math.min(n, FLOORS_PER_SCREEN);
  const size = visible * TOWER.floorH + (n <= FLOORS_PER_SCREEN ? TOWER.lobbyH + ROOF_EXTRA : ROOF_EXTRA) + BUILDING_MARGIN * 2;
  const min = n <= FLOORS_PER_SCREEN ? (floorBaseY(n + 1) + ROOF_EXTRA) / 2 : size / 2 - BUILDING_MARGIN;
  const max = n <= FLOORS_PER_SCREEN ? min : floorBaseY(n + 1) + ROOF_EXTRA - size / 2 + BUILDING_MARGIN;
  stage.showBuilding({ size, min, max, y: toTop ? max : undefined });
}

function topScrollY() {
  return floorBaseY(floors.length + 1);
}

function projectById(id) {
  return state.projects.find((p) => p.id === id);
}

function serverNow() {
  return Date.now() + clockOffset;
}

function select(id, focus) {
  selectedId = selectedId === id && !focus ? null : id;
  const entity = selectedId && people.get(selectedId);
  if (focus && entity) {
    const projectId = entity.session.projectId;
    if (tower.floorIndexOf(projectId) && !focusedProjectId) stage.scrollTo(entity.model.root.position.y + 1);
  }
  renderPanels();
}

// Opening a project: its card, and (if it has a floor) the camera swings above that floor alone.
function openProject(id) {
  selectedProjectId = id;
  const index = tower.floorIndexOf(id);
  if (index) {
    focusedProjectId = id;
    tower.setFocus(id);
    stage.showFloor({ y: floorTopY(index), width: TOWER.w, depth: TOWER.d });
    backButton.hidden = false;
  }
  renderPanels();
}

function closeProject() {
  const wasFocused = focusedProjectId;
  focusedProjectId = null;
  selectedProjectId = null;
  tower.setFocus(null);
  backButton.hidden = true;
  if (wasFocused) {
    showBuilding(false);
    const index = tower.floorIndexOf(wasFocused);
    if (index) stage.scrollTo(floorBaseY(index) + TOWER.floorH / 2);
  }
  renderPanels();
}

function renderPanels() {
  const now = serverNow();
  const status = projectStatuses();
  panels.render(state, now, selectedId);
  card.render(selectedProjectId ? projectById(selectedProjectId) || null : null, state.sessions, now);
  directory.render({
    projects: state.projects,
    workspace: state.workspace,
    status,
    selectedProjectId,
    liveSessionIds: new Set(state.sessions.filter((s) => s.status !== "ended").map((s) => s.id)),
  });
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

// Click a person to select them, a floor to open it; empty space clears the person selection.
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
stage.renderer.domElement.addEventListener("pointerdown", (ev) => (downAt = { x: ev.clientX, y: ev.clientY }));
stage.renderer.domElement.addEventListener("pointerup", (ev) => {
  if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 5) return;
  const rect = stage.renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, stage.camera);
  const visiblePeople = people.list().filter((e) => e.model.root.visible).map((e) => e.model.root);
  const hit = raycaster.intersectObjects([...visiblePeople, ...tower.floorObjects()], true)[0];
  const key = hit && hit.object.userData.entityKey;
  selectedId = key ? key.split(":")[0] : null;
  const projectId = !key && hit && hit.object.userData.projectId;
  if (projectId && projectId !== focusedProjectId) openProject(projectId);
  else renderPanels();
});

window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && focusedProjectId) closeProject();
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
  people.update(dt, t, focusedProjectId ? tower.floorIndexOf(focusedProjectId) : null);
  const status = projectStatuses();
  tower.update(t, { night, statusByProject: status });
  stage.render(dt);
  const visibleFloors = focusedProjectId ? floors.filter((f) => f.project.id === focusedProjectId) : floors;
  overlay.update(people.list(), stage.mode === "floor" ? [] : visibleFloors, selectedId, status, selectedProjectId);
  if (t - lastPanelRender > 1) {
    lastPanelRender = t;
    renderPanels();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
