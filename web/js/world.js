// Island layout in world pixels (the canvas is drawn at WORLD_W x WORLD_H and scaled up).
export const WORLD_W = 320;
export const WORLD_H = 180;
export const ISLAND = { cx: 160, cy: 92, rx: 136, ry: 70 };

export const LANDMARKS = {
  library: { x: 58, y: 72 },
  workshop: { x: 262, y: 72 },
  lighthouse: { x: 286, y: 112 },
  beach: { x: 62, y: 134 },
  dock: { x: 160, y: 158 },
};

// Where a colonist stands when using each landmark (relative to the landmark anchor).
const LANDMARK_SPOTS = {
  library: { dx: 0, dy: 6 },
  workshop: { dx: -4, dy: 6 },
  lighthouse: { dx: -12, dy: 4 },
  beach: { dx: 6, dy: 2 },
  dock: { dx: 0, dy: 4 },
  boat: { dx: 0, dy: 18 },
};

// Building plots for projects, most recently active first.
export const PLOTS = [
  { x: 128, y: 58 },
  { x: 192, y: 58 },
  { x: 106, y: 100 },
  { x: 214, y: 100 },
  { x: 160, y: 40 },
  { x: 160, y: 122 },
  { x: 98, y: 136 },
  { x: 224, y: 136 },
];

export const PALETTE = {
  deep: "#245f9e",
  water: "#2f7fc1",
  shallow: "#4fa7d8",
  foam: "#cdeffa",
  sand: "#efd79c",
  sandDark: "#dcbd78",
  grass: "#6cbf4a",
  grassDark: "#58a63c",
  outline: "#2a2233",
  wood: "#8a5a3b",
  woodDark: "#6b4229",
  stone: "#9aa3ad",
  stoneDark: "#6f7984",
  white: "#f6f3ea",
  red: "#e04a3f",
  skin: ["#f2c7a0", "#d9a37a", "#a8714f", "#7a4d33"],
  hair: ["#3b2a20", "#7a4b2a", "#e0b04a", "#2b2b3a", "#b8452d", "#efe6d0"],
  shirt: ["#e9594d", "#3f8fd8", "#f2b33d", "#7a5bd6", "#3fb58a", "#e86fa4", "#4b5a6b", "#f07a2c"],
  roof: ["#d0503f", "#3d78c9", "#e0a236", "#7d56c4", "#2f9e78", "#cf5f95", "#566373", "#e8792e"],
};

export function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Spot for a session given its place, the plot of its project and its index among colonists at that spot.
export function spotFor(place, plot, slot) {
  const offset = { dx: (slot % 4) * 7 - 10, dy: Math.floor(slot / 4) * 6 };
  if (place === "site" && plot) return { x: plot.x + 15 + offset.dx / 2, y: plot.y + 3 + offset.dy };
  if (place === "door" || !LANDMARK_SPOTS[place]) {
    const base = plot || LANDMARKS.dock;
    return { x: base.x + offset.dx, y: base.y + 8 + offset.dy };
  }
  const anchor = place === "boat" ? LANDMARKS.dock : LANDMARKS[place];
  const spot = LANDMARK_SPOTS[place];
  return { x: anchor.x + spot.dx + offset.dx, y: anchor.y + spot.dy + offset.dy };
}

// Pre-renders the static terrain (water, foam, sand, grass) into an offscreen canvas.
export function renderTerrain() {
  const canvas = document.createElement("canvas");
  canvas.width = WORLD_W;
  canvas.height = WORLD_H;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(WORLD_W, WORLD_H);
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const nx = (x - ISLAND.cx) / ISLAND.rx;
      const ny = (y - ISLAND.cy) / ISLAND.ry;
      const d = Math.sqrt(nx * nx + ny * ny) + 0.035 * Math.sin(x * 0.13) + 0.03 * Math.cos(y * 0.21 + x * 0.04);
      const checker = (hash(`${x >> 1},${y >> 1}`) & 7) === 0;
      let color;
      if (d < 0.8) color = checker ? PALETTE.grassDark : PALETTE.grass;
      else if (d < 0.97) color = checker ? PALETTE.sandDark : PALETTE.sand;
      else if (d < 1.01) color = PALETTE.foam;
      else if (d < 1.12) color = PALETTE.shallow;
      else color = checker && d > 1.3 ? PALETTE.deep : PALETTE.water;
      const i = (y * WORLD_W + x) * 4;
      img.data[i] = parseInt(color.slice(1, 3), 16);
      img.data[i + 1] = parseInt(color.slice(3, 5), 16);
      img.data[i + 2] = parseInt(color.slice(5, 7), 16);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export const PALMS = [
  { x: 40, y: 122 },
  { x: 84, y: 128 },
  { x: 244, y: 40 },
  { x: 72, y: 40 },
  { x: 268, y: 140 },
];
