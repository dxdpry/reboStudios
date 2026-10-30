// Low-poly builders for everything on the island. Each returns a THREE.Group with its origin on the ground.
import * as THREE from "three";
import { COLORS, mat, mesh, box, cylinder, sphere } from "./materials.js";

const WINDOW_OFF = "#9fc3d9";
const WINDOW_ON = "#ffd98a";

function windowMaterial() {
  return new THREE.MeshStandardMaterial({ color: WINDOW_OFF, emissive: WINDOW_ON, emissiveIntensity: 0, flatShading: true, roughness: 0.4 });
}

// Triangular prism roof; the ridge runs along z, gables face the front and back.
function gableRoof(width, height, depth, color) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.translate(0, 0, -depth / 2);
  return mesh(geometry, mat(color));
}

// Project houses grow with the hours Claude spent on the project:
// 0 = hut, 1 = cottage, 2 = two-storey house, 3 = manor with a side wing and a tower.
const HOUSE_TIERS = [
  { w: 1.6, d: 1.5, floorH: 1.1, floors: 1, roofH: 0.9 },
  { w: 2.2, d: 2, floorH: 1.5, floors: 1, roofH: 1.15 },
  { w: 2.4, d: 2.1, floorH: 1.2, floors: 2, roofH: 1.2 },
  { w: 2.6, d: 2.2, floorH: 1.2, floors: 2, roofH: 1.3, wing: true, tower: true },
];

export function houseHeight(tier) {
  const t = HOUSE_TIERS[tier];
  return t.floorH * t.floors + t.roofH + (t.tower ? 1.2 : 0);
}

export function buildHouse(wallColor, roofColor, tier = 1) {
  const t = HOUSE_TIERS[Math.max(0, Math.min(HOUSE_TIERS.length - 1, tier))];
  const g = new THREE.Group();
  const bodyH = t.floorH * t.floors;
  const body = box(t.w, bodyH, t.d, wallColor);
  body.position.y = bodyH / 2;
  const roof = gableRoof(t.w + 0.5, t.roofH, t.d + 0.4, roofColor);
  roof.position.y = bodyH;
  const door = box(0.5, 0.8, 0.08, COLORS.woodDark);
  door.position.set(0, 0.4, t.d / 2 + 0.02);
  const step = box(0.9, 0.12, 0.4, COLORS.stone);
  step.position.set(0, 0.06, t.d / 2 + 0.2);
  g.add(body, roof, door, step);

  const windowMat = windowMaterial();
  const addWindow = (x, y, z, sideways) => {
    const w = mesh(sideways ? new THREE.BoxGeometry(0.08, 0.38, 0.46) : new THREE.BoxGeometry(0.38, 0.38, 0.08), windowMat, { shadow: false });
    w.position.set(x, y, z);
    g.add(w);
  };
  const columns = t.w > 2 ? [-0.7, 0.7] : [-0.5, 0.5];
  for (let floor = 0; floor < t.floors; floor++) {
    const y = floor * t.floorH + t.floorH * 0.62;
    for (const x of columns) if (floor > 0 || Math.abs(x) > 0.4) addWindow(x, y, t.d / 2 + 0.02);
    addWindow(t.w / 2 + 0.02, y, 0, true);
  }
  if (t.floors > 1) {
    const ledge = box(t.w + 0.12, 0.1, t.d + 0.12, COLORS.white);
    ledge.position.y = t.floorH;
    g.add(ledge);
  }

  const chimney = box(0.32, 0.8, 0.32, COLORS.stone);
  chimney.position.set(t.w * 0.25, bodyH + t.roofH * 0.6, -t.d * 0.2);
  g.add(chimney);
  const chimneyTop = new THREE.Vector3(chimney.position.x, chimney.position.y + 0.45, chimney.position.z);

  if (t.wing) {
    const wing = box(1.4, t.floorH, 1.6, wallColor);
    wing.position.set(-t.w / 2 - 0.65, t.floorH / 2, -0.2);
    const wingRoof = gableRoof(1.8, 0.8, 1.9, roofColor);
    wingRoof.rotation.y = Math.PI / 2;
    wingRoof.position.set(-t.w / 2 - 0.65, t.floorH, -0.2);
    g.add(wing, wingRoof);
    addWindow(-t.w / 2 - 0.65, t.floorH * 0.6, 0.62);
  }
  if (t.tower) {
    const towerH = bodyH + 1.2;
    const tower = cylinder(0.45, 0.5, towerH, wallColor, 8);
    tower.position.set(t.w / 2 - 0.1, towerH / 2, t.d / 2 - 0.1);
    const cap = mesh(new THREE.ConeGeometry(0.62, 0.9, 8), mat(roofColor));
    cap.position.set(t.w / 2 - 0.1, towerH + 0.45, t.d / 2 - 0.1);
    const pole = cylinder(0.02, 0.02, 0.5, COLORS.woodDark, 4);
    pole.position.set(t.w / 2 - 0.1, towerH + 1.1, t.d / 2 - 0.1);
    const pennant = box(0.32, 0.18, 0.02, roofColor);
    pennant.position.set(t.w / 2 + 0.07, towerH + 1.25, t.d / 2 - 0.1);
    g.add(tower, cap, pole, pennant);
  }

  // Chimney smoke while a session is working in the project.
  const smoke = [];
  for (let i = 0; i < 3; i++) {
    const puff = sphere(0.18, "#ffffff", 1, { transparent: true, opacity: 0 });
    puff.material = puff.material.clone(); // each puff fades on its own
    puff.castShadow = false;
    g.add(puff);
    smoke.push(puff);
  }
  function update(time, running) {
    smoke.forEach((puff, i) => {
      const phase = (time * 0.5 + i / smoke.length) % 1;
      puff.visible = running;
      puff.position.set(chimneyTop.x + Math.sin(phase * 4 + i) * 0.12, chimneyTop.y + phase * 1.6, chimneyTop.z);
      puff.scale.setScalar(0.6 + phase * 1.2);
      puff.material.opacity = 0.8 * (1 - phase);
    });
  }
  return { group: g, setLit: (amount) => (windowMat.emissiveIntensity = amount), update };
}

