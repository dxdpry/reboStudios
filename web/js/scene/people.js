// Colonists: one per session plus small helpers for subagents. They walk to the spot of their
// current place at a constant speed and play a pose for what the session is doing.
import * as THREE from "three";
import { COLORS, mat, mesh, box, cylinder, sphere, hash, pick } from "./materials.js";
import { spotFor, groundHeight, DOCK } from "./layout.js";

const WALK_SPEED = 3.2; // world units per second
const ARRIVE_DISTANCE = 0.05;
const BOAT_SPEED = 1.4;
const POSE_BY_PLACE = { site: "hammer", workshop: "hammer", library: "reading", lighthouse: "telescope", dock: "waving", door: "thinking" };

function looksFor(id) {
  const h = hash(id);
  return { skin: pick(COLORS.skin, h), hair: pick(COLORS.hair, h >>> 3), shirt: pick(COLORS.shirt, h >>> 7) };
}

function buildColonist(looks, small) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // everything that bobs / lies down
  root.add(body);

  const torso = mesh(new THREE.CapsuleGeometry(0.27, 0.3, 3, 8), mat(looks.shirt));
  torso.position.y = 0.5;
  const head = sphere(0.27, looks.skin, 2);
  head.position.y = 1.02;
  const hair = sphere(0.285, looks.hair, 2);
  hair.scale.set(1, 0.62, 1);
  hair.position.set(0, 1.12, -0.03);
  const eyes = [-0.09, 0.09].map((x) => {
    const e = sphere(0.035, "#2f2a35", 0);
    e.castShadow = false;
    e.position.set(x, 1.04, 0.25);
    return e;
  });
  const feet = [-0.12, 0.12].map((x) => {
    const f = box(0.14, 0.12, 0.2, "#5b5f78");
    f.position.set(x, 0.06, 0.02);
    return f;
  });
  const hand = sphere(0.08, looks.skin, 0);
  hand.position.set(0.33, 0.55, 0.12);
  body.add(torso, head, hair, ...eyes, ...feet, hand);

  const props = {
    hammer: makeHammer(),
    book: box(0.36, 0.26, 0.08, "#e46f62"),
    telescope: cylinder(0.05, 0.07, 0.55, "#7f8796", 6),
    flag: makeFlag(),
  };
  props.book.position.set(0, 0.62, 0.3);
  props.telescope.rotation.x = Math.PI / 2 - 0.4;
  props.telescope.position.set(0.12, 1.05, 0.42);
  props.flag.position.set(0.35, 0.3, 0);
  for (const p of Object.values(props)) {
    p.visible = false;
    body.add(p);
  }

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.64, 36), new THREE.MeshBasicMaterial({ color: COLORS.alert, transparent: true, opacity: 0.9, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  root.add(ring);

  root.scale.setScalar(small ? 0.85 : 1.35);
  return { root, body, head, hand, feet, props, ring };
}

function makeHammer() {
  const g = new THREE.Group();
  const handle = cylinder(0.03, 0.03, 0.42, "#8e6648", 5);
  handle.position.y = 0.21;
  const headPart = box(0.22, 0.1, 0.1, "#8b93a1");
  headPart.position.y = 0.42;
  g.add(handle, headPart);
  return g;
}

function makeFlag() {
  const g = new THREE.Group();
  const pole = cylinder(0.025, 0.025, 1.5, "#6b4a35", 5);
  pole.position.y = 0.75;
  const cloth = box(0.5, 0.32, 0.03, COLORS.alert);
  cloth.position.set(0.26, 1.32, 0);
  g.add(pole, cloth);
  g.userData.cloth = cloth;
  return g;
}

export function createPeople(scene, hammockBed) {
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
    const slotKey = (place, projectId) => (place === "site" || place === "door" ? `${place}:${projectId}` : place);

    for (const s of [...state.sessions].sort((a, b) => a.startedAt - b.startedAt)) {
      const plot = plotOf(s.projectId);
      const place = s.status === "ended" ? "boat" : s.place;
      const slot = nextSlot(slotKey(place, s.projectId));
      const target = spotFor(place, plot, slot);
      // On page load everyone is already in place; later arrivals walk in from the dock.
      const e = upsert(s.id, looksFor(s.id), false, firstSync ? target : spotFor("dock", null, 0));
      Object.assign(e, { session: s, helper: null, target, place, slot, pose: poseFor(s.status, place) });
      seen.add(s.id);

      for (const h of s.helpers || []) {
        const key = `${s.id}:${h.id}`;
        const helperTarget = spotFor(h.place, plot, nextSlot(slotKey(h.place, s.projectId)));
        const helper = upsert(key, looksFor(h.id), true, firstSync ? helperTarget : { x: DOCK.x, z: DOCK.toZ - 0.5 });
        Object.assign(helper, { session: s, helper: h, target: helperTarget, place: h.place, slot: 0, pose: POSE_BY_PLACE[h.place] || "thinking" });
        seen.add(key);
      }
    }
    for (const [key, e] of entities) {
      if (seen.has(key)) continue;
      scene.remove(e.model.root);
      entities.delete(key);
    }
    firstSync = false;
  }

  function upsert(key, looks, small, start) {
    if (!entities.has(key)) {
      const model = buildColonist(looks, small);
      model.root.traverse((o) => (o.userData.entityKey = key));
      model.root.position.set(start.x, groundHeight(start.x, start.z), start.z);
      scene.add(model.root);
      entities.set(key, { key, model, small, looks, walking: false, departedFor: 0, phase: Math.random() * 6 });
    }
    return entities.get(key);
  }

  function update(dt, t) {
    for (const e of entities.values()) {
      const pos = e.model.root.position;
      const dx = e.target.x - pos.x;
      const dz = e.target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      e.walking = dist > ARRIVE_DISTANCE && !(e.place === "boat" && e.departedFor > 0);
      if (e.walking) {
        const step = Math.min(dist, WALK_SPEED * dt);
        pos.x += (dx / dist) * step;
        pos.z += (dz / dist) * step;
        e.model.root.rotation.y = Math.atan2(dx, dz);
      } else if (e.place === "boat") {
        e.departedFor += dt;
        pos.z += BOAT_SPEED * dt;
      } else {
        faceCamera(e);
      }
      const ground = groundHeight(pos.x, pos.z);
      pos.y += (ground - pos.y) * Math.min(1, dt * 12);
      animate(e, t);
    }
  }

  // Idle colonists turn toward the viewer so faces and props read clearly.
  function faceCamera(e) {
    const want = e.pose === "telescope" ? Math.PI * 0.75 : e.pose === "hammer" ? -Math.PI / 2 : Math.PI / 4;
    const r = e.model.root.rotation;
    r.y += Math.atan2(Math.sin(want - r.y), Math.cos(want - r.y)) * 0.15;
  }

  function animate(e, t) {
    const { body, hand, feet, props, ring } = e.model;
    const pose = e.walking ? "walk" : e.pose;
    const p = t + e.phase;
    props.hammer.visible = pose === "hammer";
    props.book.visible = pose === "reading";
    props.telescope.visible = pose === "telescope";
    props.flag.visible = pose === "flag";
    ring.visible = pose === "flag";
    body.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    hand.position.set(0.33, 0.55, 0.12);
    feet[0].position.z = 0.02;
    feet[1].position.z = 0.02;

    switch (pose) {
      case "walk":
        body.position.y = Math.abs(Math.sin(p * 10)) * 0.08;
        feet[0].position.z = Math.sin(p * 10) * 0.14;
        feet[1].position.z = -Math.sin(p * 10) * 0.14;
        break;
      case "hammer": {
        const swing = Math.max(0, Math.sin(p * 7));
        props.hammer.position.set(0.33, 0.55 + swing * 0.25, 0.15);
        props.hammer.rotation.x = -0.6 + swing * 1.4;
        hand.position.set(0.33, 0.55 + swing * 0.25, 0.15);
        body.rotation.x = 0.05 + swing * 0.05;
        break;
      }
      case "reading":
        body.rotation.x = 0.08;
        e.model.head.rotation.x = 0.25 + Math.sin(p * 1.2) * 0.05;
        hand.position.set(0.2, 0.62, 0.3);
        break;
      case "telescope":
        hand.position.set(0.15, 0.95, 0.3);
        body.rotation.z = Math.sin(p * 0.8) * 0.05;
        break;
      case "waving":
        hand.position.set(0.38, 1.05 + Math.sin(p * 9) * 0.12, 0.05);
        break;
      case "flag": {
        props.flag.userData.cloth.rotation.y = Math.sin(p * 8) * 0.35;
        const pulse = (t * 1.4) % 1;
        ring.scale.setScalar(1 + pulse * 0.9);
        ring.material.opacity = 0.9 * (1 - pulse);
        body.position.y = Math.abs(Math.sin(p * 4)) * 0.12;
        hand.position.set(0.33, 0.95, 0.05);
        break;
      }
      case "resting":
        restInHammock(e);
        break;
      case "thinking":
        body.rotation.z = Math.sin(p * 1.5) * 0.06;
        hand.position.set(0.18, 0.86, 0.24);
        break;
      default:
        body.position.y = Math.sin(p * 2) * 0.015;
    }
    if (pose !== "reading") e.model.head.rotation.x = 0;
  }

  // The first resting colonist lies in the hammock, the others sit on the sand nearby.
  function restInHammock(e) {
    const { body } = e.model;
    if (e.slot === 0) {
      const pos = e.model.root.position;
      const s = e.model.root.scale.x;
      body.position.set((hammockBed.x - pos.x) / s, (hammockBed.y - pos.y + 0.05) / s, (hammockBed.z - pos.z) / s);
      body.rotation.z = Math.PI / 2;
      e.model.root.rotation.y = 0;
    } else {
      body.position.y = -0.22;
    }
  }

  function list() {
    return [...entities.values()];
  }

  function get(key) {
    return entities.get(key);
  }

  return { sync, update, list, get };
}

function poseFor(status, place) {
  if (status === "needsYou") return "flag";
  if (status === "done") return place === "beach" ? "resting" : "idle";
  if (status === "thinking") return "thinking";
  if (status === "working") return POSE_BY_PLACE[place] || "thinking";
  return "idle";
}
