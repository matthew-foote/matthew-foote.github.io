import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const $ = (s) => document.querySelector(s);
const fmtG = (g) => g == null ? '–' : (g >= 10 ? Math.round(g).toLocaleString('en-US') : g.toFixed(1)) + ' g';
const fmt$ = (v) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CAT_COLORS = {
  'Printed structure': '#2e5b3c', 'Carbon structure': '#1e241f', 'Printed fairing': '#6f7d62',
  'Printed battery module': '#c8a57a', 'Printed landing gear': '#a5824f', 'Printed hover-test parts': '#8c9a7a',
  'Printed sensor mounts': '#b7b09a', 'Propulsion + gimbal': '#7a4f2b', 'Avionics + power': '#4a6a85',
  'Wiring (lab supply)': '#9c6b6b', 'Hardware': '#9a9384', 'Tether': '#d6c9a8', 'Sensors (later)': '#7d8fa3',
};

const state = { build: 'full', selected: null, isolate: false, explode: 0, data: null, meshes: new Map(), itemById: new Map(), cats: new Set() };

// ---------------------------------------------------------------- data
const data = await fetch('bom.json').then((r) => r.json());
state.data = data;
for (const it of data.items) state.itemById.set(it.id, it);

const inBuild = (it, b = state.build) => it.build === 'both' || it.build === b;
const perGram = (fil) => data.filaments[fil].price / data.filaments[fil].grams;
function itemCost(it) {
  if (it.fil) return (it.mass_g || 0) / Math.max(1, it.instances) * (it.printQty || it.instances) * perGram(it.fil);
  if (['Listed', 'Est.'].includes(it.priceType)) return it.price * it.qty;
  return 0;
}
function buildTotals(b = state.build) {
  let mass = 0, unknown = 0, parts = 0, buy = 0;
  const fils = new Set();
  for (const it of data.items) {
    if (!inBuild(it, b)) continue;
    parts += it.instances || 0;
    if (it.mass_g != null && it.massKnown) mass += it.mass_g; else if (it.instances) unknown++;
    if (it.fil) fils.add(it.fil); else if (['Listed', 'Est.'].includes(it.priceType)) buy += it.price * it.qty;
  }
  if (fils.has('PAHT-CF')) fils.add('Support');
  const filCost = [...fils].reduce((s, f) => s + data.filaments[f].price, 0);
  return { mass, unknown, parts, buy, fils: [...fils], filCost, total: buy + filCost };
}

