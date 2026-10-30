// Tower dimensions and where things stand on a floor (floor-local x/z; x right, z towards the camera).
import { tierFor } from "./tiers.js";

export const TOWER = { w: 10, d: 6.5, lobbyH: 3.2, floorH: 2.8, slab: 0.22 };
// Projects with less work than this (and nobody on them now) go to the archive instead of a floor.
export const ARCHIVE_BELOW_MS = 30 * 60 * 1000;

// Desk centres, in the order they appear as a project grows (1, 2, 4, 6 desks).
export const DESKS = [
  { x: 0.0, z: -0.5 },
  { x: 2.1, z: -0.5 },
  { x: 0.0, z: 1.7 },
  { x: 2.1, z: 1.7 },
  { x: 4.2, z: -0.5 },
  { x: -2.1, z: 1.7 },
];
const DESKS_BY_TIER = [1, 2, 4, 6];

export function deskCount(project) {
  return DESKS_BY_TIER[tierFor(project)];
}

export const FURNITURE = {
  elevator: { x: -4.1, z: -2.5, w: 1.8, d: 1.5 },
  bookshelf: { x: -1.6, z: -3.0 },
  whiteboard: { x: 3.4, z: -3.05 },
  rack: { x: -4.55, z: 0.7 },
  telescope: { x: 4.4, z: 2.5 },
  plants: [{ x: 4.6, z: -2.8 }, { x: -4.4, z: 2.7 }],
};

export const ELEVATOR_SPOT = { x: -4.1, z: -1.2 };
export const ROOF_CHAIRS = [
  { x: 0.4, z: 1.3 },
  { x: 1.6, z: 1.3 },
  { x: 2.8, z: 1.3 },
  { x: 0.4, z: -0.7 },
  { x: 1.6, z: -0.7 },
];

const SPOTS = {
  library: { x: -1.6, z: -2.3, facing: Math.PI },
  workshop: { x: -3.8, z: 0.7, facing: -Math.PI / 2 },
  lighthouse: { x: 3.8, z: 2.0, facing: Math.PI / 4 },
  dock: { x: ELEVATOR_SPOT.x + 0.6, z: ELEVATOR_SPOT.z + 0.2, facing: 0.6 },
  door: { x: 3.4, z: -2.3, facing: Math.PI },
};

const NUDGES = [[0, 0], [0.7, 0], [-0.7, 0], [0.35, 0.6], [-0.35, 0.6], [1.05, 0.6]];
function nudge(slot) {
  const [x, z] = NUDGES[slot % NUDGES.length];
  return { x, z };
}

// Base height of a floor: 0 is the lobby, 1..N are project floors, N + 1 is the roof.
export function floorBaseY(index) {
  return index === 0 ? 0 : TOWER.lobbyH + (index - 1) * TOWER.floorH;
}

export function floorTopY(index) {
  return floorBaseY(index) + TOWER.slab;
}

// Spot for a person: { floor, x, z, facing, seated?, reclined?, leaving? }.
export function spotFor(place, floor, roofFloor, slot, desks) {
  if (place === "beach") {
    const chair = ROOF_CHAIRS[slot];
    if (chair) return { floor: roofFloor, x: chair.x, z: chair.z + 0.1, facing: 0, reclined: true };
    return { floor: roofFloor, x: -2 + (slot % 4) * 0.7, z: -1.2, facing: Math.PI };
  }
  if (place === "boat") return { floor: 0, x: 1 + (slot % 3) * 0.6, z: TOWER.d / 2 + 2.5, facing: 0, leaving: true };
  if (!floor) return { floor: 0, x: -1 + (slot % 5) * 0.7, z: 1.2, facing: 0 };
  if (place === "site") {
    const desk = DESKS[slot % desks];
    if (slot < desks) return { floor, x: desk.x, z: desk.z - 0.8, facing: 0, seated: true };
    return { floor, x: desk.x + 0.9, z: desk.z - 0.9, facing: -0.5 };
  }
  const base = SPOTS[place] || SPOTS.door;
  const off = nudge(slot);
  return { floor, x: base.x + off.x, z: base.z + off.z, facing: base.facing };
}
