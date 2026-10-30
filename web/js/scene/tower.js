// The office tower: lobby, one floor per project (oldest at the bottom), roof terrace with a crane,
// and a small city around it. Floors are rebuilt only when their project or size changes.
import * as THREE from "three";
import { COLORS, mat, mesh, box, flat, hash, pick } from "./materials.js";
import { TOWER, DESKS, FURNITURE, ROOF_CHAIRS, floorBaseY, deskCount } from "./towerLayout.js";
import {
  buildDesk, screenMaterial, buildBookshelf, buildServerRack, buildTelescope, buildWhiteboard,
  buildPlant, buildSofa, buildDeckChair, buildCoffeeBar, buildReception, buildCrane, buildSkylineBlock,
} from "./officeProps.js";

const { w: W, d: D, floorH: H, lobbyH: LOBBY_H, slab: SLAB } = TOWER;
const GLASS = new THREE.MeshStandardMaterial({ color: "#cfeaf7", transparent: true, opacity: 0.07, roughness: 0.1, depthWrite: false });
const MULLION = "#f4f1ea";
const SLAB_COLOR = "#e4dccd";
const FLOOR_COLOR = "#efe2cf";

export function createTower(scene) {
  const root = new THREE.Group();
  scene.add(root);
  buildCity(scene);

  const lobby = buildLobby();
  root.add(lobby);
  const roof = buildRoof();
  root.add(roof.group);

  const floors = new Map(); // projectId -> floor record
  let order = []; // project ids, bottom to top

  // projects: the ones that get a floor, oldest first.
  function sync(projects) {
    order = projects.map((p) => p.id);
    const wanted = new Set(order);
    for (const [id, f] of floors) {
      if (wanted.has(id)) continue;
      root.remove(f.group);
      floors.delete(id);
    }
    projects.forEach((project, i) => {
      const index = i + 1;
      const desks = deskCount(project);
      let f = floors.get(project.id);
      if (f && f.desks !== desks) {
        root.remove(f.group);
        f = null;
      }
      if (!f) {
        f = buildFloor(project, desks);
        floors.set(project.id, f);
        root.add(f.group);
      }
      f.index = index;
      f.project = project;
      f.group.position.y = floorBaseY(index);
    });
    roof.group.position.y = floorBaseY(order.length + 1);
  }

  function floorIndexOf(projectId) {
    const i = order.indexOf(projectId);
    return i === -1 ? 0 : i + 1;
  }

  function roofIndex() {
    return order.length + 1;
  }

  function floorObjects() {
    return [...floors.values()].map((f) => f.group);
  }

  // statusByProject: Map id -> "running" | "needsYou"
  function update(t, { night, statusByProject }) {
    for (const [id, f] of floors) f.setState(statusByProject.get(id) || "idle", night, t);
    roof.update(t);
  }

  return { sync, floorIndexOf, roofIndex, floorObjects, update, get count() { return order.length; } };
}

// Back walls: the project's accent softened with white, strong enough to tell floors apart.
function wallColor(projectId) {
  return new THREE.Color(accentColor(projectId)).lerp(new THREE.Color("#ffffff"), 0.45);
}

function accentColor(projectId) {
  return pick(COLORS.roof, hash(projectId) >>> 4);
}

// Shell shared by every storey: slab, inner floor, back and left walls, elevator core, glass.
function buildShell(height, wallMaterial) {
  const g = new THREE.Group();
  const slab = box(W, SLAB, D, SLAB_COLOR);
  slab.position.y = SLAB / 2;
  const inner = box(W - 0.4, 0.02, D - 0.4, FLOOR_COLOR);
  inner.position.y = SLAB + 0.01;
  const wallH = height - SLAB;
  const back = mesh(new THREE.BoxGeometry(W, wallH, 0.2), wallMaterial);
  back.position.set(0, SLAB + wallH / 2, -D / 2 + 0.1);
  const left = mesh(new THREE.BoxGeometry(0.2, wallH, D), wallMaterial);
  left.position.set(-W / 2 + 0.1, SLAB + wallH / 2, 0);
  const e = FURNITURE.elevator;
  const core = box(e.w, wallH, e.d, "#d9d4cc");
  core.position.set(e.x, SLAB + wallH / 2, e.z);
  const door = box(0.9, 1.9, 0.05, "#aeb7c2");
  door.position.set(e.x, SLAB + 0.95, e.z + e.d / 2 + 0.03);
  const doorLine = box(0.03, 1.9, 0.06, "#7f8995");
  doorLine.position.copy(door.position);
  g.add(slab, inner, back, left, core, door, doorLine);

  const front = mesh(new THREE.BoxGeometry(W, wallH, 0.04), GLASS, { shadow: false, receive: false });
  front.position.set(0, SLAB + wallH / 2, D / 2);
  const side = mesh(new THREE.BoxGeometry(0.04, wallH, D), GLASS, { shadow: false, receive: false });
  side.position.set(W / 2, SLAB + wallH / 2, 0);
  front.renderOrder = side.renderOrder = 2;
  g.add(front, side);
  for (let x = -W / 2; x <= W / 2 + 0.01; x += W / 6) {
    const m = box(0.08, wallH, 0.08, MULLION);
    m.position.set(x, SLAB + wallH / 2, D / 2);
    g.add(m);
  }
  for (let z = -D / 2; z <= D / 2 + 0.01; z += D / 4) {
    const m = box(0.08, wallH, 0.08, MULLION);
    m.position.set(W / 2, SLAB + wallH / 2, z);
    g.add(m);
  }
  return flat(g);
}

