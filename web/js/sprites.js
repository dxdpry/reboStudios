// Procedural pixel-art sprites. Every function draws in world pixels, anchored at the bottom center (feet / ground line).
import { PALETTE as P, hash } from "./world.js";

function rect(ctx, color, x, y, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

export function drawShadow(ctx, x, y, w) {
  ctx.fillStyle = "rgba(20, 30, 40, 0.22)";
  ctx.fillRect(Math.round(x - w / 2), Math.round(y), w, 2);
}

export function drawPalm(ctx, x, y, t) {
  const sway = Math.round(Math.sin(t * 1.3 + x) * 1);
  drawShadow(ctx, x + 2, y, 10);
  for (let i = 0; i < 14; i++) rect(ctx, i % 3 === 0 ? P.woodDark : P.wood, x + Math.round(i * 0.15) + (i > 10 ? sway : 0), y - i - 1, 2, 1);
  const top = { x: x + 2 + sway, y: y - 15 };
  const leaf = "#3f9a3a";
  const leafLight = "#5dbb4a";
  rect(ctx, leaf, top.x - 7, top.y, 6, 2);
  rect(ctx, leaf, top.x + 1, top.y, 6, 2);
  rect(ctx, leafLight, top.x - 5, top.y - 2, 10, 2);
  rect(ctx, leaf, top.x - 8, top.y + 2, 2, 2);
  rect(ctx, leaf, top.x + 6, top.y + 2, 2, 2);
  rect(ctx, leafLight, top.x - 1, top.y - 4, 2, 2);
  rect(ctx, "#7a5a2a", top.x - 1, top.y + 1, 2, 2);
}

// Project building. `lit` lights the window, `busy` adds scaffolding dust.
export function drawHouse(ctx, x, y, roofColor, lit, t) {
  const w = 24;
  const left = x - w / 2;
  drawShadow(ctx, x + 2, y, w + 4);
  rect(ctx, P.outline, left - 1, y - 13, w + 2, 13);
  rect(ctx, P.wood, left, y - 12, w, 12);
  for (let i = 0; i < 3; i++) rect(ctx, P.woodDark, left, y - 10 + i * 4, w, 1);
  rect(ctx, P.outline, x - 3, y - 8, 6, 8);
  rect(ctx, P.woodDark, x - 2, y - 7, 4, 7);
  rect(ctx, P.outline, left + 3, y - 9, 5, 5);
  rect(ctx, lit ? "#ffd75e" : "#5d7b94", left + 4, y - 8, 3, 3);
  rect(ctx, P.outline, left + w - 8, y - 9, 5, 5);
  rect(ctx, lit ? "#ffd75e" : "#5d7b94", left + w - 7, y - 8, 3, 3);
  for (let row = 0; row < 8; row++) {
    const inset = row;
    rect(ctx, row === 0 ? P.outline : roofColor, left - 3 + inset, y - 13 - row, w + 6 - inset * 2, 1);
    if (row > 0) rect(ctx, P.outline, left - 3 + inset, y - 13 - row, 1, 1);
    if (row > 0) rect(ctx, P.outline, left + w + 2 - inset, y - 13 - row, 1, 1);
  }
  rect(ctx, P.outline, left + 6, y - 21, w - 12, 1);
  if (lit) {
    ctx.fillStyle = `rgba(255, 215, 94, ${0.12 + 0.05 * Math.sin(t * 3)})`;
    ctx.fillRect(left + 2, y - 11, 8, 8);
  }
}

export function drawLibrary(ctx, x, y) {
  const w = 30;
  const left = x - w / 2;
  drawShadow(ctx, x + 2, y, w + 4);
  rect(ctx, P.outline, left - 1, y - 17, w + 2, 17);
  rect(ctx, P.stone, left, y - 16, w, 16);
  for (let c = 0; c < 4; c++) rect(ctx, P.white, left + 3 + c * 7, y - 14, 3, 14);
  rect(ctx, P.outline, x - 3, y - 9, 6, 9);
  rect(ctx, "#3a4a6a", x - 2, y - 8, 4, 8);
  rect(ctx, P.outline, left - 3, y - 19, w + 6, 3);
  rect(ctx, "#3d78c9", left - 2, y - 18, w + 4, 1);
  for (let row = 0; row < 5; row++) rect(ctx, row === 4 ? P.outline : "#3d78c9", left + row * 3, y - 20 - row, w - row * 6, 1);
  rect(ctx, "#f2b33d", x - 3, y - 23, 6, 3);
  rect(ctx, P.white, x - 2, y - 22, 4, 1);
}

export function drawWorkshop(ctx, x, y, t, busy) {
  const w = 28;
  const left = x - w / 2;
  drawShadow(ctx, x + 2, y, w + 4);
  rect(ctx, P.outline, left + w - 8, y - 26, 6, 12);
  rect(ctx, P.stoneDark, left + w - 7, y - 25, 4, 11);
  rect(ctx, P.outline, left - 1, y - 14, w + 2, 14);
  rect(ctx, P.stoneDark, left, y - 13, w, 13);
  for (let i = 0; i < 4; i++) rect(ctx, P.stone, left + 1 + i * 7, y - 12 + (i % 2) * 4, 5, 3);
  rect(ctx, P.outline, x - 5, y - 9, 10, 9);
  rect(ctx, busy ? "#f07a2c" : "#4a2a20", x - 4, y - 8, 8, 8);
  if (busy) rect(ctx, "#ffd75e", x - 2, y - 4, 4, 3);
  rect(ctx, P.outline, left - 3, y - 15, w + 6, 2);
  rect(ctx, "#7a3a2a", left - 2, y - 15, w + 4, 1);
  for (let i = 0; i < 3; i++) {
    const phase = (t * 0.6 + i / 3) % 1;
    const alpha = busy ? 0.55 * (1 - phase) : 0.25 * (1 - phase);
    ctx.fillStyle = `rgba(220, 220, 225, ${alpha})`;
    const size = 2 + Math.round(phase * 3);
    ctx.fillRect(Math.round(left + w - 6 + Math.sin(phase * 6 + i) * 2), Math.round(y - 28 - phase * 16), size, size);
  }
  rect(ctx, P.outline, left - 7, y - 4, 7, 4);
  rect(ctx, "#4b5a6b", left - 6, y - 4, 5, 2);
}

export function drawLighthouse(ctx, x, y, t, night) {
  drawShadow(ctx, x + 2, y, 14);
  for (let i = 0; i < 30; i++) {
    const width = 10 - Math.floor(i / 8);
    rect(ctx, P.outline, x - width / 2 - 1, y - i - 1, width + 2, 1);
    rect(ctx, Math.floor(i / 6) % 2 === 0 ? P.white : P.red, x - width / 2, y - i - 1, width, 1);
  }
  rect(ctx, P.outline, x - 5, y - 36, 10, 6);
  rect(ctx, "#ffd75e", x - 4, y - 35, 8, 4);
  rect(ctx, P.red, x - 5, y - 38, 10, 2);
  rect(ctx, P.outline, x - 1, y - 40, 2, 2);
  if (night) {
    const angle = t * 1.2;
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#fff2a8";
    ctx.beginPath();
    ctx.moveTo(x, y - 33);
    ctx.lineTo(x + Math.cos(angle) * 120, y - 33 + Math.sin(angle) * 30 - 6);
    ctx.lineTo(x + Math.cos(angle) * 120, y - 33 + Math.sin(angle) * 30 + 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

export function drawDock(ctx, x, y) {
  rect(ctx, P.outline, x - 6, y - 4, 12, 26);
  for (let i = 0; i < 12; i++) rect(ctx, i % 2 ? P.wood : "#9b6a48", x - 5, y - 3 + i * 2, 10, 2);
  rect(ctx, P.woodDark, x - 7, y + 20, 2, 4);
  rect(ctx, P.woodDark, x + 5, y + 20, 2, 4);
}

export function drawHammock(ctx, x, y) {
  rect(ctx, P.woodDark, x - 9, y - 9, 2, 10);
  rect(ctx, P.woodDark, x + 9, y - 9, 2, 10);
  ctx.fillStyle = "#e9594d";
  for (let i = 0; i <= 16; i++) {
    const sag = Math.round(Math.sin((i / 16) * Math.PI) * 3);
    ctx.fillRect(x - 8 + i, y - 8 + sag, 1, 2);
  }
}

export function drawBoat(ctx, x, y) {
  rect(ctx, P.outline, x - 8, y - 3, 16, 4);
  rect(ctx, "#b8452d", x - 7, y - 3, 14, 3);
  rect(ctx, P.outline, x - 6, y + 1, 12, 1);
  rect(ctx, P.woodDark, x, y - 14, 1, 11);
  rect(ctx, P.white, x + 1, y - 13, 5, 7);
}

export function looksFor(id) {
  const h = hash(id);
  return {
    skin: P.skin[h % P.skin.length],
    hair: P.hair[(h >>> 3) % P.hair.length],
    shirt: P.shirt[(h >>> 7) % P.shirt.length],
  };
}

// Colonist: 7x11 at scale 1, `small` draws a helper at 5x8.
export function drawColonist(ctx, c, t) {
  const { x, y, looks, walking, facing, pose, small } = c;
  const s = small ? 0.75 : 1;
  const step = walking ? Math.floor(t * 8) % 2 : 0;
  const w = Math.round(7 * s);
  const left = Math.round(x - w / 2);
  const top = Math.round(y - 11 * s);
  drawShadow(ctx, x, y - 1, w + 1);

  if (pose === "resting") {
    rect(ctx, P.outline, x - 6, y - 5, 12, 4);
    rect(ctx, looks.shirt, x - 5, y - 4, 6, 2);
    rect(ctx, looks.skin, x + 1, y - 4, 3, 2);
    rect(ctx, looks.hair, x + 3, y - 4, 2, 2);
    const z = (t * 0.7) % 1;
    ctx.fillStyle = `rgba(255,255,255,${1 - z})`;
    ctx.fillRect(Math.round(x + 4 + z * 4), Math.round(y - 8 - z * 8), 2, 1);
    return;
  }

  // Legs
  const legH = Math.round(2 * s) + 1;
  rect(ctx, P.outline, left + 1, top + Math.round(8 * s), w - 2, legH);
  rect(ctx, "#33405a", left + 1 + (step ? 0 : 1), top + Math.round(8 * s), 2, legH - (step ? 1 : 0));
  rect(ctx, "#33405a", left + w - 3 - (step ? 1 : 0), top + Math.round(8 * s), 2, legH - (step ? 0 : 1));
  // Body
  rect(ctx, P.outline, left, top + Math.round(4 * s), w, Math.round(5 * s));
  rect(ctx, looks.shirt, left + 1, top + Math.round(4 * s), w - 2, Math.round(4 * s));
  // Head
  rect(ctx, P.outline, left, top - 1, w, Math.round(6 * s));
  rect(ctx, looks.skin, left + 1, top, w - 2, Math.round(4 * s));
  rect(ctx, looks.hair, left + 1, top - 1, w - 2, 2);
  if (!small) rect(ctx, P.outline, facing > 0 ? left + w - 3 : left + 2, top + 2, 1, 1);

  drawPoseProp(ctx, c, left, top, w, t);
}

function drawPoseProp(ctx, c, left, top, w, t) {
  const hand = c.facing > 0 ? left + w : left - 2;
  switch (c.pose) {
    case "hammer": {
      const up = Math.floor(t * 4 + c.phase) % 2 === 0;
      rect(ctx, P.woodDark, hand, top + (up ? 1 : 4), 1, 4);
      rect(ctx, P.stoneDark, hand - 1, top + (up ? 0 : 3), 3, 2);
      if (!up && c.place === "workshop") rect(ctx, "#ffd75e", hand + c.facing * 2, top + 6, 1, 1);
      break;
    }
    case "reading":
      rect(ctx, P.outline, left + 1, top + 4, w - 2, 4);
      rect(ctx, "#8a3b3b", left + 1, top + 4, w - 2, 3);
      rect(ctx, P.white, left + 2, top + 5, w - 4, 1);
      break;
    case "telescope":
      rect(ctx, P.stoneDark, hand, top + 1, 4 * c.facing, 1);
      rect(ctx, P.outline, hand + 3 * c.facing, top, 1, 3);
      break;
    case "waving": {
      const up = Math.floor(t * 3 + c.phase) % 2 === 0;
      rect(ctx, c.looks.skin, hand, top + (up ? 0 : 2), 1, 3);
      break;
    }
    case "flag": {
      const wave = Math.floor(t * 6) % 2;
      rect(ctx, P.woodDark, left + w, top - 8, 1, 14);
      rect(ctx, P.red, left + w + 1, top - 8, 5, 3 + wave);
      if (Math.floor(t * 3) % 2 === 0) {
        rect(ctx, "#ffd75e", left + 2, top - 9, 2, 4);
        rect(ctx, "#ffd75e", left + 2, top - 4, 2, 1);
      }
      break;
    }
    case "thinking": {
      const dots = 1 + (Math.floor(t * 2.5 + c.phase) % 3);
      rect(ctx, P.white, left + w - 1, top - 7, 9, 5);
      rect(ctx, P.white, left + w - 2, top - 3, 2, 2);
      for (let i = 0; i < dots; i++) rect(ctx, P.outline, left + w + 1 + i * 2, top - 5, 1, 1);
      break;
    }
  }
}
