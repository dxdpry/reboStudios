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

  // floorOf(projectId) -> floor index (0 = lobby when the project has no floor); roof = roof index;
  // teamOf(projectId) -> { desks, managerSessionId, managerRunning } for projects with a floor.
  // On a floor: the manager sits in the corner; every agent working right now (a chat in progress
  // or a subagent) takes the next free desk; when desks run out, the rest stand at the shelf, rack
  // or window. Finished chats rest on the roof.
  function sync(state, floorOf, roof, teamOf) {
    const seen = new Set();
    const slots = new Map();
    const nextSlot = (key) => {
      const n = slots.get(key) || 0;
      slots.set(key, n + 1);
      return n;
    };
    const seats = new Map(); // floor -> next free desk
    const seatFor = (floor, desks) => {
      const n = seats.get(floor) || 0;
      seats.set(floor, n + 1);
      return n < desks ? n : -1;
    };
    const place = (key, looks, small, target, fields) => {
      const e = upsert(key, looks, small, firstSync ? target : { ...ELEVATOR_SPOT, floor: target.floor });
      Object.assign(e, { target, ...fields });
      seen.add(key);
    };

    const managerSessions = new Map(); // manager session id -> project id
    for (const p of state.projects) {
      const floor = floorOf(p.id);
      if (!floor) continue;
      const team = teamOf(p.id);
      if (team.managerSessionId) managerSessions.set(team.managerSessionId, p.id);
      const live = team.managerSessionId && state.sessions.find((s) => s.id === team.managerSessionId);
      const session = live || { id: `manager:${p.id}`, projectId: p.id, status: team.managerRunning ? "working" : "idle", activity: team.managerRunning ? "Starting…" : "Manager", title: "Manager", helpers: [] };
      const status = live && team.managerRunning ? live.status : team.managerRunning ? "working" : "idle";
      const target = spotFor("manager", floor, roof, 0, 0);
      place(`manager:${p.id}`, looksFor(`manager:${p.id}`), false, target, { session, helper: null, manager: p.id, place: "manager", desk: -1, pose: poseFor(status === "done" ? "idle" : status, "site", target) });
    }

    for (const s of [...state.sessions].sort((a, b) => a.startedAt - b.startedAt)) {
      const floor = floorOf(s.projectId);
      const desks = floor ? teamOf(s.projectId).desks : 0;
      const working = s.status === "working" || s.status === "thinking" || s.status === "needsYou";
      if (!managerSessions.has(s.id)) {
        const spot = s.status === "ended" ? "boat" : !working ? "beach" : "desk";
        const seat = spot === "desk" && floor ? seatFor(floor, desks) : 0;
        const at = seat === -1 ? standingPlace(s.place) : spot;
        const target = spotFor(at, floor, roof, nextSlot(at === "desk" ? `${floor}:desk` : at === "beach" || at === "boat" ? at : `${floor}:${at}`), seat);
        place(s.id, looksFor(s.id), false, target, { session: s, helper: null, manager: null, place: at, desk: at === "desk" ? seat : -1, pose: poseFor(s.status, at === "desk" ? "site" : at, target) });
      }
      for (const h of s.helpers || []) {
        const seat = floor ? seatFor(floor, desks) : -1;
        const at = seat >= 0 ? "desk" : standingPlace(h.place);
        const target = spotFor(at, floor, roof, nextSlot(floor ? `${floor}:${at}` : "0:site"), seat);
        place(`${s.id}:${h.id}`, looksFor(h.id), true, target, { session: s, helper: h, manager: null, place: at, desk: seat, pose: at === "desk" ? "typing" : POSE_BY_PLACE[h.place] || "thinking" });
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

  // onlyFloor: in floor mode, people elsewhere are hidden.
  function update(dt, t, onlyFloor = null) {
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
      e.model.root.visible = e.wait <= 0 && !(e.target.leaving && !e.walking) && (onlyFloor === null || e.floor === onlyFloor);
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
      case "sitting":
        body.position.y = -0.28 + Math.sin(p * 1.5) * 0.01;
        break;
      case "thinking-seated":
        body.position.y = -0.28;
        hands[1].position.set(0.18, 0.86, 0.24);
        head.rotation.z = Math.sin(p * 1.2) * 0.08;
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

// Where an agent stands when every desk is taken: by the tool it uses (shelf, rack, window, elevator).
function standingPlace(place) {
  return POSE_BY_PLACE[place] && place !== "site" && place !== "door" ? place : "library";
}

function poseFor(status, place, target) {
  if (status === "needsYou") return "flag";
  if (status === "done" || status === "idle") return place === "beach" ? "resting" : target.seated ? "sitting" : "idle";
  if (status === "thinking") return target.seated ? "thinking-seated" : "thinking";
  if (status === "working") return POSE_BY_PLACE[place] || "thinking";
  return "idle";
}
