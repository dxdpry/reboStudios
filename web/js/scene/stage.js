// Renderer, camera, controls and lighting (with day/night). The camera looks at the tower from the
// front-right; the mouse wheel (or a one-finger drag) moves up and down the tower.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const VIEW_SIZE = 19; // world units visible vertically at zoom 1 (about six floors)
const POLAR = 1.2; // a little above the floors, so desks are visible
const AZIMUTH = 0.55; // from the front, towards the glass side
const DISTANCE = 60;
const PANEL_WIDTH_PX = 320;
const SCROLL_SPEED = 0.012;

export function createStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#e9d9cf", 110, 220); // only the far skyline fades
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const target = new THREE.Vector3(0, 6, 0);
  const offset = new THREE.Vector3().setFromSphericalCoords(DISTANCE, POLAR, AZIMUTH);
  camera.position.copy(target).add(offset);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.enableZoom = false; // the wheel scrolls the tower instead (ctrl + wheel zooms)
  controls.screenSpacePanning = true;
  controls.minPolarAngle = POLAR - 0.25;
  controls.maxPolarAngle = POLAR + 0.15;
  controls.minAzimuthAngle = AZIMUTH - 0.6;
  controls.maxAzimuthAngle = AZIMUTH + 0.5;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.update();

  let minY = 2;
  let maxY = 20;
  function setScrollRange(bottom, top) {
    minY = bottom;
    maxY = Math.max(bottom, top);
  }

  // Only vertical movement: keep the target on the tower's axis.
  function clampTarget() {
    const dy = THREE.MathUtils.clamp(controls.target.y, minY, maxY) - controls.target.y;
    const dx = -controls.target.x;
    const dz = -controls.target.z;
    controls.target.add(new THREE.Vector3(dx, dy, dz));
    camera.position.add(new THREE.Vector3(dx, dy, dz));
  }

  renderer.domElement.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) {
        camera.zoom = THREE.MathUtils.clamp(camera.zoom * (ev.deltaY > 0 ? 0.9 : 1.1), 0.5, 2.5);
        camera.updateProjectionMatrix();
        return;
      }
      focus = null;
      const dy = (-ev.deltaY * SCROLL_SPEED * VIEW_SIZE) / 15 / camera.zoom;
      controls.target.y += dy;
      camera.position.y += dy;
      clampTarget();
    },
    { passive: false }
  );

  const hemi = new THREE.HemisphereLight("#f2f7ff", "#e8d6c0", 1.7);
  const sun = new THREE.DirectionalLight("#fff0dc", 2.2);
  sun.position.set(30, 50, 40);
  const moon = new THREE.DirectionalLight("#8fa8ff", 0);
  moon.position.set(-20, 40, 20);
  scene.add(hemi, sun, moon);

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h, false);
    const aspect = w / Math.max(h, 1);
    const size = aspect < 1 ? VIEW_SIZE * 1.6 : VIEW_SIZE;
    // On wide screens the session panel covers the right side; the floor directory the left.
    const shift = w > 760 ? (((PANEL_WIDTH_PX - 280) / 2) / w) * size * aspect : 0;
    camera.left = (-size * aspect) / 2 + shift;
    camera.right = (size * aspect) / 2 + shift;
    camera.top = size / 2;
    camera.bottom = -size / 2;
    camera.updateProjectionMatrix();
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

  // Smoothly moves the view to a height (selection, directory, "recenter").
  let focus = null;
  function focusOnY(y) {
    focus = THREE.MathUtils.clamp(y, minY, maxY);
  }

  function render() {
    if (focus !== null) {
      const dy = (focus - controls.target.y) * 0.14;
      controls.target.y += dy;
      camera.position.y += dy;
      if (Math.abs(dy) < 0.002) focus = null;
    }
    controls.update();
    clampTarget();
    renderer.render(scene, camera);
  }

  return { renderer, scene, camera, controls, render, setNight, focusOnY, setScrollRange, get viewHeight() { return VIEW_SIZE / camera.zoom; } };
}