// ---------------------------------------------------------------- 3D
const host = $('#viewer');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(32, 1, 5, 20000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(600, 900, 700); scene.add(key);
scene.add(new THREE.HemisphereLight(0xfffaf0, 0xd8cdb6, 0.6));

const root = new THREE.Group();
root.rotation.x = -Math.PI / 2; // CAD is Z-up, mm
scene.add(root);

function matFor(it, name) {
  const n = name.toLowerCase();
  const P = (c, rough = 0.6, metal = 0) => ({ c, rough, metal });
  let m;
  if (it.id === 'PROPS') m = P('#2f3033', 0.5);
  else if (it.id === 'BATT' && /lipo/.test(n)) m = P('#1f1f21', 0.5);
  else if (it.fil === 'PAHT-CF') m = P('#2b2d2f', 0.72);
  else if (it.fil === 'ASA') m = P('#1b1c1e', 0.85);
  else if (it.fil === 'PC FR') m = P('#e9e7e1', 0.6);
  else if (it.fil) m = P('#242424', 0.95);
  else if (it.id === 'C1' || it.id === 'C2') m = P('#15171a', 0.32, 0.25);
  else if (/brass/.test(n)) m = P('#b8903f', 0.35, 0.9);
  else if (/black-oxide|black button/.test(n)) m = P('#2a2a2c', 0.45, 0.6);
  else if (/nylon|nylock nylon/.test(n)) m = P('#e6e0d2', 0.7);
  else if (it.cat === 'Hardware' || /screw|washer|nut|dowel|shoulder|stud|set screw|adapter|sleeve|snap/.test(n)) m = P('#a8adb3', 0.35, 0.9);
  else if (/gold|bullet|pads|pins|label \(gold\)/.test(n)) m = P('#c9a24b', 0.35, 0.9);
  else if (/xt60/.test(n)) m = P('#e3bd2d', 0.5);
  else if (/red|\+/.test(n) && /(awg|lead|shrink)/.test(n)) m = P('#b3261e', 0.6);
  else if (/(awg|lead|shrink|cable|coax|boot)/.test(n)) m = P('#26272a', 0.7);
  else if (/jst|connector|housing|plug|socket|spacer|led lens/.test(n)) m = P('#efeee8', 0.6);
  else if (/cage|flange/.test(n)) m = P('#3c4148', 0.4, 0.7);
  else if (/motor|shaft|can/.test(n)) m = P('#8a9097', 0.35, 0.85);
  else if (/prop/.test(n)) m = P('#2f2f31', 0.55);
  else if (it.id === 'SERVO') m = /lead/.test(n) ? P('#6b4a2b', 0.7) : P('#9aa3ad', 0.4, 0.7);
  else if (it.id === 'FC') m = P('#b9bec4', 0.35, 0.75);
  else if (it.id === 'BATT') m = P('#1f1f21', 0.5);
  else if (it.id === 'TETHER') m = P('#e7e1cf', 0.9);
  else if (it.id === 'GNSS') m = /antenna/.test(n) ? P('#232323', 0.6) : P('#e2e2df', 0.5);
  else if (/capacitor/.test(n)) m = P('#2a3f6b', 0.4, 0.3);
  else m = P('#2c2e31', 0.55, 0.2);
  return new THREE.MeshStandardMaterial({ color: m.c, roughness: m.rough, metalness: m.metal, envMapIntensity: 0.9 });
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
async function loadModel(url, model) {
  let gltf;
  try { gltf = await loader.loadAsync(url); } catch (e) { return false; }
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const node = o.name && data.parts[o.name] ? o.name : (o.parent && data.parts[o.parent.name] ? o.parent.name : null);
    if (!node) return;
    const info = data.parts[node];
    const it = state.itemById.get(info.item);
    let g = o.geometry;
    g.deleteAttribute('color');
    g = toCreasedNormals(g, Math.PI / 6);
    o.geometry = g;
    o.material = matFor(it, info.name);
    o.userData = { node, item: it.id, base: o.position.clone() };
    state.meshes.set(node, o);
  });
  root.add(gltf.scene);
  return true;
}

await loadModel('models/full.glb', 'full');
await loadModel('models/hover.glb', 'hover');
$('#loading').hidden = true;

// explode anchors: whole item moves together if compact, otherwise each part on its own
const ZC = 140;
const anchor = new Map();
for (const it of data.items) {
  const cs = it.nodes.map((n) => data.parts[n].c);
  if (!cs.length) continue;
  const m = cs.reduce((a, c) => [a[0] + c[0] / cs.length, a[1] + c[1] / cs.length, a[2] + c[2] / cs.length], [0, 0, 0]);
  const spread = Math.max(...cs.map((c) => Math.hypot(c[0] - m[0], c[1] - m[1], c[2] - m[2])));
  for (const n of it.nodes) anchor.set(n, spread > 25 ? data.parts[n].c : m);
}
function explodeVec(node) {
  const a = anchor.get(node);
  const r = Math.hypot(a[0], a[1]);
  const v = new THREE.Vector3(0, 0, (a[2] - ZC) * 0.6);
  if (r > 3) v.add(new THREE.Vector3(a[0] / r, a[1] / r, 0).multiplyScalar(45 + 0.8 * r));
  return v;
}
const EXP = new Map();
for (const [node] of state.meshes) EXP.set(node, explodeVec(node));

function applyExplode() {
  const t = state.explode;
  const e = t * t * (3 - 2 * t);
  for (const [node, o] of state.meshes) o.position.copy(o.userData.base).addScaledVector(EXP.get(node), e);
}

