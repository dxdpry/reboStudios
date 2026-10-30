// Colonist entities: one per session (plus small helpers for subagents). They walk to the spot
// of their current place at a constant speed and pick a pose from what the session is doing.
import { LANDMARKS, spotFor } from "./world.js";
import { looksFor } from "./sprites.js";

const WALK_SPEED = 34; // world pixels per second
const ARRIVE_DISTANCE = 0.6;
const BOAT_SPEED = 14;

const POSE_BY_PLACE = { site: "hammer", workshop: "hammer", library: "reading", lighthouse: "telescope", dock: "waving", door: "thinking" };

export function createColonists() {
  const entities = new Map();
  let firstSync = true;

  function sync(state, plotOf) {
    const seen = new Set();
    const slots = new Map();
    const nextSlot = (key) => {
      const n = slots.get(key) || 0;
      slots.set(key, n + 1);
      return n;
    };
    const sessions = [...state.sessions].sort((a, b) => a.startedAt - b.startedAt);

    for (const s of sessions) {
      const plot = plotOf(s.projectId);
      const place = s.status === "ended" ? "boat" : s.place;
      const slotKey = place === "site" || place === "door" ? `${place}:${s.projectId}` : place;
      const target = spotFor(place, plot, nextSlot(slotKey));
      // On page load everyone is already in place; later arrivals walk in from the dock.
      const entity = upsert(s.id, () => ({ ...(firstSync ? target : spotFor("dock", null, 0)), looks: looksFor(s.id), small: false }));
      Object.assign(entity, { session: s, target, place, pose: poseFor(s.status, place) });
      seen.add(s.id);

      for (const h of s.helpers || []) {
        const key = `${s.id}:${h.id}`;
        const helperTarget = spotFor(h.place, plot, nextSlot(h.place === "site" || h.place === "door" ? `${h.place}:${s.projectId}` : h.place));
        const helper = upsert(key, () => ({ x: LANDMARKS.dock.x, y: LANDMARKS.dock.y + 20, looks: looksFor(h.id), small: true }));
        Object.assign(helper, { session: s, helper: h, target: helperTarget, place: h.place, pose: POSE_BY_PLACE[h.place] || "thinking" });
        seen.add(key);
      }
    }
    for (const key of entities.keys()) if (!seen.has(key)) entities.delete(key);
    firstSync = false;
  }

  function upsert(key, create) {
    if (!entities.has(key)) entities.set(key, { ...create(), facing: 1, walking: false, phase: Math.random() * 4, departedFor: 0 });
    return entities.get(key);
  }

  function update(dt) {
    for (const e of entities.values()) {
      const dx = e.target.x - e.x;
      const dy = e.target.y - e.y;
      const dist = Math.hypot(dx, dy);
      e.walking = dist > ARRIVE_DISTANCE;
      if (e.walking) {
        const step = Math.min(dist, WALK_SPEED * dt);
        e.x += (dx / dist) * step;
        e.y += (dy / dist) * step;
        if (Math.abs(dx) > 0.5) e.facing = dx > 0 ? 1 : -1;
      } else if (e.place === "boat") {
        e.departedFor += dt;
      }
    }
  }

  function list() {
    return [...entities.values()];
  }

  function hitTest(x, y) {
    let best = null;
    for (const e of entities.values()) {
      if (e.small) continue;
      const d = Math.hypot(e.x - x, e.y - 5 - y);
      if (d < 9 && (!best || d < best.d)) best = { d, entity: e };
    }
    return best && best.entity;
  }

  return { sync, update, list, hitTest, BOAT_SPEED };
}

function poseFor(status, place) {
  if (status === "needsYou") return "flag";
  if (status === "done") return place === "beach" ? "resting" : "idle";
  if (status === "thinking") return "thinking";
  if (status === "working") return POSE_BY_PLACE[place] || "thinking";
  return "idle";
}
