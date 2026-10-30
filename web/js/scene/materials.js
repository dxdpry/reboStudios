// Shared flat-shaded pastel materials and small geometry helpers for the low-poly look.
import * as THREE from "three";

export const COLORS = {
  sand: "#f3d9a4",
  sandSide: "#e8c287",
  grass: "#a8dca0",
  grassSide: "#8fcb88",
  path: "#f6e6c3",
  water: "#8fd3ee",
  wood: "#b98a62",
  woodDark: "#8e6648",
  trunk: "#b48a5e",
  leaf: "#7cc46f",
  leafDark: "#5fae5a",
  stone: "#c9c4c0",
  stoneDark: "#a19c99",
  white: "#fbf7f0",
  skin: ["#f6d2b8", "#e8b796", "#c98f6a", "#9b6a4d"],
  hair: ["#4a3a33", "#8a5a3c", "#e6c06a", "#3a3f55", "#c4643f", "#efe6d6"],
  shirt: ["#f29b8f", "#8fb8f2", "#f6c779", "#b8a2ec", "#86d4b4", "#f2a7c7", "#9fb0c2", "#f5ad7c"],
  wall: ["#fde7d7", "#e3f1fb", "#fff3d6", "#efe6fb", "#e0f5ec", "#fbe5ee", "#eef1f4", "#fdebdc"],
  roof: ["#f4a28c", "#8db7ec", "#f2c66d", "#b59ce8", "#7fcfae", "#ef9cbf", "#94a6bb", "#f3a46f"],
  alert: "#ef5a4f",
};

const cache = new Map();

export function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...extra }));
  return cache.get(key);
}

export function mesh(geometry, material, { shadow = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = shadow;
  m.receiveShadow = receive;
  return m;
}

// Geometries are shared by size: a tower of 50 floors repeats the same desks and chairs.
const geometryCache = new Map();
function geometry(key, create) {
  if (!geometryCache.has(key)) geometryCache.set(key, create());
  return geometryCache.get(key);
}

export function box(w, h, d, color, extra) {
  return mesh(geometry(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), mat(color, extra));
}

export function cylinder(rTop, rBottom, h, color, segments = 10, extra) {
  return mesh(geometry(`c${rTop},${rBottom},${h},${segments}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, segments)), mat(color, extra));
}

export function sphere(r, color, detail = 1, extra) {
  return mesh(geometry(`s${r},${detail}`, () => new THREE.IcosahedronGeometry(r, detail)), mat(color, extra));
}

// Interior props: no shadows (keeps a tall tower cheap to render).
export function flat(object) {
  object.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return object;
}

// Flat slab with rounded corners (island layers, paths), top face at y = height.
export function roundedSlab(w, d, radius, height, color, sideColor) {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + w - radius, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + radius);
  shape.lineTo(x + w, y + d - radius);
  shape.quadraticCurveTo(x + w, y + d, x + w - radius, y + d);
  shape.lineTo(x + radius, y + d);
  shape.quadraticCurveTo(x, y + d, x, y + d - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2, curveSegments: 10 });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, height, 0);
  return mesh(geometry, [mat(color), mat(sideColor || color)]);
}

export function pick(list, n) {
  return list[n % list.length];
}

export function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