export function buildLibrary() {
  const g = new THREE.Group();
  const body = box(3, 2.2, 2.4, "#d9946b");
  body.position.y = 1.1;
  const trim = box(3.3, 0.25, 2.7, "#c47c55");
  trim.position.y = 2.3;
  const roof = box(2.8, 0.35, 2.2, "#b96d48");
  roof.position.y = 2.6;
  // Bookshelf facade: rows of colored book spines behind glass.
  const shelf = box(2.2, 1.3, 0.1, "#8a5a3c");
  shelf.position.set(0, 1.25, 1.22);
  g.add(body, trim, roof, shelf);
  const spineColors = ["#f29b8f", "#8fb8f2", "#f6c779", "#86d4b4", "#b8a2ec", "#fbf7f0"];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 9; i++) {
      const spine = box(0.16, 0.3, 0.06, spineColors[(i + row * 2) % spineColors.length], { roughness: 0.6 });
      spine.castShadow = false;
      spine.position.set(-0.95 + i * 0.24, 0.8 + row * 0.42, 1.29);
      g.add(spine);
    }
  }
  const steps = box(1.2, 0.2, 0.5, COLORS.stone);
  steps.position.set(0, 0.1, 1.5);
  const sign = box(1.4, 0.35, 0.08, COLORS.white);
  sign.position.set(0, 2.05, 1.24);
  g.add(steps, sign);
  return { group: g };
}