function buildFloor(project, desks) {
  const wallMat = new THREE.MeshStandardMaterial({ color: wallColor(project.id), emissive: "#ffcf8a", emissiveIntensity: 0, flatShading: true, roughness: 0.9 });
  const g = buildShell(H, wallMat);

  const rug = box(5.2, 0.02, 3.6, new THREE.Color(accentColor(project.id)).lerp(new THREE.Color(FLOOR_COLOR), 0.55).getStyle());
  rug.position.set(1.1, SLAB + 0.03, 0.6);
  g.add(flat(rug));

  const screenMat = screenMaterial();
  for (const d of DESKS.slice(0, desks)) {
    const desk = buildDesk(screenMat);
    desk.position.set(d.x, SLAB, d.z);
    g.add(desk);
  }
  const ledMat = new THREE.MeshBasicMaterial({ color: "#7cf0b0" });
  const place = (object, { x, z }, rotation = 0) => {
    object.position.set(x, SLAB, z);
    object.rotation.y += rotation;
    g.add(object);
  };
  place(buildBookshelf(), FURNITURE.bookshelf);
  place(buildWhiteboard(), FURNITURE.whiteboard);
  place(buildServerRack(ledMat), FURNITURE.rack);
  place(buildTelescope(), FURNITURE.telescope);
  FURNITURE.plants.forEach((spot, i) => place(buildPlant(i + 1), spot));
  if (desks >= 4 && desks < 6) place(buildSofa(accentColor(project.id)), { x: -2.4, z: 1.6 }, Math.PI / 2);

  const ceilingMat = new THREE.MeshStandardMaterial({ color: "#fff7e6", emissive: "#fff1d0", emissiveIntensity: 0 });
  for (const x of [-1.2, 2.2]) {
    const panel = mesh(new THREE.BoxGeometry(2.4, 0.05, 1), ceilingMat, { shadow: false, receive: false });
    panel.position.set(x, H - 0.04, 0.4);
    g.add(panel);
  }
  // Shade over idle floors, like an office with the lights off.
  const dimMat = new THREE.MeshBasicMaterial({ color: "#26304d", transparent: true, opacity: 0, depthWrite: false });
  const dim = new THREE.Mesh(new THREE.BoxGeometry(W - 0.3, H - SLAB - 0.04, D - 0.3), dimMat);
  dim.position.y = SLAB + (H - SLAB) / 2;
  dim.renderOrder = 1;
  g.add(dim);

  g.traverse((o) => (o.userData.projectId = project.id));

  function setState(status, night, t) {
    const on = status !== "idle";
    wallMat.emissiveIntensity = on ? 0.18 + night * 0.3 : 0;
    ceilingMat.emissiveIntensity = on ? 1 : 0.05;
    screenMat.emissiveIntensity = on ? 0.9 : 0;
    ledMat.color.set(on && Math.floor(t * 3) % 2 ? "#7cf0b0" : "#3f8a66");
    dimMat.opacity = on ? 0 : 0.34 + night * 0.3;
  }
  return { group: g, desks, setState, index: 0, project };
}

function buildLobby() {
  const wallMat = new THREE.MeshStandardMaterial({ color: "#f6efe4", flatShading: true, roughness: 0.9 });
  const g = buildShell(LOBBY_H, wallMat);
  const reception = buildReception();
  reception.position.set(1, SLAB, -1.4);
  const sofa = buildSofa("#8fb8f2");
  sofa.position.set(-2.2, SLAB, 1.6);
  sofa.rotation.y = Math.PI / 2;
  const p1 = buildPlant(3);
  p1.position.set(4.4, SLAB, -2.6);
  const p2 = buildPlant(4);
  p2.position.set(-2.8, SLAB, -2.6);
  const sign = box(3.6, 0.5, 0.1, "#2f3a4a");
  sign.position.set(1, LOBBY_H - 0.5, D / 2 + 0.1);
  const canopy = box(2.6, 0.12, 1.2, "#f4a28c");
  canopy.position.set(1, 2.3, D / 2 + 0.6);
  g.add(reception, sofa, p1, p2, flat(sign), flat(canopy));
  return g;
}