const GHOST = new THREE.MeshBasicMaterial({ color: '#cfc4ad', transparent: true, opacity: 0.14, depthWrite: false });
function applyVisibility() {
  const sel = state.selected;
  for (const [, o] of state.meshes) {
    const it = state.itemById.get(o.userData.item);
    o.visible = inBuild(it);
    const on = sel === it.id;
    if (!o.userData.mat) o.userData.mat = o.material;
    const mat = o.userData.mat;
    mat.emissive.set(on ? '#2e7a4a' : '#000000');
    mat.emissiveIntensity = on ? 0.55 : 0;
    const filtered = state.cats.size > 0 && !state.cats.has(it.cat);
    const ghost = !on && ((state.isolate && sel) || filtered);
    o.material = ghost ? GHOST : mat;
  }
}

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + 'px';
  renderer.domElement.style.height = h + 'px';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);
resize();

function visibleBox(filter) {
  const box = new THREE.Box3();
  for (const [, o] of state.meshes) if (o.visible && (!filter || filter(o))) box.expandByObject(o);
  return box;
}
let tween = null;
function frame(box, dirOverride) {
  if (box.isEmpty()) return;
  const s = box.getBoundingSphere(new THREE.Sphere());
  const dir = dirOverride || camera.position.clone().sub(controls.target).normalize();
  const dist = s.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * (dirOverride ? 1.05 : 1.9);
  const toPos = s.center.clone().addScaledVector(dir, Math.max(dist, 170));
  tween = { t0: performance.now(), p0: camera.position.clone(), q0: controls.target.clone(), p1: toPos, q1: s.center.clone() };
}
function resetView() {
  root.updateMatrixWorld(true);
  frame(visibleBox(), new THREE.Vector3(0.62, 0.32, 0.72).normalize());
}
root.updateMatrixWorld(true);
{
  const b = visibleBox(); const s = b.getBoundingSphere(new THREE.Sphere());
  controls.target.copy(s.center);
  camera.position.copy(s.center).addScaledVector(new THREE.Vector3(0.62, 0.32, 0.72).normalize(), s.radius / Math.sin(THREE.MathUtils.degToRad(16)) * 1.05);
}

renderer.setAnimationLoop((now) => {
  if (tween) {
    const k = Math.min(1, (now - tween.t0) / 650), e = 1 - Math.pow(1 - k, 3);
    camera.position.lerpVectors(tween.p0, tween.p1, e);
    controls.target.lerpVectors(tween.q0, tween.q1, e);
    if (k >= 1) tween = null;
  }
  controls.update();
  renderer.render(scene, camera);
});

// picking
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const objs = [...state.meshes.values()].filter((o) => o.visible && o.material !== GHOST);
  const hit = ray.intersectObjects(objs, false)[0];
  return hit ? hit.object : null;
}
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  const o = pick(e);
  select(o ? o.userData.item : null, { fromModel: true });
});
const tip = $('#tip');
let hoverRaf = 0;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || e.buttons) { tip.hidden = true; return; }
  cancelAnimationFrame(hoverRaf);
  hoverRaf = requestAnimationFrame(() => {
    const o = pick(e);
    if (!o) { tip.hidden = true; renderer.domElement.style.cursor = ''; return; }
    const r = host.getBoundingClientRect();
    tip.textContent = state.itemById.get(o.userData.item).name;
    tip.style.left = e.clientX - r.left + 'px';
    tip.style.top = e.clientY - r.top + 'px';
    tip.hidden = false;
    renderer.domElement.style.cursor = 'pointer';
  });
});
renderer.domElement.addEventListener('pointerleave', () => { tip.hidden = true; });

