// HTML elements pinned to 3D positions: activity bubbles over colonists and name tags under houses.
// Text from hooks (commands, file names) is always set with textContent.
import * as THREE from "three";
import { iconForEntity } from "./icons.js";

const HEAD_OFFSET = 1.45; // above the head, in colonist units (scaled with the model)
const TAG_OFFSET = new THREE.Vector3(0, 0.15, 1.6);

export function createOverlay(layer, camera, canvas, onSelect) {
  const bubbles = new Map();
  const tags = new Map();
  const v = new THREE.Vector3();

  function project(world) {
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
      const el = document.createElement("div");
      el.className = "house-tag";
      layer.appendChild(el);
      tags.set(projectId, el);
    }
    return tags.get(projectId);
  }

  function update(entities, plots, selectedId) {
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
      const p = project(head);
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
      const el = tagFor(plot.project.id);
      seenTags.add(plot.project.id);
      if (el.textContent !== plot.project.name) el.textContent = plot.project.name;
      const p = project(new THREE.Vector3(plot.x, 1.1, plot.z).add(TAG_OFFSET));
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, 0)`;
    }
    for (const [id, el] of tags) {
      if (seenTags.has(id)) continue;
      el.remove();
      tags.delete(id);
    }
  }

  return { update };
}
