import { RocketViewer } from "./viewer.js";

// Per-model setup: how to stand it up, and which parts get labels.
// anchor: where on the part the label sits, 0 = bottom, 1 = top. Concentric parts get different heights.
const CONFIGS = {
  "/models/pathfinder.glb": {
    rotation: [0, 0, -Math.PI / 2],
    parts: {
      "PATHFINDER Block A injector": { label: "Injector", anchor: 0.5, desc: "303/304 stainless injector plate. Block A baseline, not yet qualified." },
      "PATHFINDER Block A copper liner": { label: "Copper liner", anchor: 0.15, desc: "C145 copper liner: chamber, throat, and nozzle contour in one piece." },
      "PATHFINDER Block A jacket": { label: "Jacket", anchor: 0.55, desc: "304 stainless jacket around the liner." },
    },
    hotspots: ["PATHFINDER Block A injector", "PATHFINDER Block A copper liner", "PATHFINDER Block A jacket"],
  },
  "/models/engine.glb": { rotation: [-Math.PI / 2, 0, 0] },
};

document.querySelectorAll(".viewer-wrap").forEach((wrap) => {
  const root = wrap.querySelector(".viewer[data-model]");
  if (!root) return;
  const model = root.dataset.model;
  const cfg = CONFIGS[model] || {};
  const canvas = root.querySelector("canvas");
  const layer = root.querySelector(".hotspot-layer");
  const loading = root.querySelector(".viewer-loading");
  const panel = wrap.querySelector(".part-panel");
  const partName = wrap.querySelector(".part-name");
  const partDesc = wrap.querySelector(".part-desc");
  const modes = wrap.querySelectorAll("[data-mode]");
  const sliceWrap = wrap.querySelector(".slice");
  const slice = wrap.querySelector(".slice-slider");
  const explodeBtn = wrap.querySelector(".explode-btn");
  const resetBtn = wrap.querySelector(".reset-view-btn");

  const viewer = new RocketViewer(canvas, {
    hotspotLayer: layer,
    parts: cfg.parts,
    hotspots: cfg.hotspots,
    rotation: cfg.rotation,
    onPartSelect: ({ label, desc }) => {
      panel.hidden = false;
      partName.textContent = label;
      partDesc.textContent = desc;
    },
  });

  modes.forEach((btn) => {
    btn.addEventListener("click", () => {
      modes.forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
      viewer.setMode(btn.dataset.mode);
      sliceWrap.hidden = btn.dataset.mode !== "slice";
    });
  });
  slice?.addEventListener("input", () => viewer.setSlice(Number(slice.value) / 100));
  explodeBtn?.addEventListener("click", () => {
    const on = explodeBtn.getAttribute("aria-pressed") !== "true";
    explodeBtn.setAttribute("aria-pressed", String(on));
    viewer.setExplode(on);
  });
  resetBtn?.addEventListener("click", () => {
    viewer.resetCamera();
    explodeBtn?.setAttribute("aria-pressed", "false");
    viewer.setExplode(false);
  });
  wrap.querySelector(".part-close")?.addEventListener("click", () => {
    panel.hidden = true;
  });

  new IntersectionObserver(
    (entries) => entries.forEach((e) => (e.isIntersecting ? (viewer.resume(), viewer.resize()) : viewer.pause())),
    { threshold: 0.05 }
  ).observe(root);
  new ResizeObserver(() => viewer.resize()).observe(root);

  (async () => {
    try {
      viewer.resize();
      await viewer.load(model);
      viewer.setMode("wireframe");
      loading.hidden = true;
      viewer.start();
      requestAnimationFrame(() => {
        viewer.resize();
        viewer.frameCamera({ close: true });
      });
    } catch (err) {
      console.error(err);
      loading.textContent = "The model could not load. Open it in Onshape instead.";
    }
  })();
});
