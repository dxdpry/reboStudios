// The office tower: lobby, one floor per monitored project (oldest at the bottom) and a roof lounge.
// Each floor has one desk per chat of the project, a bookshelf (reading), a server rack (commands)
// and a window corner (web). Floors are rebuilt only when their project or desk count changes.
import * as THREE from "three";
import { COLORS, mat, mesh, box, flat, hash, pick } from "./materials.js";
import { TOWER, DESKS, FURNITURE, ROOF_CHAIRS, floorBaseY, deskCount } from "./towerLayout.js";
import { buildDesk, screenMaterial, buildBookshelf, buildServerRack, buildPlant, buildSofa, buildDeckChair, buildCoffeeBar, buildReception } from "./officeProps.js";

const { w: W, d: D, floorH: H, lobbyH: LOBBY_H, slab: SLAB } = TOWER;
const GLASS = new THREE.MeshStandardMaterial({ color: "#cfeaf7", transparent: true, opacity: 0.06, roughness: 0.1, depthWrite: false });
const FRAME = "#f6f1e8";
const SLAB_COLOR = "#e2d9ca";
const FLOOR_COLOR = "#f1e6d6";

export function createTower(scene) {
  const root = new THREE.Group();
  scene.add(root);
  const city = buildCity();
  scene.add(city);

  const lobby = buildLobby();
  root.add(lobby);
  const roof = buildRoof();
  root.add(roof);

  const floors = new Map(); // projectId -> floor record
  let focused = null;
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
      f.index = i + 1;
      f.group.position.y = floorBaseY(i + 1);
    });
    roof.position.y = floorBaseY(order.length + 1);
    setFocus(focused && floors.has(focused) ? focused : null);
  }

  function floorIndexOf(projectId) {
    const i = order.indexOf(projectId);
    return i === -1 ? 0 : i + 1;
  }

  function roofIndex() {
    return order.length + 1;
  }

  function floorObjects() {
    return [...floors.values()].filter((f) => f.group.visible).map((f) => f.group);
  }

  // Floor mode shows a single floor on a plain background; null shows the whole tower.
  function setFocus(projectId) {
    focused = projectId;
    lobby.visible = roof.visible = city.visible = !projectId;
    for (const [id, f] of floors) {
      f.group.visible = !projectId || id === projectId;
      f.setOpenTop(!!projectId);
    }
  }

  // statusByProject: Map id -> "running" | "needsYou"; busyDesks: Map id -> Set of desk indexes in use.
  function update(t, { night, statusByProject, busyDesks }) {
    for (const [id, f] of floors) f.setState(statusByProject.get(id) || "idle", busyDesks.get(id) || new Set(), night, t);
  }

  return { sync, floorIndexOf, roofIndex, floorObjects, setFocus, update, get count() { return order.length; } };
}

function accentColor(projectId) {
  return pick(COLORS.roof, hash(projectId) >>> 4);
}

// Shell shared by every storey: slab, inner floor, back and left walls, elevator core, glass front.
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
  const right = mesh(new THREE.BoxGeometry(0.2, wallH, D), wallMaterial);
  right.position.set(W / 2 - 0.1, SLAB + wallH / 2, 0);
  const e = FURNITURE.elevator;
  const core = box(e.w, wallH, e.d, "#dcd6cd");
  core.position.set(e.x, SLAB + wallH / 2, e.z);
  const door = box(0.9, 1.9, 0.05, "#b4bcc6");
  door.position.set(e.x, SLAB + 0.95, e.z + e.d / 2 + 0.03);
  const doorLine = box(0.03, 1.9, 0.06, "#8a939e");
  doorLine.position.copy(door.position);
  g.add(slab, inner, back, left, right, core, door, doorLine);

  const front = mesh(new THREE.BoxGeometry(W, wallH, 0.04), GLASS, { shadow: false, receive: false });
  front.position.set(0, SLAB + wallH / 2, D / 2);
  front.renderOrder = 2;
  g.add(front);
  for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) {
    const post = box(0.12, wallH, 0.12, FRAME);
    post.position.set(x, SLAB + wallH / 2, D / 2);
    g.add(post);
  }
  return flat(g);
}

