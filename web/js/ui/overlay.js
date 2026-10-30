// HTML elements pinned to 3D positions: activity bubbles over colonists and name tags under houses.
// Text from hooks (commands, file names) is always set with textContent.
import * as THREE from "three";
import { iconForEntity } from "./icons.js";
import { hours, compact, freshTokens } from "./format.js";
import { houseHeight } from "../scene/props.js";
import { tierFor } from "../scene/island.js";

const HEAD_OFFSET = 1.45; // above the head, in colonist units (scaled with the model)
const TAG_GAP = 0.5; // world units between the roof and the tag
const STATUS_TEXT = { running: "Running", needsYou: "Needs you", idle: "Idle" };

export function createOverlay(layer, camera, canvas, onSelect, onSelectProject) {
  const bubbles = new Map();
  const tags = new Map();
  const v = new THREE.Vector3();

  function projectToScreen(world) {
    v.copy(world).project(camera);
    return { x: (v.x * 0.5 + 0.5) * canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * canvas.clientHeight, visible: v.z < 1 };
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

  function tagFor(projectId) {
    if (!tags.has(projectId)) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "house-tag";
      el.innerHTML = '<span class="tag-line"><span class="tag-dot"></span><span class="tag-name"></span></span><span class="tag-stats"></span>';
      el.addEventListener("click", () => onSelectProject(projectId));
      layer.appendChild(el);
      tags.set(projectId, { el, name: el.querySelector(".tag-name"), stats: el.querySelector(".tag-stats"), key: "" });
    }
    return tags.get(projectId);
  }

  // projectStatus: Map projectId -> "running" | "needsYou" (missing = idle).
  function update(entities, plots, selectedId, projectStatus, selectedProjectId) {
    const seen = new Set();
    for (const e of entities) {
      if (e.place === "boat") continue;
      const b = bubbleFor(e.key);
      seen.add(e.key);
      const s = e.session;
      const needsYou = !e.helper && s.status === "needsYou";
      const selected = !e.helper && s.id === selectedId;
      const showText = needsYou || selected;
      const text = showText ? (needsYou && s.needsYou?.detail) || s.activity : "";
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
      b.el.classList.toggle("walking", e.walking);
      const head = e.model.root.position.clone();
      head.y += HEAD_OFFSET * e.model.root.scale.y + (e.pose === "resting" && e.slot === 0 ? -0.6 : 0);
      const p = projectToScreen(head);
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

    const seenTags = new Set();
    for (const plot of plots) {
      const project = plot.project;
      const tag = tagFor(project.id);
      seenTags.add(project.id);
      const status = projectStatus.get(project.id) || "idle";
      const stats = project.stats || {};
      const statsText = `${hours(stats.activeMs || 0)} · ${compact(freshTokens(stats.tokens))} tokens`;
      const key = `${project.name}|${status}|${statsText}`;
      if (tag.key !== key) {
        tag.name.textContent = project.name;
        tag.stats.textContent = statsText;
        tag.el.dataset.status = status;
        tag.el.title = `${project.name}: ${STATUS_TEXT[status]}`;
        tag.key = key;
      }
      tag.el.classList.toggle("selected", project.id === selectedProjectId);
      const top = new THREE.Vector3(plot.x, 1.1 + houseHeight(tierFor(project)) + TAG_GAP, plot.z);
      const p = projectToScreen(top);
      tag.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
    for (const [id, tag] of tags) {
      if (seenTags.has(id)) continue;
      tag.el.remove();
      tags.delete(id);
    }
  }

  return { update };
}
