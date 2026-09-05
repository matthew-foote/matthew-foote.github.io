import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const PART_INFO = {
  THRUST_CHAMBER_REVA_PARAMETRIC: {
    label: "Thrust chamber",
    desc: "Parametric chamber geometry — primary combustion volume and throat contour for the ethanol / LOX cycle.",
  },
  INJECTOR_BODY_WITH_INTEGRATED_TORCH_REVA: {
    label: "Injector + torch",
    desc: "Injector body with integrated torch igniter path. Core of mixture distribution and light-off.",
  },
  LOX_INLET_ADAPTER_REVA__FINISH_MACHINE_INTERFACE: {
    label: "LOX inlet adapter",
    desc: "Oxidizer feed interface — finish-machine mating surface for LOX service.",
  },
  ETHANOL_FEED_ADAPTER_REVA__FINISH_MACHINE_AND_QUALIFY_JOIN: {
    label: "Ethanol feed adapter",
    desc: "Fuel-side feed adapter with qualified join surfaces for ethanol service.",
  },
  LOX_SERVICE_FLANGE_REVA__FINISH_MACHINE_AND_QUALIFY_JOIN: {
    label: "LOX service flange",
    desc: "Service flange for LOX plumbing and ground support connections.",
  },
  LOX_SERVICE_MATE_REVA__FINISH_MACHINE_VALVE_INTERFACE: {
    label: "LOX service mate",
    desc: "Valve-side LOX mating interface — finish-machined for sealing.",
  },
  ETHANOL_SERVICE_MATE_REVA__FINISH_MACHINE_VALVE_INTERFACE: {
    label: "Ethanol service mate",
    desc: "Valve-side ethanol mating interface.",
  },
  GIMBAL_ENGINE_CRADLE_REVA__SEPARATE_MODULE_NOT_LOAD_RATED: {
    label: "Gimbal cradle",
    desc: "Engine cradle module for thrust-vector architecture (separate module; not load-rated in this revision).",
  },
  GIMBAL_FIXED_OUTER_RING_REVA__AIRFRAME_INTERFACE_NOT_RELEASED: {
    label: "Gimbal outer ring",
    desc: "Fixed outer ring — airframe interface envelope (not released).",
  },
  GIMBAL_INTERMEDIATE_CLOSED_RING_REVA__NOT_LOAD_RATED: {
    label: "Gimbal intermediate ring",
    desc: "Intermediate closed ring in the gimbal stack (not load-rated in this revision).",
  },
};

const HOTSPOT_KEYS = [
  "THRUST_CHAMBER_REVA_PARAMETRIC",
  "INJECTOR_BODY_WITH_INTEGRATED_TORCH_REVA",
  "LOX_INLET_ADAPTER_REVA__FINISH_MACHINE_INTERFACE",
  "ETHANOL_FEED_ADAPTER_REVA__FINISH_MACHINE_AND_QUALIFY_JOIN",
  "GIMBAL_ENGINE_CRADLE_REVA__SEPARATE_MODULE_NOT_LOAD_RATED",
  "GIMBAL_FIXED_OUTER_RING_REVA__AIRFRAME_INTERFACE_NOT_RELEASED",
];

/** Only hide construction envelopes — not real parts with "REFERENCE" in the name. */
function isEnvelope(name = "") {
  const n = name.toUpperCase();
  return n.includes("DO_NOT_MANUFACTURE") || n.includes("ENVELOPE") || n.includes("RESERVED");
}

function isGenericMeshName(name = "") {
  return /^mesh\d+(_mesh)?(_\d+)?$/i.test(name) || name === "Root" || name === "RocketPivot";
}

function resolveName(obj) {
  let cur = obj;
  while (cur) {
    const n = (cur.name || "").trim();
    if (n && !isGenericMeshName(n)) return n;
    cur = cur.parent;
  }
  return (obj.name || "").trim();
}

function colorFromMaterial(mat) {
  if (mat?.color) return mat.color.clone();
  const name = mat?.name || "";
  const parts = name.split("_").map(Number).filter((n) => !Number.isNaN(n));
  if (parts.length >= 3) {
    return new THREE.Color(parts[0], parts[1], parts[2]);
  }
  return new THREE.Color(0xb0b8c4);
}