// part thumbnails: the selected line rendered on its own from the CAD, unexploded
const THUMB_W = 720, THUMB_H = 440;
const thumbRT = new THREE.WebGLRenderTarget(THUMB_W, THUMB_H, { samples: 4, colorSpace: THREE.SRGBColorSpace });
const thumbCam = new THREE.PerspectiveCamera(26, THUMB_W / THUMB_H, 1, 20000);
const thumbCache = new Map();
function partImage(id) {
  const key = id + '|' + state.build;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const it = state.itemById.get(id);
  const sc = new THREE.Scene();
  sc.environment = scene.environment;
  const l = new THREE.DirectionalLight(0xffffff, 1.5); l.position.set(600, 900, 700); sc.add(l);
  sc.add(new THREE.HemisphereLight(0xfffaf0, 0xd8cdb6, 0.7));
  const g = new THREE.Group(); g.rotation.x = -Math.PI / 2; sc.add(g);
  const mats = [];
  for (const n of it.nodes) {
    const o = state.meshes.get(n);
    if (!o || !inBuild(it)) continue;
    const m = (o.userData.mat || o.material).clone();
    if (m.emissive) m.emissive.set('#000000');
    mats.push(m);
    const c = new THREE.Mesh(o.geometry, m);
    c.position.copy(o.userData.base); c.quaternion.copy(o.quaternion); c.scale.copy(o.scale);
    g.add(c);
  }
  if (!g.children.length) { thumbCache.set(key, null); return null; }
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const sph = box.getBoundingSphere(new THREE.Sphere());
  // look at the part's outboard face: CAD radial direction -> world (x, z, -y)
  const cc = it.nodes.map((n) => data.parts[n].c).reduce((a, c, _, arr) => [a[0] + c[0] / arr.length, a[1] + c[1] / arr.length], [0, 0]);
  const rr = Math.hypot(cc[0], cc[1]);
  const dir = rr > 4 && it.nodes.length < 6
    ? new THREE.Vector3(cc[0] / rr, 0.45, -cc[1] / rr).normalize()
    : new THREE.Vector3(0.62, 0.38, 0.69).normalize();
  const fit = Math.min(thumbCam.fov, thumbCam.fov * thumbCam.aspect) / 2;
  thumbCam.position.copy(sph.center).addScaledVector(dir, sph.radius / Math.sin(THREE.MathUtils.degToRad(fit)) * 1.02);
  thumbCam.near = sph.radius * 0.05; thumbCam.far = sph.radius * 20;
  thumbCam.lookAt(sph.center); thumbCam.updateProjectionMatrix();
  const prevClear = renderer.getClearAlpha();
  renderer.setRenderTarget(thumbRT);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(sc, thumbCam);
  const px = new Uint8Array(THUMB_W * THUMB_H * 4);
  renderer.readRenderTargetPixels(thumbRT, 0, 0, THUMB_W, THUMB_H, px);
  renderer.setRenderTarget(null);
  renderer.setClearAlpha(prevClear);
  mats.forEach((m) => m.dispose());
  const cv = document.createElement('canvas'); cv.width = THUMB_W; cv.height = THUMB_H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(THUMB_W, THUMB_H);
  for (let y = 0; y < THUMB_H; y++) img.data.set(px.subarray((THUMB_H - 1 - y) * THUMB_W * 4, (THUMB_H - y) * THUMB_W * 4), y * THUMB_W * 4);
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL('image/png');
  thumbCache.set(key, url);
  return url;
}
function imgBlock(it) {
  const src = partImage(it.id);
  if (!src) return '';
  const cap = ['MOTOR', 'PROPS'].includes(it.id) ? '<figcaption>CAD shows the original QX QH2208-V2 setup</figcaption>' : '';
  return `<figure class="part-img"><img src="${src}" alt="3D render of ${esc(it.name)} from the PIONEER CAD">${cap}</figure>`;
}

// ---------------------------------------------------------------- UI
function renderStats() {
  const t = buildTotals();
  $('#st-mass').textContent = (t.unknown ? '≥ ' : '') + fmtG(t.mass);
  $('#st-parts').textContent = t.parts.toLocaleString();
  $('#st-cost').textContent = fmt$(t.total);
  // mass bar by category
  const cats = new Map();
  for (const it of data.items) if (inBuild(it) && it.mass_g && it.massKnown) cats.set(it.cat, (cats.get(it.cat) || 0) + it.mass_g);
  const rows = [...cats].sort((a, b) => b[1] - a[1]);
  $('#massbar').innerHTML = rows.map(([c, g]) => `<span title="${esc(c)}: ${fmtG(g)}" style="width:${(g / t.mass) * 100}%;background:${CAT_COLORS[c]}"></span>`).join('');
  $('#massbar-legend').innerHTML = rows.slice(0, 6).map(([c, g]) => `<span><i style="background:${CAT_COLORS[c]}"></i>${esc(c)} ${Math.round((g / t.mass) * 100)}%</span>`).join('');
  $('#bom-foot').innerHTML = `Parts to buy <b>${fmt$(t.buy)}</b> · filament ${t.fils.length} spools <b>${fmt$(t.filCost)}</b><br>Prices checked Sept 2026, before tax and shipping. Sensors marked “later” aren't included.`;
}

