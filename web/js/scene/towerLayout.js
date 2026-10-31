// Tower dimensions and where things stand on a floor (floor-local x/z; x right, z towards the camera).

export const TOWER = { w: 10, d: 6.5, lobbyH: 3, floorH: 2.8, slab: 0.22 };
export const MAX_DESKS = 6;

// One desk per agent the manager may run at once (its team setting): back row, then front row.
export const DESKS = [
  { x: -1.4, z: -0.7 },
  { x: 0.9, z: -0.7 },
  { x: 3.2, z: -0.7 },
  { x: -1.4, z: 1.7 },
  { x: 0.9, z: 1.7 },
  { x: 3.2, z: 1.7 },
];

export function deskCount(team) {
  return Math.max(1, Math.min(MAX_DESKS, (team && team.maxAgents) || 1));
}

// The manager's corner, front left: a desk facing the room with the manager's chair behind it.
export const MANAGER = { desk: { x: -3.55, z: 1.9 }, seat: { x: -3.55, z: 1.1 } };

export const FURNITURE = {
  elevator: { x: -4.1, z: -2.5, w: 1.8, d: 1.5 },
  bookshelf: { x: -1.3, z: -3.0 },
  rack: { x: 4.5, z: -2.2 },
  plants: [{ x: 4.6, z: 2.8 }, { x: -2.9, z: -2.9 }],
};

export const ELEVATOR_SPOT = { x: -4.1, z: -1.2 };
export const ROOF_CHAIRS = [
  { x: -1.2, z: 0.6 },
  { x: 0.2, z: 0.6 },
  { x: 1.6, z: 0.6 },
  { x: 3.0, z: 0.6 },
];

// Tool places on a floor: shelf (reading), server rack (commands), window (web), elevator (helpers).
const SPOTS = {
  library: { x: -1.3, z: -2.3, facing: Math.PI },
  workshop: { x: 3.9, z: -2.2, facing: Math.PI / 2 },
  lighthouse: { x: 4.2, z: 2.6, facing: Math.PI / 4 },
  dock: { x: ELEVATOR_SPOT.x + 0.6, z: ELEVATOR_SPOT.z + 0.2, facing: 0.6 },
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
// desk: the index of the agent's desk on the floor.
export function spotFor(place, floor, roofFloor, slot, desk) {
  if (place === "beach") {
    const chair = ROOF_CHAIRS[slot];
    if (chair) return { floor: roofFloor, x: chair.x, z: chair.z + 0.1, facing: 0, reclined: true };
    return { floor: roofFloor, x: -3 + (slot % 4) * 0.7, z: -1.2, facing: Math.PI };
  }
  if (place === "boat") return { floor: 0, x: 1 + (slot % 3) * 0.6, z: TOWER.d / 2 + 2.5, facing: 0, leaving: true };
  if (!floor) return { floor: 0, x: -1 + (slot % 5) * 0.7, z: 1.2, facing: 0 };
  if (place === "manager") return { floor, x: MANAGER.seat.x, z: MANAGER.seat.z, facing: 0, seated: true };
  // An agent at work sits at its desk.
  if (place === "desk" || place === "site" || place === "door" || !SPOTS[place]) {
    const d = DESKS[desk % DESKS.length];
    return { floor, x: d.x, z: d.z - 0.8, facing: 0, seated: true };
  }
  const base = SPOTS[place];
  const off = nudge(slot);
  return { floor, x: base.x + off.x, z: base.z + off.z, facing: base.facing };
}