export function buildWorkshop() {
  const g = new THREE.Group();
  const body = box(3.2, 1.6, 2.6, "#cdb8ef");
  body.position.y = 0.8;
  const roof = gableRoof(3.7, 1, 3, "#9d84d6");
  roof.rotation.y = Math.PI / 2;
  roof.position.y = 1.6;
  const chimney = box(0.6, 1.6, 0.6, COLORS.stoneDark);
  chimney.position.set(0.9, 2.3, -0.5);
  const opening = box(1.3, 0.9, 0.1, "#4b3a52");
  opening.position.set(-0.5, 0.55, 1.31);
  const glowMat = new THREE.MeshStandardMaterial({ color: "#ff9a4d", emissive: "#ff7a2c", emissiveIntensity: 0.4, flatShading: true });
  const glow = mesh(new THREE.BoxGeometry(0.9, 0.45, 0.12), glowMat, { shadow: false });
  glow.position.set(-0.5, 0.35, 1.33);
  const anvil = new THREE.Group();
  const anvilTop = box(0.6, 0.18, 0.28, "#6f7984");
  anvilTop.position.y = 0.52;
  const anvilBase = box(0.3, 0.45, 0.24, "#59626c");
  anvilBase.position.y = 0.22;
  anvil.add(anvilTop, anvilBase);
  anvil.position.set(0.9, 0, 1.8);
  const barrel = cylinder(0.28, 0.28, 0.6, COLORS.wood, 10);
  barrel.position.set(-1.9, 0.3, 1.1);
  g.add(body, roof, chimney, opening, glow, anvil, barrel);

  const smoke = [];
  for (let i = 0; i < 4; i++) {
    const puff = sphere(0.28, "#ffffff", 1, { transparent: true, opacity: 0.85 });
    puff.material = puff.material.clone(); // each puff fades on its own
    puff.castShadow = false;
    g.add(puff);
    smoke.push(puff);
  }
  function update(t, busy) {
    glowMat.emissiveIntensity = busy ? 1.2 + Math.sin(t * 9) * 0.25 : 0.35;
    smoke.forEach((puff, i) => {
      const phase = (t * (busy ? 0.45 : 0.25) + i / smoke.length) % 1;
      puff.position.set(0.9 + Math.sin(phase * 5 + i) * 0.2, 3.2 + phase * 2.2, -0.5);
      puff.scale.setScalar(0.6 + phase * 1.1);
      puff.material.opacity = 0.85 * (1 - phase);
    });
  }
  return { group: g, update };
}

export function buildLighthouse() {
  const g = new THREE.Group();
  const base = cylinder(1.1, 1.25, 0.5, COLORS.stone, 12);
  base.position.y = 0.25;
  g.add(base);
  const stripes = ["#fbf7f0", "#f4a28c", "#fbf7f0", "#f4a28c"];
  stripes.forEach((color, i) => {
    const r0 = 0.95 - i * 0.08;
    const seg = cylinder(r0 - 0.08, r0, 0.8, color, 14);
    seg.position.y = 0.9 + i * 0.8;
    g.add(seg);
  });
  const gallery = cylinder(0.95, 0.95, 0.12, COLORS.white, 14);
  gallery.position.y = 4.15;
  const lampMat = new THREE.MeshStandardMaterial({ color: "#fff3c4", emissive: "#ffd56b", emissiveIntensity: 0.6, flatShading: true, transparent: true, opacity: 0.95 });
  const lamp = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.7, 10), lampMat, { shadow: false });
  lamp.position.y = 4.55;
  const cap = mesh(new THREE.ConeGeometry(0.75, 0.75, 12), mat("#ef8f7a"));
  cap.position.y = 5.28;
  const door = box(0.4, 0.65, 0.1, COLORS.woodDark);
  door.position.set(0, 0.8, 0.98);
  g.add(gallery, lamp, cap, door);

  const beamMat = new THREE.MeshBasicMaterial({ color: "#fff2b0", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(2.2, 14, 16, 1, true), beamMat);
  beam.rotation.z = Math.PI / 2;
  beam.position.x = 7;
  const beamPivot = new THREE.Group();
  beamPivot.position.y = 4.55;
  beamPivot.add(beam);
  g.add(beamPivot);
  function update(t, night) {
    lampMat.emissiveIntensity = 0.5 + night * 1.5;
    beamMat.opacity = 0.16 * night;
    beamPivot.rotation.y = t * 0.6;
  }
  return { group: g, update };
}

export function buildDock(length) {
  const g = new THREE.Group();
  const planks = Math.round(length / 0.5);
  for (let i = 0; i < planks; i++) {
    const plank = box(1.6, 0.12, 0.44, i % 2 ? COLORS.wood : "#c49670");
    plank.position.set(0, 0, i * 0.5);
    g.add(plank);
  }
  for (let i = 0; i <= length; i += 2) {
    for (const side of [-0.85, 0.85]) {
      const post = cylinder(0.11, 0.11, 1.3, COLORS.woodDark, 6);
      post.position.set(side, -0.45, i);
      g.add(post);
    }
  }
  return { group: g };
}