function prettyName(name = "") {
  if (PART_INFO[name]) return PART_INFO[name].label;
  return name
    .replace(/_REVA.*$/i, "")
    .replace(/__/g, " — ")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export class RocketViewer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.root = canvas.parentElement;
    this.onPartSelect = opts.onPartSelect || (() => {});
    this.hotspotLayer = opts.hotspotLayer || null;
    this.mode = "wireframe";
    this.defaultClose = true;
    this.explode = false;
    this.showHotspots = true;
    this.showEnvelopes = false;
    this.autoRotate = true;
    this.modelRoot = null;
    this.meshEntries = [];
    this.hotspotEls = [];
    this.bounds = new THREE.Box3();
    this.center = new THREE.Vector3();
    this.size = new THREE.Vector3();
    this.modelRadius = 1;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.localClippingEnabled = true;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.001, 5000);
    this.camera.position.set(2, 1.2, 2.5);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.7;
    this.controls.target.set(0, 0, 0);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    if ("environmentIntensity" in this.scene) this.scene.environmentIntensity = 0.65;

    const key = new THREE.DirectionalLight(0xfff3e0, 2.4);
    key.position.set(4, 6, 3);
    const rim = new THREE.DirectionalLight(0xc8a57a, 0.9);
    rim.position.set(-4, 2, -3);
    const fill = new THREE.AmbientLight(0xf5efe3, 0.55);
    const hemi = new THREE.HemisphereLight(0xf5efe3, 0x4a524a, 0.7);
    this.scene.add(key, rim, fill, hemi);

    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.MeshStandardMaterial({
        color: 0x0a0e16,
        metalness: 0.6,
        roughness: 0.5,
        transparent: true,
        opacity: 0.45,
      })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);

    // Horizontal clip (slice through the engine)
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

    this._paused = false;
    this._raf = null;
    this.animate = this.animate.bind(this);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.controls.autoRotate = !reduceMotion;
    this.autoRotate = !reduceMotion;

    this.resize();
  }

  resize() {
    const rect = this.root.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    if (w < 1 || h < 1) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  /** Build a reliable opaque material from an Onshape export material. */
  makeBaseMaterial(srcMat) {
    const color = colorFromMaterial(srcMat);
    // Lift very dark colors so metal parts read on a dark stage
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    if (hsl.l < 0.18) color.setHSL(hsl.h, Math.min(hsl.s, 0.25), 0.34);
    if (hsl.l > 0.8) color.setHSL(0.08, 0.08, 0.6);

    return new THREE.MeshStandardMaterial({
      color,
      metalness: 0.55,
      roughness: 0.38,
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      flatShading: false,
    });
  }

  async load(url) {
    this.resize();
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);

    if (this.modelRoot) {
      this.scene.remove(this.modelRoot);
      this.modelRoot.traverse((o) => {
        if (o.isMesh) {
          o.geometry?.dispose?.();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m?.dispose?.());
        }
      });
    }

    this.modelRoot = gltf.scene;
    this.meshEntries = [];
    this.clearHotspots();

    // Normalize hierarchy: ensure every mesh has a usable name + solid material
    this.modelRoot.updateMatrixWorld(true);
    this.modelRoot.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;

      const name = resolveName(obj);
      obj.name = name;

      const srcMats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const bases = srcMats.map((m) => this.makeBaseMaterial(m));
      obj.material = bases.length === 1 ? bases[0] : bases;
      obj.castShadow = false;
      obj.receiveShadow = false;
      obj.frustumCulled = true;

      // Fix potentially inverted / missing normals from CAD export
      if (obj.geometry && !obj.geometry.attributes.normal) {
        obj.geometry.computeVertexNormals();
      }

      this.meshEntries.push({
        mesh: obj,
        name,
        envelope: isEnvelope(name),
        baseMaterials: bases,
        basePosition: obj.position.clone(),
        worldPos: new THREE.Vector3(),
        dir: new THREE.Vector3(0, 1, 0),
      });
    });

    console.info(
      `[viewer] loaded ${this.meshEntries.filter((e) => !e.envelope).length} parts`
    );

    // Hide envelopes for framing
    this.meshEntries.forEach(({ mesh, envelope }) => {
      mesh.visible = !envelope;
    });

    // Frame: center → unit-ish size → camera pullback
    this.modelRoot.updateMatrixWorld(true);
    this.bounds.setFromObject(this.modelRoot);
    if (this.bounds.isEmpty()) {
      // Fallback: show everything including envelopes
      this.meshEntries.forEach(({ mesh }) => {
        mesh.visible = true;
      });
      this.modelRoot.updateMatrixWorld(true);
      this.bounds.setFromObject(this.modelRoot);
    }

    this.bounds.getCenter(this.center);
    this.bounds.getSize(this.size);

    // Re-parent offset so model sits at origin
    this.modelRoot.position.set(0, 0, 0);
    this.modelRoot.scale.set(1, 1, 1);
    this.modelRoot.rotation.set(0, 0, 0);
    this.modelRoot.updateMatrixWorld(true);

    // Wrap in a pivot for clean centering/scaling
    const pivot = new THREE.Group();
    pivot.name = "RocketPivot";
    // Move geometry so AABB center → origin
    this.modelRoot.position.copy(this.center).multiplyScalar(-1);
    pivot.add(this.modelRoot);

    const maxDim = Math.max(this.size.x, this.size.y, this.size.z, 1e-6);
    const targetSize = 2.2;
    const fit = targetSize / maxDim;
    pivot.scale.setScalar(fit);

    this.scene.add(pivot);
    this.modelRoot = pivot;
    this.modelRoot.updateMatrixWorld(true);

    const fitted = new THREE.Box3().setFromObject(this.modelRoot);
    fitted.getCenter(this.center);
    fitted.getSize(this.size);
    const sphere = fitted.getBoundingSphere(new THREE.Sphere());
    this.modelRadius = Math.max(sphere.radius, 0.5);

    this.ground.visible = false;

    this.frameCamera({ close: this.defaultClose });

    // Rest poses for explode (after transform)
    this.meshEntries.forEach((e) => {
      e.basePosition = e.mesh.position.clone();
      e.mesh.getWorldPosition(e.worldPos);
      e.dir.copy(e.worldPos).sub(sphere.center);
      if (e.dir.lengthSq() < 1e-8) e.dir.set(0, 1, 0);
      else e.dir.normalize();
    });

    this.applyMode();
    this.buildHotspots();
    this.setSlice(0.5);
    this.resize();

    return this;
  }

  setMode(mode) {
    this.mode = mode;
    this.applyMode();
    if (mode === "slice") this.setSlice(this._sliceT ?? 0.5);
  }

  materialForMode(base, envelope) {
    const m = base.clone();
    m.side = THREE.DoubleSide;
    m.clippingPlanes = this.mode === "slice" ? [this.clipPlane] : [];
    m.clipShadows = true;
    m.needsUpdate = true;

    if (this.mode === "wireframe") {
      m.wireframe = true;
      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
      m.color = new THREE.Color(0x2e5b3c);
      m.emissive = new THREE.Color(0x1f3f2a);
      m.emissiveIntensity = 0.35;
      m.metalness = 0.15;
      m.roughness = 0.55;
    } else if (this.mode === "xray") {
      m.wireframe = false;
      m.transparent = true;
      m.opacity = envelope ? 0.1 : 0.22;
      m.depthWrite = false;
      m.color = new THREE.Color(envelope ? 0xa5824f : 0x4a524a);
      m.emissive = new THREE.Color(0x2e5b3c);
      m.emissiveIntensity = 0.25;
      m.metalness = 0.05;
      m.roughness = 0.3;
    } else {
      // solid + slice share opaque look
      m.wireframe = false;
      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
      m.emissiveIntensity = 0.05;
    }
    return m;
  }

  applyMode() {
    this.meshEntries.forEach(({ mesh, baseMaterials, envelope, name }) => {
      const showEnvelope = this.showEnvelopes || this.mode === "xray";
      if (envelope && !showEnvelope) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;

      const mats = baseMaterials.map((b) => this.materialForMode(b, envelope));

      // Emphasize chamber / injector in x-ray
      if (this.mode === "xray" && (name.includes("THRUST_CHAMBER") || name.includes("INJECTOR"))) {
        mats.forEach((m) => {
          m.opacity = 0.55;
          m.color = new THREE.Color(0x2e5b3c);
          m.emissive = new THREE.Color(0x1f3f2a);
        });
      }

      mesh.material = mats.length === 1 ? mats[0] : mats;
    });
  }

  setExplode(on) {
    this.explode = on;
    const amount = on ? this.modelRadius * 0.55 : 0;
    this.meshEntries.forEach((e) => {
      e.mesh.position.copy(e.basePosition).addScaledVector(e.dir, amount);
    });
  }

  setAutoRotate(on) {
    this.autoRotate = on;
    this.controls.autoRotate = on;
  }

  setHotspots(on) {
    this.showHotspots = on;
    this.hotspotEls.forEach((el) => {
      el.style.display = on ? "" : "none";
    });
  }

  setEnvelopes(on) {
    this.showEnvelopes = on;
    this.applyMode();
  }

  setSlice(t) {
    this._sliceT = t;
    // t ∈ [0,1] — move a world-space horizontal clip through the model
    const y = THREE.MathUtils.lerp(this.modelRadius * 1.05, -this.modelRadius * 1.05, t);
    this.clipPlane.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, y, 0)
    );

    // Re-apply so every material picks up the updated plane reference
    if (this.mode === "slice") this.applyMode();

  }

  clearHotspots() {
    this.hotspotEls.forEach((el) => el.remove());
    this.hotspotEls = [];
  }

  buildHotspots() {
    const layer = this.hotspotLayer || document.getElementById("hotspot-layer");
    if (!layer) return;
    this.clearHotspots();

    HOTSPOT_KEYS.forEach((key) => {
      const entry = this.meshEntries.find(
        (e) => e.name === key || e.name.startsWith(key.split("__")[0])
      );
      if (!entry) return;
      const info = PART_INFO[key] || { label: prettyName(key), desc: "" };
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hotspot";
      btn.innerHTML = `<span class="dot"></span><span class="tag">${info.label}</span>`;
      btn.addEventListener("click", () => this.onPartSelect({ name: key, ...info }));
      layer.appendChild(btn);
      this.hotspotEls.push(btn);
      entry.hotspotEl = btn;
    });
  }

  updateHotspotPositions() {
    if (!this.showHotspots || !this.hotspotEls.length) return;
    const rect = this.root.getBoundingClientRect();
    this.meshEntries.forEach((e) => {
      if (!e.hotspotEl) return;
      const v = e.mesh.getWorldPosition(new THREE.Vector3());
      v.project(this.camera);
      const x = (v.x * 0.5 + 0.5) * rect.width;
      const y = (-v.y * 0.5 + 0.5) * rect.height;
      const behind = v.z > 1 || v.z < -1;
      e.hotspotEl.style.left = `${x}px`;
      e.hotspotEl.style.top = `${y}px`;
      e.hotspotEl.style.opacity = behind ? "0" : "1";
      e.hotspotEl.style.pointerEvents = behind ? "none" : "auto";
    });
  }

  /** Frame camera — close wireframe hero by default */
  frameCamera({ close = true } = {}) {
    if (!this.modelRoot) return;
    const fitted = new THREE.Box3().setFromObject(this.modelRoot);
    const sphere = fitted.getBoundingSphere(new THREE.Sphere());
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const zoom = close ? 0.58 : 0.9;
    const dist = (sphere.radius / Math.sin(fov / 2)) * zoom;

    // Bias target toward chamber / injector (upper stack)
    const target = sphere.center.clone();
    target.y += sphere.radius * (close ? 0.12 : 0);

    this.controls.target.copy(target);
    this.camera.near = Math.max(dist / 200, 0.01);
    this.camera.far = dist * 40;
    this.camera.position.set(
      target.x + dist * (close ? 0.42 : 0.75),
      target.y + dist * (close ? 0.08 : 0.35),
      target.z + dist * (close ? 0.52 : 0.95)
    );
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = this.modelRadius * 0.25;
    this.controls.maxDistance = this.modelRadius * 12;
    this.controls.update();
  }

  /** Reset camera to default framed view */
  resetCamera() {
    this.frameCamera({ close: this.defaultClose });
  }

  start() {
    this._paused = false;
    if (this._raf) return;
    this.animate();
  }

  pause() {
    this._paused = true;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }

  resume() {
    if (!this._paused) return;
    this._paused = false;
    this.start();
  }

  animate() {
    if (this._paused) return;
    this._raf = requestAnimationFrame(this.animate);
    this.controls.update();
    this.updateHotspotPositions();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.pause();
    this.renderer.dispose();
  }
}