const CAT_ORDER = [...new Set(data.items.map((i) => i.cat))];
function renderFilters() {
  const n = state.cats.size;
  $('#filter-toggle').innerHTML = `Filter by category${n ? ` <b>${n}</b>` : ''}<span aria-hidden="true">${$('#filters').hidden ? '▾' : '▴'}</span>`;
  $('#filter-clear').hidden = !n;
  $('#filters').innerHTML = CAT_ORDER.map((c) => {
    const its = data.items.filter((i) => i.cat === c && inBuild(i));
    const on = state.cats.has(c);
    return `<button class="fchip" data-cat="${esc(c)}" aria-pressed="${on}"><i style="background:${CAT_COLORS[c]}"></i>${esc(c)}<span>${its.length}</span></button>`;
  }).join('');
  // filtered subtotal
  if (!n) { $('#filter-sum').hidden = true; return; }
  let g = 0, cost = 0, lines = 0;
  for (const it of data.items) if (inBuild(it) && state.cats.has(it.cat)) { lines++; if (it.massKnown) g += it.mass_g || 0; cost += itemCost(it); }
  const t = buildTotals();
  $('#filter-sum').hidden = false;
  $('#filter-sum').innerHTML = `Showing ${lines} line${lines === 1 ? '' : 's'} · <b>${fmtG(g)}</b> (${t.mass ? Math.round((g / t.mass) * 100) : 0}% of weight) · <b>${fmt$(cost)}</b>`;
}
$('#filter-toggle').addEventListener('click', () => {
  $('#filters').hidden = !$('#filters').hidden;
  $('#filter-toggle').setAttribute('aria-expanded', String(!$('#filters').hidden));
  renderFilters();
});
$('#filters').addEventListener('click', (e) => {
  const b = e.target.closest('.fchip');
  if (!b) return;
  const c = b.dataset.cat;
  state.cats.has(c) ? state.cats.delete(c) : state.cats.add(c);
  if (state.selected && state.cats.size && !state.cats.has(state.itemById.get(state.selected).cat)) state.selected = null;
  refreshFilter();
});
$('#filter-clear').addEventListener('click', () => { state.cats.clear(); refreshFilter(); });
function refreshFilter() { renderFilters(); renderBom(); applyVisibility(); renderDetail(); }

function renderBom() {
  const q = $('#search').value.trim().toLowerCase();
  const groups = new Map();
  for (const it of data.items) {
    if (state.cats.size && !state.cats.has(it.cat)) continue;
    if (q && !(it.name + ' ' + (it.buy || '') + ' ' + (it.partNames || []).join(' ') + ' ' + it.cat).toLowerCase().includes(q)) continue;
    if (!groups.has(it.cat)) groups.set(it.cat, []);
    groups.get(it.cat).push(it);
  }
  let html = '';
  for (const [cat, its] of groups) {
    const g = its.filter((i) => inBuild(i)).reduce((s, i) => s + (i.massKnown ? i.mass_g || 0 : 0), 0);
    html += `<div class="cat"><div class="cat-head"><span>${esc(cat)}</span><span>${fmtG(g)}</span></div>`;
    for (const it of its) {
      const off = !inBuild(it);
      const cost = itemCost(it);
      const costTxt = it.fil ? (cost ? '≈' + fmt$(cost) : '') : (it.priceType === 'Included' ? 'incl.' : it.priceType === 'Lab' ? 'lab' : it.priceType === 'Later' ? 'later' : fmt$(cost));
      const sub = it.fil ? it.fil : (it.vendor || '');
      html += `<button class="row${state.selected === it.id ? ' sel' : ''}${off ? ' off' : ''}" data-id="${it.id}" title="${off ? 'Not in this build' : ''}">
        <span class="sw" style="background:${CAT_COLORS[it.cat]}"></span>
        <span class="nm">${esc(it.name)}<small>${esc(sub)}${off ? ' · ' + (it.build === 'full' ? 'full build only' : 'hover-test only') : ''}</small></span>
        <span class="num">${it.massKnown ? fmtG(it.mass_g) : '–'}<br>${costTxt}</span></button>`;
    }
    html += '</div>';
  }
  $('#bom-list').innerHTML = html || '<p class="fine" style="padding:12px">No parts match.</p>';
}
$('#bom-list').addEventListener('click', (e) => {
  const b = e.target.closest('.row');
  if (b) select(b.dataset.id, { frameIt: true });
});
$('#search').addEventListener('input', renderBom);

