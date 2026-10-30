// Assembles the static island (terrain, water, landmarks, vegetation) and the project houses.
import * as THREE from "three";
import { COLORS, roundedSlab, mat, mesh, hash, pick } from "./materials.js";
import { ISLAND, GRASS, WATER_Y, DOCK, LANDMARKS, PLOTS, groundHeight, insideRoundedRect } from "./layout.js";
import { buildHouse, buildLibrary, buildWorkshop, buildLighthouse, buildDock, buildPalm, buildHammock, buildRock, buildFlower, buildBush } from "./props.js";

const PALMS = [
  [-11.2, -6.5], [-10.5, 2.5], [-9.6, 7.6], [-5.5, 9.3], [10.8, -6.8], [11.4, 1.2], [8.2, 8.6], [-1.2, 8.9], [4.8, -8.6], [-4.8, -8.4],
];
const BUSHES = [[-9.5, -2.8], [9.6, -2.6], [-1.6, 6], [5.5, 5.4], [-8.4, 4.5]];
const ROCKS = [[-12.4, -8.4], [12.6, 7.6], [-12.8, 3.6], [12.2, -4.2], [6.6, 9.6], [-3, 9.8], [0.6, 9.9]];

export function buildIsland(scene) {
  const root = new THREE.Group();
  scene.add(root);

  const sand = roundedSlab(ISLAND.maxX - ISLAND.minX, ISLAND.maxZ - ISLAND.minZ, ISLAND.radius, ISLAND.top - ISLAND.bottom, COLORS.sand, COLORS.sandSide);
  sand.position.y = ISLAND.bottom;
  const grass = roundedSlab(GRASS.maxX - GRASS.minX, GRASS.maxZ - GRASS.minZ, GRASS.radius, GRASS.top - ISLAND.top, COLORS.grass, COLORS.grassSide);
  grass.position.set((GRASS.minX + GRASS.maxX) / 2, ISLAND.top, (GRASS.minZ + GRASS.maxZ) / 2);
  root.add(sand, grass);

  addPaths(root);
  const water = addWater(root);

  const library = buildLibrary();
  place(library.group, LANDMARKS.library);
  const workshop = buildWorkshop();
  place(workshop.group, LANDMARKS.workshop);
  const lighthouse = buildLighthouse();
  place(lighthouse.group, LANDMARKS.lighthouse);
  const hammock = buildHammock();
  place(hammock.group, LANDMARKS.hammock);
  const dock = buildDock(DOCK.toZ - DOCK.fromZ);
  dock.group.position.set(DOCK.x, DOCK.top - 0.06, DOCK.fromZ);
  root.add(library.group, workshop.group, lighthouse.group, hammock.group, dock.group);

  PALMS.forEach(([x, z], i) => {
    const palm = buildPalm(i);
    place(palm.group, { x, z });
    root.add(palm.group);
  });
  BUSHES.forEach(([x, z], i) => root.add(place(buildBush(i).group, { x, z })));
  ROCKS.forEach(([x, z], i) => root.add(place(buildRock(i).group, { x, z })));
  scatterFlowers(root);

  const houses = new Map();

  // Keeps one house per assigned plot; rebuilt only when a plot changes project.
  function syncHouses(plotByProject) {
    for (const [plotIndex, house] of houses) {
      const entry = [...plotByProject.values()].find((p) => p.index === plotIndex);
      if (!entry || entry.project.id !== house.projectId) {
        root.remove(house.group);
        houses.delete(plotIndex);
      }
    }
    for (const plot of plotByProject.values()) {
      if (houses.has(plot.index)) continue;
      const h = hash(plot.project.id);
      const house = buildHouse(pick(COLORS.wall, h), pick(COLORS.roof, h >>> 4));
      place(house.group, plot);
      root.add(house.group);
      houses.set(plot.index, { ...house, projectId: plot.project.id });
    }
  }

  function update(t, { night, workshopBusy, litProjects }) {
    workshop.update(t, workshopBusy);
    lighthouse.update(t, night);
    for (const house of houses.values()) house.setLit(litProjects.has(house.projectId) ? 0.6 + night * 0.9 : night * 0.25);
    water.material.uniforms.uTime.value = t;
    water.material.uniforms.uNight.value = night;
  }

  return { syncHouses, update, hammockBed: hammock.bed.clone().add(new THREE.Vector3(LANDMARKS.hammock.x, ISLAND.top, LANDMARKS.hammock.z)) };
}

