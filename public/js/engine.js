import { RocketViewer } from "./viewer.js";

const root = document.getElementById("engine-viewer");
if (root) {
  const canvas = root.querySelector("canvas");
  const layer = root.querySelector(".hotspot-layer");
  const loading = root.querySelector(".viewer-loading");
  const panel = document.getElementById("part-panel");
  const partName = document.getElementById("part-name");
  const partDesc = document.getElementById("part-desc");
  const modes = document.querySelectorAll("[data-mode]");
  const sliceWrap = document.getElementById("slice-controls");
  const slice = document.getElementById("slice-slider");
  const explodeBtn = document.getElementById("explode-btn");
  const resetBtn = document.getElementById("reset-view-btn");

  const viewer = new RocketViewer(canvas, {
    hotspotLayer: layer,
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
  document.getElementById("part-close")?.addEventListener("click", () => {
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
      await viewer.load(root.dataset.model);
      viewer.setMode("solid");
      loading.hidden = true;
      viewer.start();
      requestAnimationFrame(() => {
        viewer.resize();
        viewer.frameCamera({ close: false });
      });
    } catch (err) {
      console.error(err);
      loading.textContent = "The model could not load. Open it in Onshape instead.";
    }
  })();
}
