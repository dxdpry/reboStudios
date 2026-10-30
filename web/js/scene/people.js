// People in the tower: one per session plus small helpers for subagents. They walk to the spot of
// their current place on their project's floor, take the elevator between floors, and play a pose
// for what the session is doing.
import * as THREE from "three";
import { COLORS, mat, mesh, box, sphere, hash, pick } from "./materials.js";
import { spotFor, floorTopY, ELEVATOR_SPOT } from "./towerLayout.js";

const WALK_SPEED = 2.6; // world units per second
const ARRIVE_DISTANCE = 0.05;
const ELEVATOR_PAUSE_S = 0.6;
const SCALE = 0.95;
const HELPER_SCALE = 0.68;
const POSE_BY_PLACE = { site: "typing", workshop: "typing", library: "reading", lighthouse: "watching", dock: "waving", door: "thinking" };

function looksFor(id) {
  const h = hash(id);
  return { skin: pick(COLORS.skin, h), hair: pick(COLORS.hair, h >>> 3), shirt: pick(COLORS.shirt, h >>> 7) };
}

function buildPerson(looks, small) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // everything that bobs, sits or reclines
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
    e.position.set(x, 1.04, 0.25);
    return e;
  });
  const feet = [-0.12, 0.12].map((x) => {
    const f = box(0.14, 0.12, 0.2, "#5b5f78");
    f.position.set(x, 0.06, 0.02);
    return f;
  });
  const hands = [-1, 1].map((side) => {
    const h = sphere(0.08, looks.skin, 0);
    h.position.set(0.32 * side, 0.55, 0.12);
    return h;
  });
  const book = box(0.36, 0.26, 0.08, "#e46f62");
  book.position.set(0, 0.66, 0.3);
  book.visible = false;
  body.add(torso, head, hair, ...eyes, ...feet, ...hands, book);

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.64, 36), new THREE.MeshBasicMaterial({ color: COLORS.alert, transparent: true, opacity: 0.9, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.visible = false;
  root.add(ring);

  root.scale.setScalar(small ? HELPER_SCALE : SCALE);
  root.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return { root, body, head, hands, feet, book, ring };
}

export function createPeople(scene) {
  const entities = new Map();
  let firstSync = true;

  // floorOf(projectId) -> floor index (0 = lobby when the project has no floor); roof = roof index.
  function sync(state, floorOf, roof, desksOf) {
    const seen = new Set();
    const slots = new Map();
    const nextSlot = (key) => {
      const n = slots.get(key) || 0;
      slots.set(key, n + 1);
      return n;
    };

    for (const s of [...state.sessions].sort((a, b) => a.startedAt - b.startedAt)) {
      const floor = floorOf(s.projectId);
      const place = s.status === "ended" ? "boat" : s.place;
      const key = place === "beach" || place === "boat" ? place : `${floor}:${place}`;
      const target = spotFor(place, floor, roof, nextSlot(key), desksOf(s.projectId));
      const e = upsert(s.id, looksFor(s.id), false, firstSync ? target : { ...ELEVATOR_SPOT, floor });
      Object.assign(e, { session: s, helper: null, target, place, pose: poseFor(s.status, place, target) });
      seen.add(s.id);

      for (const h of s.helpers || []) {
        const hk = `${s.id}:${h.id}`;
        const hTarget = spotFor(h.place, floor, roof, nextSlot(`${floor}:${h.place}`), desksOf(s.projectId));
        const helper = upsert(hk, looksFor(h.id), true, firstSync ? hTarget : { ...ELEVATOR_SPOT, floor });
        Object.assign(helper, { session: s, helper: h, target: hTarget, place: h.place, pose: POSE_BY_PLACE[h.place] || "thinking" });
        seen.add(hk);
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
      const model = buildPerson(looks, small);
      model.root.traverse((o) => (o.userData.entityKey = key));
      model.root.position.set(start.x, floorTopY(start.floor), start.z);
      scene.add(model.root);
      entities.set(key, { key, model, small, floor: start.floor, walking: false, wait: 0, phase: Math.random() * 6 });
    }
    return entities.get(key);
  }

  function update(dt, t) {
    for (const e of entities.values()) {
      const pos = e.model.root.position;
      if (e.wait > 0) {
        e.wait -= dt;
        e.model.root.visible = e.wait <= 0;
        continue;
      }
      // Changing floors: walk to the elevator, disappear for a moment, step out on the other floor.
      const goal = e.floor === e.target.floor ? e.target : ELEVATOR_SPOT;
      const dx = goal.x - pos.x;
      const dz = goal.z - pos.z;
      const dist = Math.hypot(dx, dz);
      e.walking = dist > ARRIVE_DISTANCE;
      if (e.walking) {
        const step = Math.min(dist, WALK_SPEED * dt);
        pos.x += (dx / dist) * step;
        pos.z += (dz / dist) * step;
        e.model.root.rotation.y = Math.atan2(dx, dz);
      } else if (e.floor !== e.target.floor) {
        e.floor = e.target.floor;
        e.wait = ELEVATOR_PAUSE_S;
        e.model.root.visible = false;
      } else {
        turnTowards(e.model.root, e.target.facing || 0);
      }
      pos.y = floorTopY(e.floor);
      e.model.root.visible = e.wait <= 0 && !(e.target.leaving && !e.walking);
      animate(e, t);
    }
  }

  function turnTowards(object, angle) {
    const r = object.rotation;
    r.y += Math.atan2(Math.sin(angle - r.y), Math.cos(angle - r.y)) * 0.15;
  }

  function animate(e, t) {
    const { body, head, hands, feet, book, ring } = e.model;
    const pose = e.walking ? "walk" : e.pose;
    const p = t + e.phase;
    body.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
    hands[0].position.set(-0.32, 0.55, 0.12);
    hands[1].position.set(0.32, 0.55, 0.12);
    feet[0].position.z = feet[1].position.z = 0.02;
    book.visible = pose === "reading";
    ring.visible = pose === "flag";

    switch (pose) {
      case "walk":
        body.position.y = Math.abs(Math.sin(p * 10)) * 0.07;
        feet[0].position.z = Math.sin(p * 10) * 0.14;
        feet[1].position.z = -Math.sin(p * 10) * 0.14;
        break;
      case "typing":
        if (e.target.seated) body.position.y = -0.28;
        hands[0].position.set(-0.18, 0.62 + Math.max(0, Math.sin(p * 18)) * 0.05, 0.3);
        hands[1].position.set(0.18, 0.62 + Math.max(0, Math.sin(p * 18 + 1.6)) * 0.05, 0.3);
        head.rotation.x = 0.12;
        break;
      case "reading":
        head.rotation.x = 0.25 + Math.sin(p * 1.2) * 0.05;
        hands[0].position.set(-0.18, 0.62, 0.3);
        hands[1].position.set(0.18, 0.62, 0.3);
        break;
      case "watching":
        head.rotation.y = Math.sin(p * 0.6) * 0.4;
        hands[1].position.set(0.2, 0.95, 0.25);
        break;
      case "waving":
        hands[1].position.set(0.36, 1.05 + Math.sin(p * 9) * 0.12, 0.05);
        break;
      case "flag": {
        // Needs you: jumping and waving both arms, with a pulsing ring on the floor.
        const pulse = (t * 1.4) % 1;
        ring.scale.setScalar(1 + pulse * 0.9);
        ring.material.opacity = 0.9 * (1 - pulse);
        body.position.y = Math.abs(Math.sin(p * 5)) * 0.15;
        hands[0].position.set(-0.36, 1.15 + Math.sin(p * 10) * 0.1, 0.05);
        hands[1].position.set(0.36, 1.15 - Math.sin(p * 10) * 0.1, 0.05);
        break;
      }
      case "resting":
        if (e.target.reclined) {
          body.rotation.x = -1.05;
          body.position.set(0, 0.42, -0.25);
        } else {
          body.position.y = Math.sin(p * 1.5) * 0.02;
        }
        break;
      case "thinking":
        body.rotation.z = Math.sin(p * 1.5) * 0.05;
        hands[1].position.set(0.18, 0.86, 0.24);
        break;
      default:
        body.position.y = Math.sin(p * 2) * 0.015;
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

function poseFor(status, place, target) {
  if (status === "needsYou") return "flag";
  if (status === "done") return place === "beach" ? "resting" : "idle";
  if (status === "thinking") return target.seated ? "typing" : "thinking";
  if (status === "working") return POSE_BY_PLACE[place] || "thinking";
  return "idle";
}
