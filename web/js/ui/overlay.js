// HTML elements pinned to 3D positions: activity bubbles over people and a plaque beside each floor.
// Text from hooks (commands, file names) is always set with textContent.
import * as THREE from "three";
import { ICONS, iconForEntity } from "./icons.js";
import { hours, compact, freshTokens, ago } from "./format.js";
import { TOWER, DESKS, MANAGER, FURNITURE, floorBaseY, floorTopY } from "../scene/towerLayout.js";

const HEAD_OFFSET = 1.45; // above the head, in person units (scaled with the model)
const STATUS_TEXT = { running: "Running", needsYou: "Needs you", idle: "Idle" };

export function createOverlay(layer, camera, canvas, onSelect, onSelectProject, onOpenTarget) {
  const bubbles = new Map();
  const plaques = new Map();
  const deskTags = [];
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
      el.addEventListener("click", () => onSelect(key));
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
      el.innerHTML = '<span class="tag-line"><span class="tag-dot"></span><span class="plaque-floor"></span><span class="tag-name"></span></span><span class="plaque-activity"></span><span class="tag-stats"></span>';
      el.addEventListener("click", () => onSelectProject(projectId));
      layer.appendChild(el);
      plaques.set(projectId, { el, floor: el.querySelector(".plaque-floor"), name: el.querySelector(".tag-name"), activity: el.querySelector(".plaque-activity"), stats: el.querySelector(".tag-stats"), key: "" });
    }
    return plaques.get(projectId);
  }

  // floors: [{ project, index }]; info: Map projectId -> { status, activity };
  // focus (floor mode, else null): { index, desks, manager, shelf }, each tag { target, title, meta, status }.
  function update(entities, floors, selectedId, info, selectedProjectId, focus, openKey) {
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
      const { status = "idle", activity = "" } = info.get(project.id) || {};
      const stats = project.stats || {};
      const chats = project.chatCount || 0;
      const statsText = `${hours(stats.activeMs || 0)} · ${compact(freshTokens(stats.tokens))} tokens · ${chats} chat${chats === 1 ? "" : "s"}`;
      const activityText = status === "idle" ? `Idle · ${ago(Date.now() - (project.lastActiveAt || 0))} ago` : activity;
      const key = `${index}|${project.name}|${status}|${statsText}|${activityText}`;
      if (plaque.key !== key) {
        plaque.floor.textContent = String(index);
        plaque.name.textContent = project.name;
        plaque.activity.textContent = activityText;
        plaque.stats.textContent = statsText;
        plaque.el.dataset.status = status;
        plaque.el.title = `Floor ${index} · ${project.name}: ${STATUS_TEXT[status]}`;
        plaque.key = key;
      }
      plaque.el.classList.toggle("selected", project.id === selectedProjectId);
      // On the glass near the top of the floor, right of the manager's corner (left panels never cover it).
      const corner = new THREE.Vector3(-2.3, floorBaseY(index) + TOWER.floorH - 0.25, TOWER.d / 2);
      const p = toScreen(corner);
      plaque.el.hidden = !p.visible;
      plaque.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
    for (const [id, plaque] of plaques) {
      if (seenPlaques.has(id)) continue;
      plaque.el.remove();
      plaques.delete(id);
    }
    updateTags(focus, openKey);
  }

  // Floor mode: a tag on every desk (the agent working there), on the manager and on the bookshelf.
  // Clicking a tag opens what it points to (the manager's chat, a chat, the skills).
  function tagAt(i) {
    while (deskTags.length <= i) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "desk-tag";
      el.innerHTML = `<span class="desk-info" aria-hidden="true"></span><span class="desk-text"><span class="tag-line"><span class="tag-dot"></span><span class="tag-name"></span></span><span class="tag-stats"></span></span>`;
      const tag = { el, icon: el.querySelector(".desk-info"), name: el.querySelector(".tag-name"), meta: el.querySelector(".tag-stats"), data: null, iconKey: "" };
      el.addEventListener("click", () => tag.data && tag.data.target && onOpenTarget(tag.data.target));
      layer.appendChild(el);
      deskTags.push(tag);
    }
    return deskTags[i];
  }

  function updateTags(focus, openKey) {
    const items = [];
    if (focus) {
      const y = floorTopY(focus.index);
      focus.desks.forEach((desk, i) => items.push({ data: desk, kind: "desk", icon: "info", at: new THREE.Vector3(DESKS[i].x, y + 0.9, DESKS[i].z + 0.55) }));
      items.push({ data: focus.manager, kind: "manager", icon: "crown", at: new THREE.Vector3(MANAGER.desk.x, y + 0.9, MANAGER.desk.z + 0.55) });
      items.push({ data: focus.shelf, kind: "shelf", icon: "book", at: new THREE.Vector3(FURNITURE.bookshelf.x, y + 2, FURNITURE.bookshelf.z + 0.5) });
    }
    items.forEach((item, i) => {
      const tag = tagAt(i);
      const { data } = item;
      tag.data = data;
      tag.el.hidden = false;
      tag.el.disabled = !data.target;
      tag.el.dataset.kind = item.kind;
      tag.el.dataset.status = data.status || "idle";
      tag.el.dataset.role = data.role || "";
      if (tag.iconKey !== item.icon) {
        tag.icon.innerHTML = ICONS[item.icon];
        tag.iconKey = item.icon;
      }
      tag.name.textContent = data.title;
      tag.meta.textContent = data.meta || "";
      tag.el.title = data.target ? `Open ${data.title}` : "";
      tag.el.classList.toggle("open", !!data.target && !!openKey && (data.target.id === openKey || (data.target.kind === "manager" && data.target.projectId === openKey)));
      const p = toScreen(item.at);
      tag.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, 0)`;
    });
    for (let i = items.length; i < deskTags.length; i++) deskTags[i].el.hidden = true;
  }

  return { update };
}
