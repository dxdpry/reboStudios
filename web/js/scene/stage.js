// Renderer, camera and lighting (with day/night). Two camera modes:
//  - building: the tower seen straight from the side; wheel or drag scrolls up and down;
//  - floor: the camera swings above one floor and looks down at it.
// Transitions are eased over a fixed time.
import * as THREE from "three";

const DISTANCE = 80;
const SIDE_POLAR = Math.PI / 2;
const TOP_POLAR = 0.02; // straight down (a hair off, so "up" stays defined)
const TRANSITION_S = 0.9;
const MIN_VIEW = 12;
const FLOOR_MARGIN = 1.2;
const DRAG_THRESHOLD_PX = 4;

export function createStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#e9d9cf", 110, 260);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);

  // Current and wanted camera parameters; the wanted ones are reached with an eased transition.
  const view = { x: 0, y: 6, z: 0, polar: SIDE_POLAR, size: 30 };
  let from = { ...view };
  let to = { ...view };
  let progress = 1;
  let zoom = 1;
  let range = { min: 0, max: 20 };
  let mode = "building";

  // Builds on the current destination, so two quick calls (rotate, then scroll) combine.
  function animateTo(next) {
    from = { ...view };
    to = { ...to, ...next };
    progress = 0;
  }

  // Building view: `size` world units tall, scrolling between range.min and range.max.
  function showBuilding({ size, min, max, y }) {
    mode = "building";
    range = { min, max: Math.max(min, max) };
    animateTo({ x: 0, z: 0, polar: SIDE_POLAR, size, y: THREE.MathUtils.clamp(y ?? to.y, range.min, range.max) });
  }

  // free: { left, right } in pixels, the part of the screen not covered by side panels; the floor
  // is fitted and centred there.
  function showFloor({ y, width, depth, free }) {
    mode = "floor";
    const w = canvas.clientWidth;
    const h = Math.max(canvas.clientHeight, 1);
    const left = free ? free.left : 0;
    const right = free ? free.right : w;
    const freeWidth = Math.max(right - left, w * 0.3);
    const size = Math.max(depth + FLOOR_MARGIN * 2, ((width + FLOOR_MARGIN * 2) * h) / freeWidth);
    const x = ((w / 2 - (left + right) / 2) * size) / h;
    animateTo({ x, z: 0, y, polar: TOP_POLAR, size });
  }

  function scrollTo(y) {
    if (mode !== "building") return;
    animateTo({ y: THREE.MathUtils.clamp(y, range.min, range.max) });
  }

  function scrollBy(dy) {
    if (mode !== "building") return;
    const y = THREE.MathUtils.clamp((progress < 1 ? to.y : view.y) + dy, range.min, range.max);
    to = { ...to, y };
    if (progress >= 1) view.y = y;
  }

  canvas.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) {
        zoom = THREE.MathUtils.clamp(zoom * (ev.deltaY > 0 ? 0.9 : 1.1), 0.6, 3);
        return;
      }
      scrollBy((-ev.deltaY / canvas.clientHeight) * view.size * 0.6 / zoom);
    },
    { passive: false }
  );

  // Dragging scrolls too (mouse and touch). A short press is left to the click handler.
  let drag = null;
  canvas.addEventListener("pointerdown", (ev) => (drag = { y: ev.clientY, moved: false }));
  window.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const dy = ev.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    drag.y = ev.clientY;
    scrollBy((dy / canvas.clientHeight) * view.size / zoom);
  });
  window.addEventListener("pointerup", () => (drag = null));

  const hemi = new THREE.HemisphereLight("#f2f7ff", "#e8d6c0", 1.7);
  const sun = new THREE.DirectionalLight("#fff0dc", 2.2);
  sun.position.set(20, 50, 60);
  const moon = new THREE.DirectionalLight("#8fa8ff", 0);
  moon.position.set(-20, 40, 40);
  scene.add(hemi, sun, moon);

  function resize() {
    renderer.setSize(container.clientWidth, container.clientHeight, false);
  }
  new ResizeObserver(resize).observe(container);
  resize();

  function setNight(night) {
    hemi.intensity = 1.7 - night * 1.25;
    hemi.color.set(night > 0.5 ? "#9fb2ff" : "#f2f7ff");
    sun.intensity = 2.2 * (1 - night);
    moon.intensity = 0.8 * night;
    scene.fog.color.set(night > 0.5 ? "#1b2747" : "#e9d9cf");
    document.documentElement.style.setProperty("--night", night.toFixed(3));
    document.documentElement.dataset.daylight = night > 0.5 ? "night" : "day";
  }

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function render(dt) {
    if (progress < 1) {
      progress = Math.min(1, progress + dt / TRANSITION_S);
      const k = ease(progress);
      for (const key of Object.keys(view)) view[key] = from[key] + (to[key] - from[key]) * k;
    }
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    const size = Math.max(MIN_VIEW, view.size) / zoom;
    camera.left = (-size * aspect) / 2;
    camera.right = (size * aspect) / 2;
    camera.top = size / 2;
    camera.bottom = -size / 2;
    camera.updateProjectionMatrix();
    const target = new THREE.Vector3(view.x, view.y, view.z);
    camera.position.copy(target).add(new THREE.Vector3().setFromSphericalCoords(DISTANCE, view.polar, 0));
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    renderer.render(scene, camera);
  }

  return {
    renderer,
    scene,
    camera,
    render,
    setNight,
    showBuilding,
    showFloor,
    scrollTo,
    get mode() {
      return mode;
    },
    get y() {
      return view.y;
    },
    wasDrag() {
      return !!(drag && drag.moved);
    },
  };
}