function buildFloor(project, desks) {
  const accent = new THREE.Color(accentColor(project.id));
  const wallMat = new THREE.MeshStandardMaterial({ color: accent.clone().lerp(new THREE.Color("#ffffff"), 0.62), emissive: "#ffd9a0", emissiveIntensity: 0, flatShading: true, roughness: 0.9 });
  const g = buildShell(H, wallMat);

  // A stripe in the project's colour along the back wall, so floors are easy to tell apart.
  const stripe = box(W - 0.4, 0.14, 0.05, `#${accent.getHexString()}`);
  stripe.position.set(0, SLAB + 0.9, -D / 2 + 0.23);
  g.add(flat(stripe));

  const screens = DESKS.slice(0, desks).map((d) => {
    const screen = screenMaterial();
    const desk = buildDesk(screen);
    desk.position.set(d.x, SLAB, d.z);
    g.add(desk);
    return screen;
  });
  const ledMat = new THREE.MeshBasicMaterial({ color: "#7cf0b0" });
  const place = (object, { x, z }, rotation = 0) => {
    object.position.set(x, SLAB, z);
    object.rotation.y += rotation;
    g.add(object);
    return object;
  };
  place(buildBookshelf(), FURNITURE.bookshelf);
  place(buildServerRack(ledMat), FURNITURE.rack, Math.PI);
  FURNITURE.plants.forEach((spot, i) => place(buildPlant(i + 1), spot));

  const ceilingMat = new THREE.MeshStandardMaterial({ color: "#fff7e6", emissive: "#fff1d0", emissiveIntensity: 0 });
  const ceiling = [-0.3, 2.6].map((x) => {
    const panel = mesh(new THREE.BoxGeometry(2.4, 0.05, 0.8), ceilingMat, { shadow: false, receive: false });
    panel.position.set(x, H - 0.04, 0.5);
    g.add(panel);
    return panel;
  });
  // Light shade over idle floors, like an office with the lights off.
  const dimMat = new THREE.MeshBasicMaterial({ color: "#2b3552", transparent: true, opacity: 0, depthWrite: false });
  const dim = new THREE.Mesh(new THREE.BoxGeometry(W - 0.3, H - SLAB - 0.04, D - 0.3), dimMat);
  dim.position.y = SLAB + (H - SLAB) / 2;
  dim.renderOrder = 1;
  g.add(dim);

  g.traverse((o) => (o.userData.projectId = project.id));

  function setState(status, busyDesks, night, t) {
    const on = status !== "idle";
    wallMat.emissiveIntensity = on ? 0.14 + night * 0.3 : 0;
    ceilingMat.emissiveIntensity = on ? 1 : 0.05;
    screens.forEach((s, i) => (s.emissiveIntensity = busyDesks.has(i) ? 1 : 0));
    ledMat.color.set(on && Math.floor(t * 3) % 2 ? "#7cf0b0" : "#3f8a66");
    dimMat.opacity = on ? 0 : 0.16 + night * 0.4;
  }

  // Seen from above, the ceiling lights and the shade would hide the room.
  function setOpenTop(open) {
    for (const panel of ceiling) panel.visible = !open;
    dim.visible = !open;
  }
  return { group: g, desks, setState, setOpenTop, index: 0 };
}

function buildLobby() {
  const wallMat = new THREE.MeshStandardMaterial({ color: "#f3ece1", flatShading: true, roughness: 0.9 });
  const g = buildShell(LOBBY_H, wallMat);
  const reception = buildReception();
  reception.position.set(1.4, SLAB, -1.6);
  const sofa = buildSofa("#9fbbe0");
  sofa.position.set(-1.6, SLAB, -2.4);
  const p1 = buildPlant(3);
  p1.position.set(4.4, SLAB, -2.6);
  const sign = box(3.2, 0.42, 0.08, "#2f3a4a");
  sign.position.set(1.4, LOBBY_H - 0.45, D / 2 + 0.08);
  g.add(reception, sofa, p1, flat(sign));
  return g;
}

// A quiet lounge on the roof where finished sessions rest.
function buildRoof() {
  const g = new THREE.Group();
  const slab = box(W, SLAB, D, SLAB_COLOR);
  slab.position.y = SLAB / 2;
  const deck = box(W - 0.6, 0.06, D - 0.6, "#dcc3a2");
  deck.position.y = SLAB + 0.03;
  const parapet = box(W, 0.5, 0.15, FRAME);
  parapet.position.set(0, SLAB + 0.25, D / 2 - 0.08);
  g.add(slab, deck, parapet);
  const bar = buildCoffeeBar();
  bar.scale.setScalar(0.8);
  bar.position.set(-3.3, SLAB, -2.2);
  g.add(bar);
  for (const { x, z } of ROOF_CHAIRS) {
    const chair = buildDeckChair();
    chair.position.set(x, SLAB, z);
    g.add(chair);
  }
  const plant = buildPlant(5);
  plant.position.set(4.4, SLAB, -2.2);
  g.add(plant);
  return flat(g);
}

// Plain ground and a few low, pale blocks far behind: context without stealing attention.
function buildCity() {
  const g = new THREE.Group();
  const ground = box(400, 0.2, 200, "#d9e6cf");
  ground.position.set(0, -0.1, -40);
  const sidewalk = box(W + 8, 0.1, D + 6, "#ece5d8");
  sidewalk.position.y = 0.0;
  g.add(ground, sidewalk);
  for (const x of [-7.5, 7.5]) {
    const trunk = box(0.25, 1, 0.25, COLORS.trunk);
    trunk.position.set(x, 0.5, 2);
    const crown = mesh(new THREE.IcosahedronGeometry(0.9, 0), mat(COLORS.leaf));
    crown.position.set(x, 1.6, 2);
    g.add(trunk, crown);
  }
  const palette = ["#e4ddec", "#dfe8ef", "#ede2db", "#e1ebe3"];
  for (let i = 0; i < 14; i++) {
    const h = hash(`block${i}`);
    const width = 5 + (h % 5);
    const height = 4 + ((h >>> 5) % 9);
    const block = box(width, height, 4, palette[i % palette.length]);
    block.position.set(-60 + i * 9 + ((h >>> 9) % 4), height / 2, -30 - ((h >>> 12) % 10));
    g.add(block);
  }
  return flat(g);
}