function overviewHtml() {
  const f = buildTotals('full'), h = buildTotals('hover');
  return `<div class="overview">
    <div class="d-cat"><span class="tag">Overview</span></div>
    <h3>What's inside PIONEER</h3>
    <p>PIONEER is a single-motor drone that flies like a rocket: a coaxial motor under a two-axis gimbal steers the thrust, the way a liquid engine will on the rocket this is training for. Everything structural is printed and bolted to carbon rods, so a crash means reprinting a part, not rebuilding the vehicle.</p>
    <dl class="kv">
      <div><dt>Full build</dt><dd>${f.unknown ? '≥ ' : ''}${fmtG(f.mass)}<small>${f.parts} CAD parts</small></dd></div>
      <div><dt>Hover-test build</dt><dd>${h.unknown ? '≥ ' : ''}${fmtG(h.mass)}<small>fairing and sensors off</small></dd></div>
      <div><dt>Parts to buy</dt><dd>${fmt$(f.buy)}<small>full build</small></dd></div>
      <div><dt>Filament</dt><dd>${fmt$(f.filCost)}<small>${f.fils.length} spools</small></dd></div>
    </dl>
    <ol>
      <li>Click any part in the model or the list to see why it's there, what it weighs and where to buy it.</li>
      <li>Printed parts link to the filament to buy and the print settings.</li>
      <li>Drag <b>Explode</b> to pull the vehicle apart; <b>Isolate</b> fades everything but your selection.</li>
      <li>Switch to the <b>hover-test build</b> for the first tethered flights (fairing off, lighter feet).</li>
    </ol>
    <p class="note">The motor in the 3D model is the original QX QH2208-V2. It's being replaced by a Himax CR2816-1100 (164 g, about 36 g heavier) because no US seller stocks the QH2208; costs already use the Himax.</p>
    <p class="fine">Weights come from the Onshape CAD (printed parts at solid filament density, so real parts with infill come in lighter). Prices were checked in Sept 2026 and don't include tax or shipping. <a href="https://cad.onshape.com/documents/94c227a51e679f5aed526804" target="_blank" rel="noopener">Open the live CAD in Onshape ↗</a></p>
  </div>`;
}

