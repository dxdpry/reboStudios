// HTML elements pinned to 3D positions: activity bubbles over people and a plaque beside each floor.
// Text from hooks (commands, file names) is always set with textContent.
import * as THREE from "three";
import { iconForEntity } from "./icons.js";
import { hours, compact, freshTokens } from "./format.js";
import { TOWER, floorBaseY } from "../scene/towerLayout.js";

const HEAD_OFFSET = 1.45; // above the head, in person units (scaled with the model)
const STATUS_TEXT = { running: "Running", needsYou: "Needs you", idle: "Idle" };

export function createOverlay(layer, camera, canvas, onSelect, onSelectProject) {
  const bubbles = new Map();
  const plaques = new Map();
  const v = new THREE.Vector3();

  function toScreen(world) {
    v.copy(world).project(camera);
    const x = (v.x * 0.5 + 0.5) * canvas.clientWidth;
    const y = (-v.y * 0.5 + 0.5) * canvas.clientHeight;
    return { x, y, visible: v.z < 1 && y > -60 && y < canvas.clientHeight + 60 };
  }

  function bubbleFor(key) {
    if (!bubbles.has(key)) {
      const el = document.createElement("button");
      el.className = "bubble";
      el.type = "button";
      el.innerHTML = '<span class="bubble-icon"></span><span class="bubble-text"></span>';
      el.addEventListener("click", () => onSelect(key.split(":")[0]));
      layer.appendChild(el);
      bubbles.set(key, { el, icon: "", text: "" });
    }
    return bubbles.get(key);
  }

  function plaqueFor(projectId) {
    if (!plaques.has(projectId)) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "plaque";
      el.innerHTML = '<span class="tag-line"><span class="tag-dot"></span><span class="plaque-floor"></span><span class="tag-name"></span></span><span class="tag-stats"></span>';
      el.addEventListener("click", () => onSelectProject(projectId));
      layer.appendChild(el);
      plaques.set(projectId, { el, floor: el.querySelector(".plaque-floor"), name: el.querySelector(".tag-name"), stats: el.querySelector(".tag-stats"), key: "" });
    }
    return plaques.get(projectId);
  }

  // floors: [{ project, index }]; projectStatus: Map projectId -> "running" | "needsYou".
  function update(entities, floors, selectedId, projectStatus, selectedProjectId) {
    const seen = new Set();
    for (const e of entities) {
      const b = bubbleFor(e.key);
      seen.add(e.key);
      const s = e.session;
      const needsYou = !e.helper && s.status === "needsYou";
      const selected = !e.helper && s.id === selectedId;
      const text = needsYou || selected ? (needsYou && s.needsYou?.detail) || s.activity : "";
      const icon = iconForEntity(e);
      if (b.icon !== icon) {
        b.el.firstChild.innerHTML = icon;
        b.icon = icon;
      }
      if (b.text !== text) {
        b.el.lastChild.textContent = text;
        b.text = text;
      }
      b.el.classList.toggle("alert", needsYou);
      b.el.classList.toggle("selected", selected);
      b.el.classList.toggle("small", !!e.helper);
      b.el.classList.toggle("walking", e.walking || !e.model.root.visible);
      const head = e.model.root.position.clone();
      head.y += HEAD_OFFSET * e.model.root.scale.y + e.model.body.position.y;
      const p = toScreen(head);
      b.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      b.el.style.zIndex = String(needsYou ? 3000 : Math.round(p.y));
      b.el.hidden = !p.visible;
      b.el.title = `${s.title || "Session"}: ${e.helper ? e.helper.activity : s.activity}`;
    }
    for (const [key, b] of bubbles) {
      if (seen.has(key)) continue;
      b.el.remove();
      bubbles.delete(key);
    }

    const seenPlaques = new Set();
    for (const { project, index } of floors) {
      const plaque = plaqueFor(project.id);
      seenPlaques.add(project.id);
      const status = projectStatus.get(project.id) || "idle";
      const stats = project.stats || {};
      const statsText = `${hours(stats.activeMs || 0)} · ${compact(freshTokens(stats.tokens))} tokens`;
      const key = `${index}|${project.name}|${status}|${statsText}`;
      if (plaque.key !== key) {
        plaque.floor.textContent = String(index);
        plaque.name.textContent = project.name;
        plaque.stats.textContent = statsText;
        plaque.el.dataset.status = status;
        plaque.el.title = `Floor ${index} · ${project.name}: ${STATUS_TEXT[status]}`;
        plaque.key = key;
      }
      plaque.el.classList.toggle("selected", project.id === selectedProjectId);
      // On the glass, top-left of the floor, so side panels never cover it.
      const corner = new THREE.Vector3(-TOWER.w / 2 + 0.6, floorBaseY(index) + TOWER.floorH - 0.25, TOWER.d / 2);
      const p = toScreen(corner);
      plaque.el.hidden = !p.visible;
      plaque.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
    for (const [id, plaque] of plaques) {
      if (seenPlaques.has(id)) continue;
      plaque.el.remove();
      plaques.delete(id);
    }
  }

  return { update };
}
