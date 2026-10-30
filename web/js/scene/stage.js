// Renderer, isometric camera, controls and lighting (with day/night).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const VIEW_SIZE = 24; // world units visible vertically at zoom 1
const ISO_POLAR = Math.atan(Math.SQRT2); // classic isometric tilt
const HOME_TARGET = new THREE.Vector3(0, 0.8, 1.5);
const PANEL_WIDTH_PX = 320;

export function createStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  camera.position.set(30, 30, 30).add(HOME_TARGET);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = ISO_POLAR - 0.25;
  controls.maxPolarAngle = ISO_POLAR + 0.1;
  controls.minZoom = 0.6;
  controls.maxZoom = 3.2;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.update();

  const hemi = new THREE.HemisphereLight("#eaf6ff", "#f3dcb4", 1.6);
  const sun = new THREE.DirectionalLight("#fff4e0", 2.4);
  sun.position.set(-14, 26, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -20;
  sun.shadow.camera.right = 20;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -20;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 4;
  const moon = new THREE.DirectionalLight("#8fa8ff", 0);
  moon.position.set(12, 20, -8);
  scene.add(hemi, sun, moon);

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h, false);
    const aspect = w / Math.max(h, 1);
    // Narrow screens see the whole island width instead of its height.
    const size = aspect < 1.4 ? (VIEW_SIZE * 1.36) / aspect : VIEW_SIZE;
    // On wide screens the session panel covers the right side, so centre the island in what is left.
    const shift = w > 760 ? (PANEL_WIDTH_PX / 2 / w) * size * aspect : 0;
    camera.left = (-size * aspect) / 2 + shift;
    camera.right = (size * aspect) / 2 + shift;
    camera.top = size / 2;
    camera.bottom = -size / 2;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  function setNight(night) {
    hemi.intensity = 1.6 - night * 1.15;
    hemi.color.set(night > 0.5 ? "#9fb2ff" : "#eaf6ff");
    sun.intensity = 2.4 * (1 - night);
    moon.intensity = 0.9 * night;
    document.documentElement.style.setProperty("--night", night.toFixed(3));
    document.documentElement.dataset.daylight = night > 0.5 ? "night" : "day";
  }

  // Smoothly re-centres the view on a world point (selection, "recenter" button).
  let focus = null;
  function focusOn(point) {
    focus = point ? point.clone() : HOME_TARGET.clone();
  }

  function render() {
    if (focus) {
      const delta = focus.clone().sub(controls.target).multiplyScalar(0.12);
      controls.target.add(delta);
      camera.position.add(delta);
      if (delta.lengthSq() < 1e-5) focus = null;
    }
    controls.update();
    renderer.render(scene, camera);
  }

  return { renderer, scene, camera, controls, render, setNight, focusOn };
}
