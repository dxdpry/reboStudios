// Island geometry and where everything stands, in world units (x right, z towards the camera, y up).

export const ISLAND = { minX: -13, maxX: 13, minZ: -10, maxZ: 10, radius: 3.5, top: 0.8, bottom: -1.2 };
export const GRASS = { minX: -11.5, maxX: 11.5, minZ: -8.5, maxZ: 6.2, radius: 2.5, top: 1.1 };
export const WATER_Y = 0.35;
export const DOCK = { x: 3.5, fromZ: 9, toZ: 15.5, halfWidth: 0.8, top: 0.95 };

export const LANDMARKS = {
  library: { x: -7.5, z: -5.2 },
  workshop: { x: 6.8, z: -5.2 },
  lighthouse: { x: 10.2, z: 4.2 },
  hammock: { x: -7.5, z: 8.2 },
};

// Building plots for projects (the house's center; doors face +z).
export const PLOTS = [
  { x: -2.6, z: -5.8 },
  { x: 1.9, z: -5.8 },
  { x: -5.2, z: -0.6 },
  { x: -0.6, z: -0.8 },
  { x: 3.9, z: -0.6 },
  { x: 8, z: -0.4 },
  { x: -3.6, z: 4 },
  { x: 1.2, z: 4 },
];

const SPOTS = {
  library: { x: -7.5, z: -3.2 },
  workshop: { x: 6, z: -3.3 },
  lighthouse: { x: 8.8, z: 5.4 },
  beach: { x: -5.8, z: 8.4 },
  dock: { x: 3.5, z: 10.6 },
  boat: { x: 3.5, z: 17 },
};

const SLOT_OFFSETS = [
  [0, 0], [0.9, 0.1], [-0.9, 0.1], [0.4, 0.9], [-0.5, 0.9], [1.3, 0.9], [-1.4, 0.9], [0, 1.7],
];

function slotOffset(i) {
  const [x, z] = SLOT_OFFSETS[i % SLOT_OFFSETS.length];
  const ring = Math.floor(i / SLOT_OFFSETS.length);
  return { x: x + ring * 0.45, z: z + ring * 0.45 };
}

// Where a colonist stands for a place. `plot` is its project's plot (for "site" and "door").
export function spotFor(place, plot, slot) {
  const off = slotOffset(slot);
  if (place === "site" && plot) return { x: plot.x + 1.75 + off.z * 0.4, z: plot.z + 0.2 + off.x };
  if (place === "door" || !SPOTS[place]) {
    const base = plot ? { x: plot.x, z: plot.z + 1.9 } : SPOTS.dock;
    return { x: base.x + off.x, z: base.z + off.z * 0.6 };
  }
  return { x: SPOTS[place].x + off.x, z: SPOTS[place].z + off.z };
}

export function insideRoundedRect(x, z, r) {
  if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) return false;
  const cx = Math.min(Math.max(x, r.minX + r.radius), r.maxX - r.radius);
  const cz = Math.min(Math.max(z, r.minZ + r.radius), r.maxZ - r.radius);
  return (x - cx) ** 2 + (z - cz) ** 2 <= r.radius ** 2;
}

export function groundHeight(x, z) {
  if (insideRoundedRect(x, z, GRASS)) return GRASS.top;
  if (Math.abs(x - DOCK.x) <= DOCK.halfWidth && z >= DOCK.fromZ && z <= DOCK.toZ) return DOCK.top;
  if (insideRoundedRect(x, z, ISLAND)) return ISLAND.top;
  return WATER_Y;
}