function place(object, { x, z }) {
  object.position.set(x, groundHeight(x, z), z);
  return object;
}

function addPaths(root) {
  const pathMat = mat(COLORS.path);
  const strips = [
    { x: 0, z: 1.9, w: 21, d: 1.1 },
    { x: DOCK.x, z: 4.2, w: 1.1, d: 4.6 },
    { x: -7.5, z: -1, w: 1, d: 3.4 },
    { x: 6, z: -1, w: 1, d: 3.4 },
  ];
  for (const s of strips) {
    const strip = mesh(new THREE.BoxGeometry(s.w, 0.04, s.d), pathMat, { shadow: false });
    strip.position.set(s.x, GRASS.top + 0.02, s.z);
    root.add(strip);
  }
  for (let i = 0; i < 9; i++) {
    const stone = mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.05, 7), mat(COLORS.path), { shadow: false });
    stone.position.set(DOCK.x + Math.sin(i) * 0.2, ISLAND.top + 0.03, 6.6 + i * 0.3);
    if (i < 8) root.add(stone);
  }
}

// Soft animated water: a big plane with a gentle vertex wave and lighter shallows near the island.
function addWater(root) {
  const geometry = new THREE.PlaneGeometry(140, 140, 70, 70);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime: { value: 0 }, uDeep: { value: new THREE.Color("#7cc6ea") }, uShallow: { value: new THREE.Color("#c8eefa") }, uNight: { value: 0 } },
    vertexShader: `
      uniform float uTime;
      varying vec2 vPos;
      void main() {
        vec3 p = position;
        p.y += sin(p.x * 0.35 + uTime * 0.9) * 0.05 + cos(p.z * 0.3 + uTime * 0.7) * 0.05;
        vPos = p.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform float uTime;
      uniform float uNight;
      varying vec2 vPos;
      void main() {
        vec2 q = vec2(max(abs(vPos.x) - 9.0, 0.0), max(abs(vPos.y) - 6.0, 0.0));
        float d = length(q);
        float shore = smoothstep(7.5, 3.0, d);
        float sparkle = step(0.985, sin(vPos.x * 2.1 + uTime) * sin(vPos.y * 1.7 - uTime * 0.8));
        vec3 color = mix(uDeep, uShallow, shore) + sparkle * 0.15;
        color = mix(color, color * vec3(0.32, 0.38, 0.6), uNight);
        float fade = smoothstep(60.0, 30.0, length(vPos));
        gl_FragColor = vec4(color, 0.92 * fade);
        #include <colorspace_fragment>
      }`,
  });
  const water = new THREE.Mesh(geometry, material);
  water.position.y = WATER_Y;
  water.receiveShadow = false;
  root.add(water);
  return water;
}

function scatterFlowers(root) {
  let placed = 0;
  for (let i = 0; placed < 40 && i < 400; i++) {
    const h = hash(`flower${i}`);
    const x = GRASS.minX + ((h % 1000) / 1000) * (GRASS.maxX - GRASS.minX);
    const z = GRASS.minZ + (((h >>> 10) % 1000) / 1000) * (GRASS.maxZ - GRASS.minZ);
    if (!insideRoundedRect(x, z, { ...GRASS, minX: GRASS.minX + 0.4, maxX: GRASS.maxX - 0.4, minZ: GRASS.minZ + 0.4, maxZ: GRASS.maxZ - 0.4 })) continue;
    if (Math.abs(z - 1.9) < 0.8) continue;
    if (PLOTS.some((p) => Math.abs(p.x - x) < 2 && Math.abs(p.z - z) < 2.2)) continue;
    if (Object.values(LANDMARKS).some((p) => Math.abs(p.x - x) < 2.4 && Math.abs(p.z - z) < 2.4)) continue;
    root.add(place(buildFlower(h).group, { x, z }));
    placed++;
  }
}