function buildRoof() {
  const g = new THREE.Group();
  const slab = box(W, SLAB, D, SLAB_COLOR);
  slab.position.y = SLAB / 2;
  const deck = box(W - 1, 0.08, D - 1, "#d8b48c");
  deck.position.y = SLAB + 0.04;
  g.add(slab, deck);
  for (let x = -W / 2 + 0.5; x < W / 2; x += 0.9) {
    const plank = box(0.04, 0.09, D - 1, "#c49a6c");
    plank.position.set(x, SLAB + 0.05, 0);
    g.add(plank);
  }
  const rail = mesh(new THREE.BoxGeometry(W, 0.9, 0.04), GLASS, { shadow: false, receive: false });
  rail.position.set(0, SLAB + 0.45, D / 2 - 0.05);
  const railSide = mesh(new THREE.BoxGeometry(0.04, 0.9, D), GLASS, { shadow: false, receive: false });
  railSide.position.set(W / 2 - 0.05, SLAB + 0.45, 0);
  const handrail = box(W, 0.06, 0.08, MULLION);
  handrail.position.set(0, SLAB + 0.92, D / 2 - 0.05);
  const handrailSide = box(0.08, 0.06, D, MULLION);
  handrailSide.position.set(W / 2 - 0.05, SLAB + 0.92, 0);
  g.add(rail, railSide, handrail, handrailSide);

  const bar = buildCoffeeBar();
  bar.position.set(-2.6, SLAB, -2.3);
  g.add(bar);
  for (const { x, z } of ROOF_CHAIRS) {
    const chair = buildDeckChair();
    chair.position.set(x, SLAB, z);
    g.add(chair);
  }
  const umbrellaPole = box(0.06, 2.2, 0.06, "#fbf7f0");
  umbrellaPole.position.set(1, SLAB + 1.1, 0.3);
  const umbrella = mesh(new THREE.ConeGeometry(1.3, 0.5, 8), mat("#f29b8f"));
  umbrella.position.set(1, SLAB + 2.3, 0.3);
  g.add(umbrellaPole, umbrella);
  for (const [x, z, s] of [[-4.3, 2.6, 5], [4.4, 2.6, 6], [-1.2, 2.7, 7]]) {
    const plant = buildPlant(s);
    plant.position.set(x, SLAB, z);
    g.add(plant);
  }
  const crane = buildCrane();
  crane.group.position.set(3.6, SLAB, -2.2);
  g.add(crane.group);
  return { group: g, update: crane.update };
}

// Ground, street, trees and a skyline behind the tower (the camera looks from the front-right).
function buildCity(scene) {
  const ground = box(220, 0.2, 220, "#cfe3c4");
  ground.position.y = -0.1;
  const plaza = box(W + 6, 0.12, D + 7, "#ece5d8");
  plaza.position.set(0, 0.0, 1);
  const road = box(220, 0.14, 6, "#b9bfc7");
  road.position.set(0, 0.0, D / 2 + 8);
  scene.add(ground, plaza, road);
  for (let i = -6; i <= 6; i++) {
    const stripe = box(2, 0.15, 0.25, "#f4f1ea");
    stripe.position.set(i * 6, 0.01, D / 2 + 8);
    scene.add(stripe);
  }
  const trees = [[-10, 6], [10, 7], [-11, -3], [11, -2], [-6, 9], [7, 9.5]];
  for (const [x, z] of trees) {
    const trunk = box(0.3, 1.2, 0.3, COLORS.trunk);
    trunk.position.set(x, 0.6, z);
    const crown = mesh(new THREE.IcosahedronGeometry(1.1, 0), mat(COLORS.leaf));
    crown.position.set(x, 1.9, z);
    scene.add(trunk, crown);
  }
  const palette = ["#d8cfe8", "#cfe0ee", "#ead7cf", "#d6e7dc", "#e8e0cc"];
  for (let i = 0; i < 26; i++) {
    const h = hash(`block${i}`);
    const angle = Math.PI * 0.95 + (i / 26) * Math.PI * 1.1 + ((h % 100) / 100) * 0.1;
    const radius = 28 + (h % 30);
    const block = buildSkylineBlock(4 + (h % 5), 6 + ((h >>> 5) % 26), 4 + ((h >>> 9) % 4), palette[i % palette.length]);
    block.group.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    block.group.lookAt(0, 0, 0);
    scene.add(block.group);
  }
}