function detailHtml(it) {
  const t = buildTotals();
  const pct = it.massKnown && it.mass_g && t.mass ? ((it.mass_g / t.mass) * 100) : null;
  const tags = [`<span class="tag">${esc(it.cat)}</span>`];
  if (it.fil) tags.push(`<span class="tag fil">${esc(it.fil)}</span>`);
  if (it.build !== 'both') tags.push(`<span class="tag warn">${it.build === 'full' ? 'Full build only' : 'Hover-test build only'}</span>`);
  const each = it.instances > 1 && it.massKnown && (it.partNames || []).length === 1 ? `<small>${fmtG(it.mass_g / it.instances)} each × ${it.instances}</small>` : `<small>${pct != null ? pct.toFixed(1) + '% of this build' : ''}</small>`;
  let cost = '', buy = '';
  if (it.fil) {
    const F = data.filaments[it.fil];
    const perPart = it.mass_g / Math.max(1, it.instances);
    const nPrint = it.printQty || it.instances;
    const c = perPart * nPrint * perGram(it.fil);
    cost = `<div><dt>Material</dt><dd>≈ ${fmt$(c)}<small>${nPrint} × ${fmtG(perPart)} of ${esc(it.fil)}</small></dd></div>`;
    buy = `<div class="card"><h4>Print it in</h4>
      ${imgBlock(it)}
      <div class="what">${esc(F.name)}</div>
      <div class="meta">${esc(F.spool)} spool · ${fmt$(F.price)} at ${esc(F.vendor)} · print ${nPrint}</div>
      <div class="btns"><a class="btn" href="${F.url}" target="_blank" rel="noopener">Buy ${esc(it.fil)} at ${esc(F.vendor)} ↗</a>
      ${it.fil === 'PAHT-CF' ? `<a class="btn ghost" href="${data.filaments.Support.url}" target="_blank" rel="noopener">Support for PA/PET ↗</a>` : ''}</div>
      <p class="why-fil">${esc(F.why)}</p>
      <div class="settings"><b>Settings:</b> ${esc(F.settings)}</div>
    </div>`;
  } else {
    const c = itemCost(it);
    const label = it.priceType === 'Included' ? 'Included' : it.priceType === 'Lab' ? 'Lab supply' : it.priceType === 'Later' ? 'Later' : fmt$(c);
    const small = ['Listed', 'Est.'].includes(it.priceType) ? `${it.qty} × ${fmt$(it.price)}${it.priceType === 'Est.' ? ' (estimate)' : ''}` : '';
    cost = `<div><dt>Cost</dt><dd>${label}<small>${small}</small></dd></div>`;
    const has = !!it.url;
    buy = `<div class="card"><h4>Buy</h4>
      ${imgBlock(it)}
      <div class="what">${esc(it.buy || it.name)}</div>
      <div class="meta">${esc(it.vendor || '')}${['Listed', 'Est.'].includes(it.priceType) ? ' · ' + fmt$(it.price) + (it.qty > 1 ? ` × ${it.qty}` : '') : ''}</div>
      <a class="btn" ${has ? `href="${it.url}" target="_blank" rel="noopener"` : 'aria-disabled="true"'}>${has ? 'Buy at ' + esc(it.vendor) + ' ↗' : 'No store link (lab / included)'}</a>
    </div>`;
  }
  return `<div class="d-cat">${tags.join('')}</div>
    <h3>${esc(it.name)}</h3>
    <p>${esc(it.why)}</p>
    ${it.note ? `<p class="note">${esc(it.note)}</p>` : ''}
    <dl class="kv">
      <div><dt>Weight</dt><dd>${it.massKnown ? fmtG(it.mass_g) : (it.instances ? '–' : 'not modelled')}${each}</dd></div>
      ${cost}
    </dl>
    ${buy}
    ${it.partNames && it.partNames.length ? `<details class="parts"><summary>${it.instances} CAD part${it.instances === 1 ? '' : 's'} in this line</summary><ul>${it.partNames.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></details>` : '<p class="fine">This part isn\'t in the 3D model yet.</p>'}`;
}

function renderDetail() {
  const it = state.selected && state.itemById.get(state.selected);
  $('#detail').innerHTML = it ? detailHtml(it) : overviewHtml();
  $('#detail').scrollTop = 0;
}

function select(id, { frameIt = false, fromModel = false } = {}) {
  state.selected = id;
  applyVisibility();
  renderBom();
  renderDetail();
  if (id && frameIt) {
    root.updateMatrixWorld(true);
    const box = visibleBox((o) => o.userData.item === id);
    if (!box.isEmpty()) frame(box);
  }
  if (id && fromModel) {
    const row = document.querySelector(`.row[data-id="${id}"]`);
    row && row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  if (id && matchMedia('(max-width: 900px)').matches) setTab('detail');
}

function setBuild(b) {
  state.build = b;
  document.querySelectorAll('.build-toggle button').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.build === b)));
  if (state.selected && !inBuild(state.itemById.get(state.selected))) state.selected = null;
  applyVisibility();
  renderStats();
  renderFilters();
  renderBom();
  renderDetail();
}
document.querySelectorAll('.build-toggle button').forEach((b) => b.addEventListener('click', () => setBuild(b.dataset.build)));

$('#explode').addEventListener('input', (e) => { state.explode = +e.target.value; applyExplode(); });
$('#btn-isolate').addEventListener('click', (e) => {
  state.isolate = !state.isolate;
  e.currentTarget.setAttribute('aria-pressed', String(state.isolate));
  applyVisibility();
});
$('#btn-reset').addEventListener('click', () => { select(null); resetView(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') select(null); });

function setTab(t) {
  document.body.dataset.tab = t;
  document.querySelectorAll('.mobile-tabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === t)));
}
document.querySelectorAll('.mobile-tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
setTab('detail');

applyVisibility();
renderStats();
renderFilters();
renderBom();
renderDetail();