export function buildBoat() {
  const g = new THREE.Group();
  const hull = box(1.1, 0.4, 2.2, "#f4a28c");
  hull.position.y = 0.2;
  const rim = box(1.2, 0.1, 2.3, COLORS.white);
  rim.position.y = 0.42;
  const mast = cylinder(0.05, 0.05, 1.8, COLORS.woodDark, 6);
  mast.position.y = 1.3;
  const sail = mesh(new THREE.ConeGeometry(0.7, 1.5, 3), mat(COLORS.white));
  sail.scale.z = 0.1;
  sail.position.set(0.25, 1.4, 0);
  g.add(hull, rim, mast, sail);
  return { group: g };
}

export function buildPalm(seed = 0) {
  const g = new THREE.Group();
  const lean = 0.08 + (seed % 5) * 0.03;
  let x = 0;
  for (let i = 0; i < 6; i++) {
    const seg = cylinder(0.13 - i * 0.008, 0.16 - i * 0.008, 0.5, i % 2 ? COLORS.trunk : "#c49a6c", 7);
    x += lean * i * 0.25;
    seg.position.set(x, 0.25 + i * 0.47, 0);
    g.add(seg);
  }
  const top = new THREE.Vector3(x, 2.95, 0);
  for (let i = 0; i < 7; i++) {
    const leaf = mesh(new THREE.ConeGeometry(0.22, 1.3, 4), mat(i % 2 ? COLORS.leaf : COLORS.leafDark));
    leaf.scale.set(1, 1, 0.3);
    const pivot = new THREE.Group();
    pivot.position.copy(top);
    pivot.rotation.y = (i / 7) * Math.PI * 2 + seed;
    leaf.position.set(0, -0.1, 0.55);
    leaf.rotation.x = Math.PI / 2 + 0.35;
    pivot.add(leaf);
    g.add(pivot);
  }
  for (let i = 0; i < 3; i++) {
    const nut = sphere(0.11, "#8a6a3c", 0);
    nut.position.set(top.x + Math.cos(i * 2.1) * 0.15, top.y - 0.12, Math.sin(i * 2.1) * 0.15);
    g.add(nut);
  }
  return { group: g };
}

export function buildHammock() {
  const g = new THREE.Group();
  for (const side of [-1.3, 1.3]) {
    const post = cylinder(0.08, 0.1, 1.4, COLORS.woodDark, 6);
    post.position.set(side, 0.7, 0);
    g.add(post);
  }
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const piece = box(0.26, 0.06, 0.8, i % 2 ? "#f29b8f" : "#fbf7f0");
    piece.position.set(-1.25 + t * 2.5, 1.05 - Math.sin(t * Math.PI) * 0.45, 0);
    piece.rotation.z = Math.cos(t * Math.PI) * 0.5;
    g.add(piece);
  }
  return { group: g, bed: new THREE.Vector3(0, 0.7, 0) };
}

export function buildRock(seed) {
  const r = 0.25 + (seed % 4) * 0.12;
  const rock = sphere(r, seed % 2 ? COLORS.stone : COLORS.stoneDark, 0);
  rock.scale.y = 0.6;
  rock.rotation.y = seed;
  return { group: rock };
}

export function buildFlower(seed) {
  const g = new THREE.Group();
  const stem = cylinder(0.02, 0.02, 0.25, COLORS.leafDark, 4);
  stem.position.y = 0.12;
  const petals = sphere(0.09, ["#f29b8f", "#f6c779", "#fbf7f0", "#b8a2ec"][seed % 4], 0);
  petals.position.y = 0.27;
  g.add(stem, petals);
  return { group: g };
}

export function buildBush(seed) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const s = sphere(0.32 + (i % 2) * 0.1, i % 2 ? COLORS.leaf : COLORS.leafDark, 0);
    s.position.set((i - 1) * 0.35, 0.25, ((seed + i) % 3) * 0.1);
    g.add(s);
  }
  return { group: g };
}
