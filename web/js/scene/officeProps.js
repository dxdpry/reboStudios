// Low-poly office furniture and rooftop pieces. Each builder returns a Group with its origin on the floor.
import * as THREE from "three";
import { COLORS, mat, mesh, box, cylinder, sphere, flat } from "./materials.js";

const DESK_TOP = "#dcb38a";
const DESK_LEG = "#9c8468";
const CHAIR = "#b8a2ec";
const SCREEN_OFF = "#3b4252";

// Desk with a monitor facing -z (the person sits behind it, looking at the camera).
// `screen` is the monitor's face material so the floor can switch it on.
export function buildDesk(screenMaterial) {
  const g = new THREE.Group();
  const top = box(1.5, 0.08, 0.8, DESK_TOP);
  top.position.y = 0.78;
  g.add(top);
  for (const [x, z] of [[-0.68, -0.32], [0.68, -0.32], [-0.68, 0.32], [0.68, 0.32]]) {
    const leg = box(0.06, 0.78, 0.06, DESK_LEG);
    leg.position.set(x, 0.39, z);
    g.add(leg);
  }
  const monitorBack = box(0.7, 0.45, 0.05, "#59606e");
  monitorBack.position.set(0, 1.12, 0.05);
  const screen = mesh(new THREE.PlaneGeometry(0.62, 0.38), screenMaterial);
  screen.rotation.y = Math.PI;
  screen.position.set(0, 1.12, 0.02);
  const stand = box(0.06, 0.2, 0.06, "#c3cad3");
  stand.position.set(0, 0.9, 0.08);
  const keyboard = box(0.45, 0.03, 0.15, "#e9edf2");
  keyboard.position.set(0, 0.83, -0.2);
  const mug = cylinder(0.05, 0.05, 0.1, "#f29b8f", 8);
  mug.position.set(0.55, 0.87, 0.1);
  g.add(monitorBack, screen, stand, keyboard, mug);

  const chair = new THREE.Group();
  const seat = box(0.5, 0.08, 0.5, CHAIR);
  seat.position.y = 0.48;
  const back = box(0.5, 0.55, 0.08, CHAIR);
  back.position.set(0, 0.8, -0.24);
  const post = cylinder(0.04, 0.04, 0.42, "#8b93a1", 6);
  post.position.y = 0.24;
  const base = cylinder(0.25, 0.25, 0.04, "#8b93a1", 8);
  base.position.y = 0.03;
  chair.add(seat, back, post, base);
  chair.position.z = -0.8;
  g.add(chair);
  return flat(g);
}

export function screenMaterial() {
  return new THREE.MeshStandardMaterial({ color: SCREEN_OFF, emissive: "#8fd3ff", emissiveIntensity: 0, roughness: 0.4 });
}

export function buildBookshelf() {
  const g = new THREE.Group();
  const frame = box(2, 2.1, 0.4, "#c98f6a");
  frame.position.y = 1.05;
  g.add(frame);
  const colors = ["#f29b8f", "#8fb8f2", "#f6c779", "#86d4b4", "#b8a2ec", "#fbf7f0"];
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 7; i++) {
      const book = box(0.18, 0.34, 0.06, colors[(i + row * 3) % colors.length]);
      book.position.set(-0.72 + i * 0.24, 0.3 + row * 0.48, 0.21);
      g.add(book);
    }
  }
  return flat(g);
}

export function buildServerRack(ledMaterial) {
  const g = new THREE.Group();
  for (const x of [0, 0.75]) {
    const rack = box(0.7, 2, 0.6, "#8c84b8");
    rack.position.set(x, 1, 0);
    g.add(rack);
    for (let i = 0; i < 6; i++) {
      const led = mesh(new THREE.BoxGeometry(0.4, 0.05, 0.02), ledMaterial);
      led.position.set(x, 0.4 + i * 0.27, 0.31);
      g.add(led);
    }
  }
  g.rotation.y = Math.PI / 2;
  return flat(g);
}

export function buildPlant(seed = 0) {
  const g = new THREE.Group();
  const pot = cylinder(0.2, 0.15, 0.35, "#f4f1ea", 8);
  pot.position.y = 0.17;
  g.add(pot);
  for (let i = 0; i < 4; i++) {
    const leaf = sphere(0.22 - i * 0.02, i % 2 ? COLORS.leaf : COLORS.leafDark, 0);
    leaf.position.set(Math.cos(i * 1.7 + seed) * 0.12, 0.5 + i * 0.13, Math.sin(i * 1.7 + seed) * 0.12);
    g.add(leaf);
  }
  return flat(g);
}

export function buildSofa(color = "#b8a2ec") {
  const g = new THREE.Group();
  const seat = box(1.8, 0.4, 0.8, color);
  seat.position.y = 0.3;
  const back = box(1.8, 0.6, 0.2, color);
  back.position.set(0, 0.65, -0.3);
  const armL = box(0.2, 0.55, 0.8, color);
  armL.position.set(-0.9, 0.42, 0);
  const armR = armL.clone();
  armR.position.x = 0.9;
  g.add(seat, back, armL, armR);
  return flat(g);
}

export function buildDeckChair() {
  const g = new THREE.Group();
  const seat = box(0.6, 0.06, 1.3, "#f6c779");
  seat.position.set(0, 0.35, 0);
  seat.rotation.x = -0.12;
  const back = box(0.6, 0.06, 0.7, "#f6c779");
  back.position.set(0, 0.65, -0.75);
  back.rotation.x = -1.0;
  const frame = box(0.66, 0.3, 1.4, COLORS.wood);
  frame.position.y = 0.15;
  g.add(seat, back, frame);
  return flat(g);
}

export function buildCoffeeBar() {
  const g = new THREE.Group();
  const counter = box(2.6, 1.05, 0.7, "#e3c9a8");
  counter.position.y = 0.52;
  const top = box(2.7, 0.08, 0.8, "#f4f1ea");
  top.position.y = 1.08;
  const machine = box(0.45, 0.5, 0.35, "#8b93a1");
  machine.position.set(-0.8, 1.37, 0);
  const cups = [0, 0.2, 0.4].map((x) => {
    const c = cylinder(0.05, 0.05, 0.1, "#ffffff", 8);
    c.position.set(0.3 + x, 1.17, 0.1);
    return c;
  });
  const sign = box(1.4, 0.6, 0.06, "#4a3a33");
  sign.position.set(0, 2.1, -0.4);
  g.add(counter, top, machine, ...cups, sign);
  return flat(g);
}

export function buildReception() {
  const g = new THREE.Group();
  const desk = box(3, 1.1, 0.9, "#f4a28c");
  desk.position.y = 0.55;
  const top = box(3.1, 0.08, 1, "#fbf7f0");
  top.position.y = 1.12;
  const bell = sphere(0.1, "#f6c779", 1);
  bell.position.set(0.9, 1.22, 0.2);
  g.add(desk, top, bell);
  return flat(g);
}

