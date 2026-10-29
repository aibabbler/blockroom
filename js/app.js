/* Blockroom app: viewport, motion engine, UI, AI director calls, export. */
(() => {
"use strict";
const $ = s => document.querySelector(s);
const BR = window.BR, U = BR.util;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const r2 = v => Math.round(v * 100) / 100, r3 = U.r3, r1 = U.r1, clamp = U.clamp, uid = U.uid;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const lsDel = k => { try { localStorage.removeItem(k); } catch (e) {} };
const CAT = BR.CAT;
const catOf = b => CAT[b.type] || CAT.box;
const kindOf = b => catOf(b).kind;

if (!window.THREE || !THREE.OrbitControls || !THREE.TransformControls) { $("#loading").textContent = "3D ENGINE DID NOT LOAD. CHECK YOUR CONNECTION AND RELOAD."; return; }

const SWATCHES = [["Clay", "#b8b2a6"], ["Bone", "#e6dcc8"], ["Brass", "#b58d3d"], ["Tomato", "#d6553a"], ["Magenta", "#c43f86"], ["Cobalt", "#3a5ec4"], ["Teal", "#278a83"], ["Lime", "#8cbc3a"], ["Sun", "#efbf35"], ["Orange", "#e5832a"], ["Violet", "#7550c0"], ["Sky", "#6db0de"], ["Rose", "#e396a6"], ["Charcoal", "#3a3833"], ["White", "#f4f2ee"]];
const POSE_NAMES = { auto: "Automatic (walk/run/idle)", stand: "Stand", sit: "Sit", crouch: "Crouch", kneel: "Kneel", lie: "Lie down", fall: "Fallen", wave: "Wave", point: "Point", talk: "Talk", hands_up: "Hands up", aim: "Aim", fight: "Fight stance", dance: "Dance", sing: "Sing", phone: "On the phone", drive: "Driving" };
const MODELS = [
  ["anthropic/claude-sonnet-5.5", "Claude Sonnet 5.5 (recommended)"],
  ["anthropic/claude-opus-5.5", "Claude Opus 5.5 (best layouts)"],
  ["google/gemini-4-argon", "Gemini 4 Argon"],
  ["openai/gpt-6.1-sol", "GPT-6.1 Sol"],
  ["moonshotai/kimi-k3.1-pro", "Kimi K3.1 Pro (budget)"],
  ["custom", "Custom model ID…"],
];

/* ---------- state ---------- */
let S = null;
const objs = new Map();
let T = 0, playing = false, recording = null, sel = null, view = "free", tool = "move";
let dragging = null, exporting = false;
const settings = Object.assign({ model: MODELS[0][0], custom: "", passcode: "", takes: "auto" }, (() => { try { return JSON.parse(lsGet("br2.settings") || "{}"); } catch (e) { return {}; } })());
const saveSettings = () => lsSet("br2.settings", JSON.stringify(settings));

/* ---------- three setup ---------- */
const vpEl = $("#vp");
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
vpEl.prepend(renderer.domElement);
$("#loading").remove();

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight(0xfff4e2, 1.2);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 260 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xcfe0ec, 0x6a6356, 0.3); scene.add(hemi);
const grid = new THREE.GridHelper(80, 80, 0x6a6356, 0x8f887a); grid.material.transparent = true; grid.material.opacity = 0.28; grid.position.y = 0.01; grid.layers.set(2); scene.add(grid);

// weather particles (layer 0 so they appear in renders)
const PCOUNT = 4000;
const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(PCOUNT * 6), 3));
const pMat = new THREE.LineBasicMaterial({ color: 0xbfd2e6, transparent: true, opacity: 0.45, depthWrite: false });
const particles = new THREE.LineSegments(pGeo, pMat); particles.frustumCulled = false; particles.visible = false; scene.add(particles);
const pSeed = new Float32Array(PCOUNT * 3); for (let i = 0; i < PCOUNT * 3; i++) pSeed[i] = Math.random();

const freeCam = new THREE.PerspectiveCamera(45, 1, 0.05, 3000); freeCam.position.set(14, 12, 26); freeCam.layers.enableAll();
const topCam = new THREE.OrthographicCamera(-40, 40, 40, -40, 0.1, 2000); topCam.position.set(0, 400, 0); topCam.up.set(0, 0, -1); topCam.lookAt(0, 0, 0); topCam.layers.enableAll();
const viewCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 3000);
const exportCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 3000);
const orbit = new THREE.OrbitControls(freeCam, renderer.domElement);
orbit.enableDamping = true; orbit.dampingFactor = 0.12; orbit.target.set(0, 1, 6); orbit.maxPolarAngle = Math.PI * 0.495; orbit.maxDistance = 1500;
const orbitTop = new THREE.OrbitControls(topCam, renderer.domElement);
orbitTop.enableRotate = false; orbitTop.screenSpacePanning = true; orbitTop.enabled = false;
orbitTop.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
orbitTop.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
const tc = new THREE.TransformControls(freeCam, renderer.domElement); tc.setSize(0.9); scene.add(tc);
tc.addEventListener("dragging-changed", e => {
  orbit.enabled = !e.value && view === "free" && tool !== "walk"; orbitTop.enabled = !e.value && view === "top" && tool !== "walk";
  if (e.value) dragging = sel; else { const id = dragging; dragging = null; if (id && !recording) commitPose(id); }
});
const selBox = new THREE.Box3Helper(new THREE.Box3(), 0xd1aa5e); selBox.layers.set(3); selBox.visible = false; scene.add(selBox);
const raycaster = new THREE.Raycaster(); raycaster.layers.enableAll();
const texLoader = new THREE.TextureLoader();

/* ---------- building bodies ---------- */
function mergeStatic(g) {
  let n = 0; g.traverse(m => { if (m.isMesh) n++; });
  if (n < 5 || !THREE.BufferGeometryUtils) return g;
  g.updateMatrixWorld(true);
  const groups = new Map(), keep = [], old = [];
  g.traverse(m => {
    if (!m.isMesh) return;
    if (Array.isArray(m.material)) { keep.push(m); return; }
    const k = m.material.uuid + (m.castShadow ? "c" : "n");
    if (!groups.has(k)) groups.set(k, { mat: m.material, geos: [], cast: m.castShadow });
    let geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const name of Object.keys(geo.attributes)) if (!["position", "normal", "uv"].includes(name)) geo.deleteAttribute(name);
    if (!geo.attributes.uv) geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.morphAttributes = {};
    geo.applyMatrix4(m.matrixWorld);
    groups.get(k).geos.push(geo); old.push(m.geometry);
  });
  const out = new THREE.Group();
  for (const { mat, geos, cast } of groups.values()) {
    const merged = geos.length === 1 ? geos[0] : THREE.BufferGeometryUtils.mergeBufferGeometries(geos, false);
    if (!merged) return g;
    const me = new THREE.Mesh(merged, mat); me.castShadow = cast; me.receiveShadow = true; out.add(me);
    if (geos.length > 1) geos.forEach(x => x.dispose());
  }
  for (const m of keep) out.attach(m);
  old.forEach(x => x.dispose());
  out.userData = g.userData;
  return out;
}
function buildCard(b) {
  const g = new THREE.Group(); const [w, h, d] = b.size;
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(b.color), roughness: 1, envMapIntensity: 0.45 }); mat.userData = { unique: true, baseColor: mat.color.clone(), baseEnv: 0.45 };
  let front = mat;
  if (b.img) { front = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, envMapIntensity: 0.5 }); front.userData = { unique: true, baseColor: new THREE.Color(0xffffff), baseEnv: 0.5, noClay: true }; texLoader.load(b.img, tex => { tex.encoding = THREE.sRGBEncoding; tex.userData.own = true; front.map = tex; front.needsUpdate = true; }); }
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mat, mat, mat, mat, front, mat]); m.position.y = h / 2; m.castShadow = m.receiveShadow = true; g.add(m);
  return g;
}
function buildCamera(b) {
  const g = new THREE.Group(); const m2 = new THREE.MeshStandardMaterial({ color: new THREE.Color(b.color), roughness: 0.5 }); m2.userData = { unique: true, baseColor: m2.color.clone(), baseEnv: 1 };
  const add = (geo, x, y, z) => { const me = new THREE.Mesh(geo, m2); me.position.set(x, y, z); g.add(me); };
  add(new THREE.BoxGeometry(0.2, 0.16, 0.28), 0, 0, 0);
  add(new THREE.CylinderGeometry(0.06, 0.075, 0.14, 20).rotateX(Math.PI / 2), 0, 0, -0.2);
  for (const z of [-0.06, 0.08]) add(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 20).rotateZ(Math.PI / 2), 0, 0.15, z);
  g.children.forEach(m => m.layers.set(2));
  return g;
}
function isEnvForClay(b) { if (b.ai === "kit") return !["actor", "animal"].includes(kindOf(b)); return ["building", "nature", "street", "ground", "water", "furniture", "stage"].includes(kindOf(b)) && b.ai !== "story"; }
function buildBody(b) {
  const cat = catOf(b);
  let inner;
  BR.forceUnique = b.ai !== "kit";
  BR.seed(b.seed || 1);
  try {
    if (cat.card) inner = buildCard(b);
    else if (cat.camera) inner = buildCamera(b);
    else if (cat.build) {
      inner = cat.build(b);
      if (!inner.userData.anim && !b.img) inner = mergeStatic(inner);
    } else inner = new THREE.Group();
  } catch (err) { console.error(err); inner = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(...b.size), new THREE.MeshStandardMaterial({ color: b.color })); m.position.y = b.size[1] / 2; inner.add(m); }
  BR.forceUnique = false;
  const body = new THREE.Group(); body.add(inner);
  if (!cat.param && !cat.card && !cat.camera) inner.scale.set(b.size[0] / cat.size[0], b.size[1] / cat.size[1], b.size[2] / cat.size[2]);
  const clay = isEnvForClay(b);
  body.traverse(m => {
    if (!m.isMesh && !m.isLineSegments) return;
    m.userData.id = b.id;
    if (cat.ground || cat.kind === "water" || ["road", "highway", "runway", "plaza", "sidewalk", "path", "parking", "crosswalk", "crossroads"].includes(b.type)) m.castShadow = false;
    if (b.guide && !cat.camera) m.layers.set(2);
    [].concat(m.material).forEach(mt => { if (mt) { mt.userData.clay = mt.userData.clay || clay; if (clay && cat.kind === "building") mt.userData.clayMap = true; } });
  });
  body.userData.anim = inner.userData.anim || null;
  body.userData.inner = inner;
  return body;
}
function frustumLines(b, lens) {
  const asp = U.aspectNum(S.aspect), L = 1.1, { tx, ty } = U.halfTan(lens || b.cam.lens, asp);
  const x = tx * L, y = ty * L, z = -L;
  const pts = [0, 0, 0, -x, -y, z, 0, 0, 0, x, -y, z, 0, 0, 0, x, y, z, 0, 0, 0, -x, y, z, -x, -y, z, x, -y, z, x, -y, z, x, y, z, x, y, z, -x, y, z, -x, y, z, -x, -y, z, -x * 0.4, y * 1.08, z, 0, y * 1.35, z, 0, y * 1.35, z, x * 0.4, y * 1.08, z];
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x8f887a })); l.layers.set(2); return l;
}

/* ---------- labels ---------- */
function labelSprite(b) {
  const c = document.createElement("canvas"), ctx = c.getContext("2d");
  const fs = 34, font = `500 ${fs}px "Kode Mono", ui-monospace, monospace`;
  ctx.font = font; const text = (b.label || "—").slice(0, 28); const tw = ctx.measureText(text).width;
  c.width = Math.ceil(tw + 70); c.height = 58; ctx.font = font; ctx.fillStyle = "rgba(22,20,16,0.86)";
  const r = 12, W = c.width, H = c.height;
  ctx.beginPath(); ctx.moveTo(r, 0); ctx.arcTo(W, 0, W, H, r); ctx.arcTo(W, H, 0, H, r); ctx.arcTo(0, H, 0, 0, r); ctx.arcTo(0, 0, W, 0, r); ctx.fill();
  ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(26, H / 2, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#f4eddd"; ctx.textBaseline = "middle"; ctx.fillText(text, 44, H / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false }));
  sp.center.set(0.5, 0); sp.renderOrder = 999; sp.layers.set(1); sp.userData.aspect = W / H; return sp;
}
function setLabelScale(cam, frac) {
  const k = cam.isOrthographicCamera ? frac * (cam.top - cam.bottom) / cam.zoom : frac * 2 * Math.tan(cam.fov * D2R / 2);
  for (const o of objs.values()) if (o.label) o.label.scale.set(k * o.label.userData.aspect, k, 1);
}

/* ---------- objects ---------- */
function disposeTree(root) {
  root.traverse(n => {
    if (n.geometry) n.geometry.dispose();
    if (n.material) [].concat(n.material).forEach(m => { if (m && m.userData && m.userData.unique) { if (m.map && m.map.userData && m.map.userData.own) m.map.dispose(); m.dispose(); } });
  });
}
function disposeObj(o) {
  disposeTree(o.root); scene.remove(o.root);
  if (o.label) { o.label.material.map.dispose(); o.label.material.dispose(); scene.remove(o.label); }
  if (o.path) { o.path.geometry.dispose(); o.path.material.dispose(); scene.remove(o.path); }
}
function makeObj(b) {
  const root = new THREE.Group(); root.rotation.order = "YXZ"; root.userData.id = b.id;
  const body = buildBody(b); root.add(body);
  let frust = null; if (catOf(b).camera) { frust = frustumLines(b); root.add(frust); }
  scene.add(root);
  const o = { root, body, label: null, path: null, frust, b, anim: body.userData.anim, liveDist: 0, liveSpeed: 0, dist: null };
  objs.set(b.id, o);
  ensureLabel(o); applyVis(o); rebuildPath(o); applyLookTo(o);
  applyPose(o, U.poseAt(b, T));
  return o;
}
function ensureLabel(o) {
  if (o.b.showLabel && !o.label) { o.label = labelSprite(o.b); scene.add(o.label); }
  if (!o.b.showLabel && o.label) { scene.remove(o.label); o.label.material.map.dispose(); o.label.material.dispose(); o.label = null; }
}
function rebuildObj(b) {
  const o = objs.get(b.id); if (!o) return makeObj(b);
  disposeObj(o); objs.delete(b.id);
  const n = makeObj(b); if (sel === b.id) attachSel(); return n;
}
function rebuildAll() {
  for (const o of objs.values()) disposeObj(o);
  objs.clear();
  S.blocks.forEach(makeObj);
  applyLook();
  if (sel && !objs.has(sel)) sel = null;
  attachSel(); evalAll(T);
}
function applyVis(o) { const b = o.b; o.root.visible = !b.hidden; if (o.label) o.label.visible = !b.hidden && b.showLabel; if (o.path) o.path.visible = !b.hidden; }
function rebuildPath(o) {
  if (o.path) { o.path.geometry.dispose(); o.path.material.dispose(); scene.remove(o.path); o.path = null; }
  o.dist = null;
  const b = o.b; if ((b.keys || []).length < 2) return;
  const t0 = b.keys[0].t, t1 = b.keys[b.keys.length - 1].t;
  // distance table for walk cycles and wheels
  const N = Math.max(2, Math.ceil((t1 - t0) * 30)), ts = new Float32Array(N + 1), ds = new Float32Array(N + 1);
  let prev = U.poseAt(b, t0).p, acc = 0;
  for (let i = 0; i <= N; i++) { const t = t0 + (t1 - t0) * i / N, p = U.poseAt(b, t).p; acc += Math.hypot(p[0] - prev[0], p[2] - prev[2], (catOf(b).kind === "aircraft" ? p[1] - prev[1] : 0)); prev = p; ts[i] = t; ds[i] = acc; }
  o.dist = { t0, t1, N, ts, ds };
  if (catOf(b).camera && b.autoCam) { /* shot cameras: draw thin path */ }
  const pts = []; const n = Math.max(24, Math.ceil((t1 - t0) * 10));
  for (let i = 0; i <= n; i++) { const p = U.poseAt(b, t0 + (t1 - t0) * i / n).p; pts.push(p[0], p[1] < 0.5 ? 0.04 : p[1], p[2]); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(b.color), transparent: true, opacity: catOf(b).camera ? 0.45 : 0.9 }));
  line.layers.set(2); scene.add(line); o.path = line; line.visible = !b.hidden;
}
function distAt(o, t) {
  const d = o.dist; if (!d) return 0;
  if (t <= d.t0) return 0; if (t >= d.t1) return d.ds[d.N];
  const f = (t - d.t0) / (d.t1 - d.t0) * d.N, i = Math.floor(f), u = f - i;
  return d.ds[i] + (d.ds[Math.min(d.N, i + 1)] - d.ds[i]) * u;
}

/* ---------- animation ---------- */
function applyPose(o, pose) {
  o.root.position.set(pose.p[0], pose.p[1], pose.p[2]);
  o.root.rotation.set(pose.r[0] * D2R, pose.r[1] * D2R, pose.r[2] * D2R, "YXZ");
  if (o.b.cam) o.curLens = pose.l ?? o.b.cam.lens;
}
const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function aimCamera(o) {
  const b = o.b; if (!b.cam || !b.cam.lookAt) return;
  const t = objs.get(b.cam.lookAt); if (!t || t.b.hidden) return;
  _v.copy(t.root.position); _v.y += t.b.size[1] * (b.cam.aim ?? 0.85);
  if (_v.distanceToSquared(o.root.position) < 1e-4) return;
  const roll = o.root.rotation.z;
  _m.lookAt(o.root.position, _v, _up); o.root.quaternion.setFromRotationMatrix(_m);
  if (roll) { o.root.rotation.z += roll; }
}
function evalAll(t) {
  for (const o of objs.values()) {
    const b = o.b;
    if (!(recording && recording.id === b.id) && dragging !== b.id) applyPose(o, U.poseAt(b, t));
    o.root.visible = !b.hidden && U.visAt(b, t);
  }
  for (const o of objs.values()) if (o.b.cam) aimCamera(o);
  for (const o of objs.values()) animateObj(o, t);
}
function animateObj(o, t) {
  const a = o.anim; if (!a) return;
  const live = (recording && recording.id === o.b.id) || dragging === o.b.id;
  let speed, dist;
  if (live) { speed = o.liveSpeed; dist = o.liveDist; }
  else { dist = distAt(o, t); speed = o.dist ? (dist - distAt(o, Math.max(0, t - 0.15))) / 0.15 : 0; }
  const inner = o.body.userData.inner || o.body;
  const sY = inner.scale ? inner.scale.y : 1;
  if (a.rig) {
    const rig = inner.userData.rig; const stride = (speed > 2.6 ? 2.3 : 1.45) * sY;
    BR.poseHuman(rig, { speed: speed / Math.max(0.3, sY), phase: dist / stride, pose: U.poseNameAt(o.b, t), t });
  }
  if (a.walker === "quad" && a.legs) { const ph = dist / (a.stride * sY) * Math.PI * 2, k = Math.min(1, speed / 1.2); for (const l of a.legs) l.p.rotation.x = Math.sin(ph + l.phase * Math.PI * 2) * 0.55 * k; if (a.neck) a.neck.rotation.x = Math.sin(ph * 2) * 0.05 * k; }
  if (a.wheels) for (const w of a.wheels) w.o.rotation.x = dist / (w.r * (inner.scale ? inner.scale.z : 1));
  if (a.spin) for (const s of a.spin) s.o.rotation[s.axis] = t * s.rate;
  if (a.flap) for (const w of a.flap) w.p.rotation.z = w.s * Math.sin(t * 14 + (a.flapOff || 0)) * 0.7;
  if (a.flock) inner.traverse(n => { const fa = n.userData && n.userData.anim; if (fa && fa.flap && n !== inner) for (const w of fa.flap) w.p.rotation.z = w.s * Math.sin(t * 13 + (fa.flapOff || 0)) * 0.7; });
  if (a.boat) { o.body.position.y = Math.sin(t * 1.3 + (o.b.seed || 0)) * 0.06 * sY; o.body.rotation.z = Math.sin(t * 0.9 + (o.b.seed || 0)) * 0.025; }
  if (a.flyer === "drift") o.body.position.y = Math.sin(t * 0.6) * 0.3;
  if (a.flicker) { const k = 0.9 + Math.sin(t * 17) * 0.06 + Math.sin(t * 29) * 0.05; inner.scale.y = k; }
}

/* ---------- look: time of day, weather, style ---------- */
const SKY = { day: ["#6f9fd0", "#d6e4ee"], golden_hour: ["#d99a62", "#f6d6a8"], dusk: ["#2c2f5a", "#d48a7a"], night: ["#04060e", "#18213a"], overcast: ["#98a0a6", "#d2d5d6"], dawn: ["#7a8ab8", "#f0c4ae"] };
const SUNCOL = { day: "#fff4e2", golden_hour: "#ffb46a", dusk: "#ff9a7a", night: "#9fb4ff", overcast: "#e8ecef", dawn: "#ffc8a8" };
const HEMI = { day: 0.35, golden_hour: 0.3, dusk: 0.32, night: 0.22, overcast: 0.7, dawn: 0.3 };
const ENVF = { day: 0.9, golden_hour: 0.7, dusk: 0.45, night: 0.14, overcast: 1.0, dawn: 0.65 };
const GLOW = { day: 0, golden_hour: 0.1, dusk: 0.6, night: 1, overcast: 0.1, dawn: 0.25 };
let skyTex = null, lookCache = null;
function skyTexture(top, hor) {
  const c = document.createElement("canvas"); c.width = 4; c.height = 256; const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, top); g.addColorStop(0.62, hor); g.addColorStop(1, hor); x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
}
function lookParams() {
  const L = S.look, time = SKY[L.time] ? L.time : "day";
  const clay = L.style === "clay";
  let envF = ENVF[time], sunP = L.sunPower, glow = GLOW[time];
  if (L.weather === "rain") { envF *= 0.8; sunP *= 0.5; }
  if (L.weather === "fog") { sunP *= 0.55; }
  return { time, clay, envF, sunP, glow, top: clay ? "#cbc5b9" : SKY[time][0], hor: clay ? "#cbc5b9" : SKY[time][1] };
}
function applyLook() {
  const L = S.look, P = lookParams(); lookCache = P;
  if (skyTex) skyTex.dispose(); skyTex = skyTexture(P.top, P.hor); scene.background = skyTex;
  const fogNear = L.weather === "fog" ? 6 : L.weather === "rain" ? 25 : L.weather === "snow" ? 20 : P.time === "night" ? 40 : 90;
  const fogFar = L.weather === "fog" ? 70 : L.weather === "rain" ? 220 : L.weather === "snow" ? 200 : P.time === "night" ? 320 : 700;
  scene.fog = (L.haze || L.weather !== "clear") ? new THREE.Fog(new THREE.Color(P.hor), fogNear, fogFar) : null;
  const az = (L.sunAz ?? 215) * D2R, el = (L.sunEl ?? 50) * D2R;
  sun.userData.dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  sun.color.set(P.clay ? "#fff6ea" : SUNCOL[P.time]); sun.intensity = P.clay ? 1.15 : P.sunP; sun.castShadow = !!L.shadows;
  hemi.color.set(P.clay ? "#e6e2da" : SKY[P.time][1]); hemi.groundColor.set(P.clay ? "#8a857a" : "#5a5448"); hemi.intensity = P.clay ? 0.45 : HEMI[P.time];
  grid.visible = !!S.grid;
  particles.visible = L.weather === "rain" || L.weather === "snow";
  pMat.color.set(L.weather === "snow" ? "#ffffff" : "#bfd2e6"); pMat.opacity = L.weather === "snow" ? 0.9 : 0.4;
  for (const o of objs.values()) applyLookTo(o);
}
function applyLookTo(o) {
  const P = lookCache; if (!P) return;
  o.body.traverse(m => {
    if (!m.material) return;
    [].concat(m.material).forEach(mt => {
      if (!mt || !mt.userData) return;
      const u = mt.userData;
      if (u.baseEnv != null && "envMapIntensity" in mt) mt.envMapIntensity = u.baseEnv * (P.clay ? 0.8 : P.envF);
      if (u.nightOnly) mt.opacity = P.clay ? 0 : u.nightOnly * P.glow;
      if (u.nightWindows) mt.emissiveIntensity = P.clay ? 0 : 1.3 * P.glow;
      if (u.clayMap) { if (P.clay && mt.map) { u._map = mt.map; mt.map = null; mt.needsUpdate = true; } else if (!P.clay && !mt.map && u._map) { mt.map = u._map; mt.needsUpdate = true; } }
      if (u.baseColor && !u.noClay && mt.color) {
        if (P.clay && u.clay) { const c = u.baseColor; const lum = 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; mt.color.setRGB(0.55 + lum * 0.45, 0.53 + lum * 0.45, 0.5 + lum * 0.45); }
        else if (u.kind !== "emit") mt.color.copy(u.baseColor);
      }
    });
  });
}
function updateParticles(cam, t) {
  if (!particles.visible) return;
  const pos = pGeo.attributes.position.array, snow = S.look.weather === "snow";
  const c = cam.position, R = 26, H = 22, speed = snow ? 1.2 : 14, len = snow ? 0.05 : 0.5;
  for (let i = 0; i < PCOUNT; i++) {
    const sx = pSeed[i * 3], sy = pSeed[i * 3 + 1], sz = pSeed[i * 3 + 2];
    const x = c.x + (sx - 0.5) * R * 2 + (snow ? Math.sin(t + i) * 0.6 : 0), z = c.z + (sz - 0.5) * R * 2;
    let y = ((sy * H - t * speed) % H + H) % H; y += Math.max(0, c.y - H / 2);
    pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z; pos[i * 6 + 3] = x + (snow ? 0.04 : 0.05); pos[i * 6 + 4] = y - len; pos[i * 6 + 5] = z;
  }
  pGeo.attributes.position.needsUpdate = true;
}
function focusShadows(center) {
  const d = sun.userData.dir || new THREE.Vector3(0.5, 0.8, 0.3);
  sun.target.position.copy(center); sun.position.copy(center).addScaledVector(d, 120);
}

/* ---------- cameras & cuts ---------- */
function activeCamId(t = T) { return U.cutCamAt(S, t); }
function activeCamObj(t = T) {
  let o = objs.get(activeCamId(t));
  if (!o) { const c = S.blocks.find(b => b.cam); if (c) { S.camId = c.id; o = objs.get(c.id); } }
  return o || null;
}
function syncShotCam(cam, asp, t = T) {
  const o = activeCamObj(t); if (!o) return null;
  o.root.updateMatrixWorld();
  cam.position.copy(o.root.position); cam.quaternion.copy(o.root.quaternion);
  cam.fov = U.vfovFor(o.curLens || o.b.cam.lens, asp); cam.aspect = asp; cam.far = 3000;
  return o;
}

/* ---------- viewport sizing ---------- */
let W = 1, H = 1, frameRect = { x: 0, y: 0, w: 1, h: 1 };
function resize() {
  const r = vpEl.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
  renderer.setSize(W, H, false);
  freeCam.aspect = W / H; freeCam.updateProjectionMatrix();
  const half = 40; topCam.left = -half * W / H; topCam.right = half * W / H; topCam.top = half; topCam.bottom = -half; topCam.updateProjectionMatrix();
  layoutFrame();
}
function layoutFrame() {
  if (!S) return;
  const sa = U.aspectNum(S.aspect), m = 0.92; let fw, fh;
  if (W / H > sa) { fh = H * m; fw = fh * sa; } else { fw = W * m; fh = fw / sa; }
  frameRect = { x: (W - fw) / 2, y: (H - fh) / 2, w: fw, h: fh };
  Object.assign($("#frame").style, { left: frameRect.x + "px", top: frameRect.y + "px", width: fw + "px", height: fh + "px" });
}
new ResizeObserver(resize).observe(vpEl);
function displayCam() { return view === "top" ? topCam : view === "shot" ? viewCam : freeCam; }

/* ---------- selection, tools ---------- */
function attachSel() {
  const o = sel && objs.get(sel);
  tc.camera = displayCam();
  if (!o || o.b.locked || tool === "walk" || exporting || (tool === "scale" && o.b.cam)) tc.detach(); else tc.attach(o.root);
  tc.setMode(tool === "rotate" ? "rotate" : tool === "scale" ? "scale" : "translate");
  tc.setSpace(tool === "scale" ? "local" : "world");
  selBox.visible = !!o && !o.b.hidden && kindOf(o.b) !== "ground";
  updateHint();
}
function select(id, opts = {}) { sel = id; attachSel(); renderBlocks(); renderEdit(); renderTicks(); if (opts.openEdit && id) setTab("edit"); }
function setTool(t) { tool = t; document.querySelectorAll("#toolSeg button").forEach(b => b.classList.toggle("on", b.dataset.tool === t)); orbit.enabled = view === "free" && t !== "walk"; orbitTop.enabled = view === "top" && t !== "walk"; attachSel(); }
function setView(v) {
  view = v; document.querySelectorAll("#viewSeg button").forEach(b => b.classList.toggle("on", b.dataset.view === v));
  orbit.enabled = v === "free" && tool !== "walk"; orbitTop.enabled = v === "top" && tool !== "walk";
  $("#frame").hidden = v !== "shot";
  if (v === "shot" && !activeCamObj()) toast("Add a camera first (Add tab, Camera), or let Direct plan the shots.");
  attachSel();
}
function updateHint() {
  const o = sel && objs.get(sel); let h;
  if (recording) h = tool === "walk" ? `Recording ${o.b.label}. Drag to move it, tap Rec to stop.` : `Recording ${o.b.label}. Move it with the gizmo, tap Rec to stop.`;
  else if (!o) h = view === "shot" ? "Looking through the camera. Tap a block to select it." : "Tap a block to select it. Drag empty space to look around.";
  else if (o.b.locked) h = `${o.b.label} is locked. Unlock it in Edit to move it.`;
  else if (tool === "walk") h = o.b.cam && view === "shot" ? `Drag to fly ${o.b.label}: up/down dollies, left/right trucks.` : `Drag on the ground to walk ${o.b.label}. Press Rec to capture it. Switch to Move to look around.`;
  else h = `${o.b.label} selected. ${o.b.keys.length ? "Moves add a key at the playhead." : "Drag the handles to place it."}`;
  $("#hint").textContent = h;
}
const ndc = new THREE.Vector2();
function setNdc(ev) { const r = renderer.domElement.getBoundingClientRect(); ndc.set((ev.clientX - r.left) / r.width * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); }
function pickBlock(ev) {
  setNdc(ev); raycaster.setFromCamera(ndc, displayCam());
  const meshes = []; const acid = activeCamId();
  for (const o of objs.values()) { if (o.b.hidden || o.b.locked || !o.root.visible) continue; if (view === "shot" && o.b.id === acid) continue; o.body.traverse(n => { if (n.isMesh) meshes.push(n); }); }
  const hit = raycaster.intersectObjects(meshes, false)[0];
  return hit ? hit.object.userData.id : null;
}
function floorPoint(ev, y) { setNdc(ev); raycaster.setFromCamera(ndc, displayCam()); const pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), out = new THREE.Vector3(); return raycaster.ray.intersectPlane(pl, out) ? out : null; }
let ptr = null, walk = null;
const cvs = renderer.domElement;
cvs.addEventListener("pointerdown", ev => {
  if (exporting || !ev.isPrimary || tc.axis) return;
  ptr = { x: ev.clientX, y: ev.clientY, t: performance.now(), moved: false };
  if (tool !== "walk") return;
  const id = pickBlock(ev);
  if (id && id !== sel && !recording) select(id);
  const o = sel && objs.get(sel); if (!o || o.b.locked) return;
  cvs.setPointerCapture(ev.pointerId);
  const rel = !!(o.b.cam && view === "shot"), y = o.root.position.y, hit = rel ? null : floorPoint(ev, y), grabbed = id === o.b.id;
  const off = hit && grabbed ? hit.clone().sub(o.root.position) : new THREE.Vector3(); off.y = 0;
  walk = { id: o.b.id, rel, y, off, target: o.root.position.clone(), lx: ev.clientX, ly: ev.clientY, moved: false };
  if (!grabbed && hit && !rel) walk.target.set(hit.x, y, hit.z);
  dragging = o.b.id; o.liveSpeed = 0;
  if (!recording) pushUndo();
});
cvs.addEventListener("pointermove", ev => {
  if (ptr && Math.hypot(ev.clientX - ptr.x, ev.clientY - ptr.y) > 6) ptr.moved = true;
  if (!walk) return; const o = objs.get(walk.id); if (!o) return; walk.moved = true;
  if (walk.rel) {
    const dx = ev.clientX - walk.lx, dy = ev.clientY - walk.ly; walk.lx = ev.clientX; walk.ly = ev.clientY;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(o.root.quaternion); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, _up).normalize();
    walk.target.addScaledVector(fwd, -dy * 0.015).addScaledVector(right, dx * 0.015);
  } else { const p = floorPoint(ev, walk.y); if (p) walk.target.set(p.x - walk.off.x, walk.y, p.z - walk.off.z); }
});
function endPointer(ev) {
  if (walk) { const id = walk.id, moved = walk.moved; walk = null; if (!recording) { dragging = null; if (moved) commitPose(id, true); else { undoStack.pop(); uiUndo(); } } }
  else if (ptr && !ptr.moved && performance.now() - ptr.t < 500 && !tc.dragging) { const id = pickBlock(ev); if (!recording) select(id); }
  ptr = null;
}
cvs.addEventListener("pointerup", endPointer);
cvs.addEventListener("pointercancel", () => { if (walk && !recording) { dragging = null; commitPose(walk.id, true); } walk = null; ptr = null; });
const FACERS = new Set(["actor", "animal", "vehicle", "boat", "aircraft"]);
function stepWalk(dt) {
  if (!walk) return; const o = objs.get(walk.id); if (!o) return;
  const prev = o.root.position.clone(); o.root.position.lerp(walk.target, 1 - Math.exp(-dt * 9));
  const v = o.root.position.clone().sub(prev); v.y = 0; const sp = v.length() / Math.max(dt, 1e-3);
  if (FACERS.has(kindOf(o.b)) && sp > 0.35 && !walk.rel) {
    const yaw = Math.atan2(v.x, v.z), cur = o.root.rotation.y, d = ((yaw - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    o.root.rotation.y = cur + d * (1 - Math.exp(-dt * 8));
  }
}
function commitPose(id, fromWalk = false) {
  const o = objs.get(id); if (!o) return; const b = o.b;
  if (!fromWalk) pushUndo();
  if (tool === "scale" && !fromWalk && !b.cam) { const s = o.root.scale; b.size = b.size.map((v, i) => Math.max(0.01, r2(v * Math.abs(s.getComponent(i))))); o.root.scale.set(1, 1, 1); rebuildObj(b); }
  const pose = objPose(objs.get(id) || o);
  if (b.keys.length) setKey(b, T, pose, 1); else { b.pos = pose.p.map(r3); b.rot = pose.r.map(r1); }
  rebuildPath(objs.get(id)); changed(); renderEdit(); renderTicks(); renderBlocks();
}
function objPose(o) { return { p: o.root.position.toArray(), r: [o.root.rotation.x * R2D, o.root.rotation.y * R2D, o.root.rotation.z * R2D], l: o.curLens }; }
function setKey(b, t, pose, ease = 1) {
  const tol = 0.5 / S.fps, k = { t: r3(t), p: pose.p.map(r3), r: pose.r.map(r1), e: ease };
  if (b.cam) k.l = r1(pose.l ?? b.cam.lens);
  const i = b.keys.findIndex(x => Math.abs(x.t - t) < tol);
  if (i >= 0) b.keys[i] = k; else { b.keys.push(k); b.keys.sort((a, c) => a.t - c.t); }
}

/* ---------- recording ---------- */
function startRec() {
  const o = sel && objs.get(sel);
  if (!o) { toast("Select a block first, then press Rec."); return; }
  if (o.b.locked) { toast(`${o.b.label} is locked. Unlock it in Edit first.`); return; }
  if (T >= S.duration - 0.05) T = 0;
  pushUndo(); o.liveDist = distAt(o, T);
  recording = { id: o.b.id, t0: T, samples: [{ t: T, ...objPose(o) }] };
  playing = true; uiPlay();
}
function stopRec() {
  const r = recording; if (!r) return;
  recording = null; playing = false; dragging = null; walk = null;
  const o = objs.get(r.id); const smp = r.samples; if (!o || smp.length < 2) { uiPlay(); return; }
  const t1 = smp[smp.length - 1].t, keys = simplify(smp), b = o.b;
  b.keys = b.keys.filter(k => k.t < r.t0 - 1e-3 || k.t > t1 + 1e-3);
  for (const k of keys) b.keys.push({ t: r3(k.t), p: k.p.map(r3), r: k.r.map(r1), e: 0, ...(b.cam ? { l: r1(k.l ?? b.cam.lens) } : {}) });
  b.keys.sort((a, c) => a.t - c.t);
  rebuildPath(o); changed(); uiPlay(); renderTicks(); renderEdit(); renderBlocks(); updateHint();
  toast(`Recorded ${r1(t1 - r.t0)}s of motion for ${b.label}.`);
}
function simplify(s) {
  const tolP = 0.015, tolR = 1.2, tolL = 0.4;
  const fits = (a, c, m) => { const u = (m.t - a.t) / Math.max(1e-6, c.t - a.t); for (let i = 0; i < 3; i++) { if (Math.abs(a.p[i] + (c.p[i] - a.p[i]) * u - m.p[i]) > tolP) return false; const dd = (((U.lerpAng(a.r[i], c.r[i], u) - m.r[i]) % 360) + 540) % 360 - 180; if (Math.abs(dd) > tolR) return false; } if (a.l != null && c.l != null && m.l != null && Math.abs(a.l + (c.l - a.l) * u - m.l) > tolL) return false; return true; };
  const out = [s[0]]; let a = 0;
  for (let j = 2; j < s.length; j++) { let ok = true; for (let i = a + 1; i < j; i++) if (!fits(s[a], s[j], s[i])) { ok = false; break; } if (!ok) { out.push(s[j - 1]); a = j - 1; } }
  out.push(s[s.length - 1]); return out;
}

/* ---------- loop ---------- */
const clock = new THREE.Clock(); let frameN = 0, wallT = 0;
function updateLabels() {
  for (const o of objs.values()) {
    if (!o.label) continue;
    o.label.visible = o.root.visible && o.b.showLabel;
    if (!o.label.visible) continue;
    const b = o.b; o.label.position.copy(o.root.position);
    o.label.position.y += b.cam ? 0.28 : Math.abs(b.rot[0]) > 45 ? 0.12 : b.size[1] + 0.16;
  }
}
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, clock.getDelta()); wallT += dt;
  if (exporting) return;
  if (playing) { T += dt; if (T >= S.duration) { T = S.duration; if (recording) stopRec(); else { playing = false; uiPlay(); } } }
  for (const id of [walk && walk.id, recording && recording.id].filter(Boolean)) { const o = objs.get(id); if (o) o._prev = o.root.position.clone(); }
  stepWalk(dt);
  for (const id of [walk && walk.id, recording && recording.id].filter(Boolean)) { const o = objs.get(id); if (o && o._prev) { const d = Math.hypot(o.root.position.x - o._prev.x, o.root.position.z - o._prev.z); o.liveDist += d; o.liveSpeed = o.liveSpeed * 0.8 + (d / Math.max(dt, 1e-3)) * 0.2; } }
  evalAll(T);
  if (recording) { const o = objs.get(recording.id); if (o) recording.samples.push({ t: T, ...objPose(o) }); }
  updateLabels();
  const so = sel && objs.get(sel);
  if (so && selBox.visible) { selBox.box.setFromObject(so.body); if (selBox.box.isEmpty()) selBox.visible = false; }
  if (view === "free") orbit.update(); else if (view === "top") orbitTop.update();
  render();
  if (++frameN % 4 === 0) { uiTime(); if (playing || walk || dragging) syncPoseFields(); }
}
function render() {
  const cam = displayCam();
  if (view === "shot") {
    const o = syncShotCam(viewCam, U.aspectNum(S.aspect));
    if (o) { viewCam.setViewOffset(frameRect.w, frameRect.h, -frameRect.x, -frameRect.y, W, H); viewCam.updateProjectionMatrix(); }
    viewCam.layers.set(0); viewCam.layers.enable(3); if (S.labelsInShot) viewCam.layers.enable(1);
    tc.camera = viewCam;
    $("#ftag").textContent = o ? `${o.b.label} · ${Math.round(o.curLens || o.b.cam.lens)}MM · ${S.aspect}` : "NO CAMERA";
    focusShadows(o ? o.root.position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(o.root.quaternion).multiplyScalar(18)).setY(0) : orbit.target);
  } else focusShadows(view === "top" ? orbitTop.target : orbit.target);
  const acid = activeCamId();
  for (const o of objs.values()) if (o.frust) { o.frust.visible = !(view === "shot" && o.b.id === acid); o.frust.material.color.set(o.b.id === acid ? 0xd1aa5e : 0x8f887a); }
  updateParticles(view === "shot" ? viewCam : cam, T + wallT * 0.0);
  setLabelScale(cam, 0.04);
  renderer.render(scene, cam);
}

/* ---------- undo / storage ---------- */
const undoStack = [], redoStack = [];
function pushUndo() { undoStack.push(JSON.stringify(S)); if (undoStack.length > 40) undoStack.shift(); redoStack.length = 0; uiUndo(); }
function undo() { if (!undoStack.length || recording) return; redoStack.push(JSON.stringify(S)); S = JSON.parse(undoStack.pop()); afterLoad(); changed(true); }
function redo() { if (!redoStack.length || recording) return; undoStack.push(JSON.stringify(S)); S = JSON.parse(redoStack.pop()); afterLoad(); changed(true); }
function uiUndo() { $("#bUndo").disabled = !undoStack.length; $("#bRedo").disabled = !redoStack.length; }
let saveTimer = null;
function setStatus(txt, cls) { const s = $("#status"); s.textContent = txt; s.className = "status " + (cls || ""); }
function changed() {
  if (S.example) { S.example = false; renderName(); }
  uiUndo(); setStatus("Unsaved", "warn");
  clearTimeout(saveTimer); saveTimer = setTimeout(saveLocal, 700);
}
function sceneIndex() { try { return JSON.parse(lsGet("br2.index") || "[]"); } catch (e) { return []; } }
function saveLocal() {
  const json = JSON.stringify(S);
  if (!lsSet("br2.s." + S.id, json)) { setStatus("Storage full", "warn"); toast("Browser storage is full. Delete old scenes in Scenes, or save this one as .json from Export."); return; }
  const idx = sceneIndex().filter(x => x.id !== S.id); idx.unshift({ id: S.id, name: S.name, updatedAt: Date.now() }); lsSet("br2.index", JSON.stringify(idx.slice(0, 200)));
  lsSet("br2.current", S.id); setStatus("Saved", "ok");
}
function migrate(s) {
  const d = BR.baseScene();
  for (const k of Object.keys(d)) if (s[k] === undefined) s[k] = d[k];
  s.look = Object.assign({}, d.look, s.look || {});
  s.blocks = (s.blocks || []).filter(b => b && (CAT[b.type] || b.shape)).map(b => {
    if (!b.type && b.shape) b.type = { figure: "man", pill: "resin_pill", pebble: "resin_pebble", blob: "resin_blob", dome: "resin_dome", card: "card", box: "box", pillar: "pillar", wall: "wall_block", door: "door_frame", ramp: "ramp", stairs: "stairs", floor: "ground_clay", camera: "camera" }[b.shape] || "box";
    return Object.assign({ notes: "", keys: [], poses: [], vis: [], showLabel: true, guide: false, locked: false, hidden: false, img: null, rot: [0, 0, 0], pos: [0, 0, 0], seed: 1 }, b);
  });
  s.blocks.forEach(b => { if (CAT[b.type] && CAT[b.type].camera && !b.cam) b.cam = { lens: 35, lookAt: null, aim: 0.85 }; });
  return s;
}
function afterLoad() { S = migrate(S); T = Math.min(T, S.duration); rebuildAll(); layoutFrame(); renderAll(); }
function loadScene(s, resetHistory = true) { S = s; if (resetHistory) { undoStack.length = 0; redoStack.length = 0; } T = 0; playing = false; sel = null; afterLoad(); uiUndo(); frameScene(); }
function frameScene() {
  const story = S.blocks.filter(b => b.ai === "story" || (!b.ai && !["ground"].includes(kindOf(b)) && !b.cam));
  let cx = 0, cz = 0, n = 0; for (const b of story) { cx += b.pos[0]; cz += b.pos[2]; n++; }
  if (n) { cx /= n; cz /= n; }
  orbit.target.set(cx, 1, cz); freeCam.position.set(cx + 5, 30, cz + 32); orbitTop.target.set(cx, 0, cz); topCam.position.set(cx, 400, cz);
}

/* ---------- timeline UI ---------- */
function uiTime() { $("#tc").innerHTML = `${T.toFixed(2).padStart(5, "0")} <small>/ ${S.duration.toFixed(2).padStart(5, "0")}</small>`; const sc = $("#scrub"); if (document.activeElement !== sc || playing) sc.value = T; }
function uiPlay() {
  $("#bPlay").innerHTML = playing ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z"/></svg>';
  const rb = $("#bRec"); rb.classList.toggle("on", !!recording); rb.querySelector("span").textContent = recording ? "Stop" : "Rec";
  $("#recBadge").hidden = !recording; updateHint();
}
function renderTicks() {
  const el = $("#ticks"), b = sel && S.blocks.find(x => x.id === sel);
  el.innerHTML = !b || !b.keys.length ? "" : b.keys.map(k => `<i class="${b.keys.length > 40 ? "dense" : ""}" style="left:${(k.t / S.duration * 100).toFixed(3)}%"></i>`).join("");
  $("#cutTicks").innerHTML = (S.cuts || []).filter(c => c.t > 0.01).map(c => `<i style="left:${(c.t / S.duration * 100).toFixed(3)}%"></i>`).join("");
}
function renderRuler() { const d = S.duration, step = d <= 6 ? 1 : d <= 15 ? 2 : d <= 40 ? 5 : 10; let h = ""; for (let s = 0; s <= d + 1e-6; s += step) h += `<span style="left:${(s / d * 100).toFixed(2)}%">${s}s</span>`; $("#ruler").innerHTML = h; $("#scrub").max = d; $("#scrub").step = 1 / S.fps; }
$("#scrub").addEventListener("input", e => { if (recording) return; playing = false; uiPlay(); T = +e.target.value; evalAll(T); uiTime(); syncPoseFields(); });
$("#bPlay").onclick = () => { if (recording) { stopRec(); return; } if (!playing && T >= S.duration - 0.01) T = 0; playing = !playing; uiPlay(); };
$("#bStart").onclick = () => { if (recording) return; T = 0; playing = false; uiPlay(); evalAll(0); uiTime(); syncPoseFields(); };
$("#bRec").onclick = () => recording ? stopRec() : startRec();
$("#bKey").onclick = keyNow; $("#bDelK").onclick = delKey; $("#bPrevK").onclick = () => jumpKey(-1); $("#bNextK").onclick = () => jumpKey(1);
function keyNow() { const o = sel && objs.get(sel); if (!o) { toast("Select a block to key it."); return; } pushUndo(); setKey(o.b, T, objPose(o), 1); rebuildPath(o); changed(); renderTicks(); renderEdit(); renderBlocks(); updateHint(); toast(`Key set for ${o.b.label} at ${T.toFixed(2)}s.`); }
function delKey() { const o = sel && objs.get(sel); if (!o) return; const tol = 0.5 / S.fps, i = o.b.keys.findIndex(k => Math.abs(k.t - T) < tol); if (i < 0) { toast("No key at the playhead. Use the arrows to jump to one."); return; } pushUndo(); if (o.b.keys.length === 1) { const p = objPose(o); o.b.pos = p.p.map(r3); o.b.rot = p.r.map(r1); } o.b.keys.splice(i, 1); rebuildPath(o); changed(); renderTicks(); renderEdit(); renderBlocks(); }
function jumpKey(dir) { const b = sel && S.blocks.find(x => x.id === sel); if (!b || !b.keys.length) return; const ts = b.keys.map(k => k.t); const t = dir > 0 ? ts.find(x => x > T + 1e-3) : [...ts].reverse().find(x => x < T - 1e-3); if (t == null) return; playing = false; uiPlay(); T = t; evalAll(T); uiTime(); syncPoseFields(); }

/* ---------- tabs ---------- */
let curTab = "direct";
function setTab(t) { curTab = t; document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === t)); ["direct", "add", "blocks", "edit", "shot", "export"].forEach(n => $("#tab-" + n).hidden = n !== t); if (t === "export") renderExport(); if (t === "add") renderAdd(); }
document.querySelector(".tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setTab(b.dataset.tab); });
$("#viewSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setView(b.dataset.view); });
$("#toolSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setTool(b.dataset.tool); });

/* ======================================================================
   DIRECT TAB (AI)
   ====================================================================== */
let health = null, aiBusy = false, aiAbort = null;
const EXAMPLES = ["Rainy night chase down a city street: a woman runs from two men, a police car cuts them off, helicopter circling overhead", "Golden hour beach music video: a singer walks along the shoreline, three dancers behind her, yacht passing", "Dawn at the harbour: a cargo ship docks, a forklift drives between containers, a dockworker waves it in", "Desert road: a red sports car races toward camera, a helicopter tracks it from above", "Concert stage: singer at the mic, drummer behind, crowd jumping, slow orbit around the singer", "Quiet suburban morning: a boy cycles past houses, a dog chases him, his mum waves from the porch"];
function renderDirect() {
  const m = settings.model, isCustom = !MODELS.some(x => x[0] === m && x[0] !== "custom");
  const plan = S.plan;
  $("#tab-direct").innerHTML = `
    ${health && !health.hasKey ? `<div class="setup"><b>One more step in Vercel.</b> In your Blockroom project, open Settings, Environment Variables, add <code>OPENROUTER_API_KEY</code> with your OpenRouter key, then redeploy.</div>` : ""}
    ${health === false ? `<div class="setup">The AI route is not reachable from here. Open Blockroom from its Vercel address to use Direct.</div>` : ""}
    <label class="field"><span>Describe the scene you want</span><textarea class="in brief" id="dBrief" placeholder="Who is in it, where it happens, what they do, the mood, and how the camera should feel.">${esc(lsGet("br2.brief") || "")}</textarea></label>
    <div class="chips">${EXAMPLES.map((x, i) => `<button data-ex="${i}">${esc(x.split(":")[0])}</button>`).join("")}</div>
    <div class="trio"><label>LENGTH S<input class="in" type="number" id="dDur" min="3" max="60" step="1" value="${S.duration}"></label><label>ASPECT<select class="in" id="dAsp">${BR.ENUMS.ASPECTS.map(a => `<option ${S.aspect === a ? "selected" : ""}>${a}</option>`).join("")}</select></label><label>COVERAGE<select class="in" id="dTakes"><option value="auto" ${settings.takes === "auto" ? "selected" : ""}>AI decides</option><option value="single" ${settings.takes === "single" ? "selected" : ""}>One take</option><option value="multi" ${settings.takes === "multi" ? "selected" : ""}>Several shots</option></select></label></div>
    <div class="field" style="margin-top:10px"><span>Model on OpenRouter</span><select class="in" id="dModel">${MODELS.map(([id, n]) => `<option value="${id}" ${(id === m) || (id === "custom" && isCustom) ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <label class="field" ${isCustom ? "" : "hidden"} id="dCustomWrap"><span>Custom model ID</span><input class="in" id="dCustom" value="${esc(isCustom ? m : settings.custom)}" placeholder="provider/model-name" autocomplete="off"></label>
    <div class="btns"><button class="btn primary" id="dGo" ${aiBusy ? "disabled" : ""}>Direct the scene</button>${aiBusy ? `<button class="btn" id="dStop">Stop</button>` : ""}</div>
    <div class="aistatus" id="dStatus"></div>
    ${plan ? `<div class="summary"><b>${esc(plan.title || S.name)}</b>${esc(plan.summary || "")}</div>
      <h3>Change it</h3>
      <textarea class="in" id="dAdjust" rows="3" placeholder="e.g. Make it golden hour, add a dog that follows her, end on a close-up."></textarea>
      <div class="btns"><button class="btn" id="dAdjustGo" ${aiBusy ? "disabled" : ""}>Apply change</button></div>
      <p class="note">Changes rebuild the AI-made parts of the scene. Blocks you added yourself stay.</p>` : ""}`;
}
const tabDirect = $("#tab-direct");
tabDirect.addEventListener("click", e => {
  const ex = e.target.closest("[data-ex]"); if (ex) { $("#dBrief").value = EXAMPLES[+ex.dataset.ex]; lsSet("br2.brief", $("#dBrief").value); return; }
  const t = e.target.closest("button"); if (!t) return;
  if (t.id === "dGo") runDirector(false);
  if (t.id === "dAdjustGo") runDirector(true);
  if (t.id === "dStop" && aiAbort) aiAbort.abort();
});
tabDirect.addEventListener("input", e => { if (e.target.id === "dBrief") lsSet("br2.brief", e.target.value); });
tabDirect.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "dModel") { if (t.value === "custom") { $("#dCustomWrap").hidden = false; settings.model = $("#dCustom").value.trim() || settings.custom || ""; } else { settings.model = t.value; $("#dCustomWrap").hidden = true; } saveSettings(); }
  if (t.id === "dCustom") { settings.custom = t.value.trim(); settings.model = settings.custom; saveSettings(); }
  if (t.id === "dTakes") { settings.takes = t.value; saveSettings(); }
});
function dStatus(msg, cls) { const el = $("#dStatus"); if (el) { el.textContent = msg; el.className = "aistatus " + (cls || ""); } }
async function runDirector(adjust) {
  if (aiBusy) return;
  const brief = ($("#dBrief") || {}).value?.trim() || "";
  const instruction = adjust ? ($("#dAdjust") || {}).value?.trim() : "";
  if (!adjust && brief.length < 8) { dStatus("Describe the scene first.", "err"); return; }
  if (adjust && !instruction) { dStatus("Say what to change.", "err"); return; }
  const model = settings.model || MODELS[0][0];
  const duration = clamp(+($("#dDur") || {}).value || S.duration, 3, 60), aspect = ($("#dAsp") || {}).value || S.aspect;
  const messages = BR.buildMessages({ brief, duration, aspect, takes: settings.takes, prevPlan: adjust ? S.plan : null, instruction });
  aiBusy = true; aiAbort = new AbortController(); renderDirect();
  if ($("#dBrief")) $("#dBrief").value = brief;
  const t0 = performance.now(); const tick = setInterval(() => dStatus(`${adjust ? "Changing" : "Directing"} with ${model}… ${Math.round((performance.now() - t0) / 1000)}s`), 500);
  try {
    const timeout = setTimeout(() => aiAbort.abort(), 295000);
    const res = await fetch("api/direct", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ model, messages, schema: BR.planSchema() }), signal: aiAbort.signal });
    clearTimeout(timeout);
    let data; try { data = await res.json(); } catch (e) { throw new Error(`The AI route answered with HTTP ${res.status}.`); }
    if (res.status === 401) { setTimeout(() => location.reload(), 1800); throw new Error(data.error || "Locked."); }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const plan = BR.parsePlan(data.content);
    pushUndo();
    const keepId = S.id, keepName = S.name, own = S.blocks.filter(b => !b.ai && !CAT[b.type]?.ground);
    const S2 = BR.compilePlan(plan, { brief, duration, aspect });
    if (adjust) { S2.id = keepId; }
    S2.blocks.push(...own);
    loadScene(S2, false); changed();
    setView("shot"); T = 0; playing = true; uiPlay();
    clearInterval(tick);
    const secs = Math.round((performance.now() - t0) / 1000);
    renderDirect();
    dStatus(`Done in ${secs}s with ${data.model || model}${data.cost ? `, cost $${(+data.cost).toFixed(3)}` : ""}${data.fallback ? " (plain JSON mode)" : ""}.`, "ok");
    toast(adjust ? "Scene updated. Playing it through the camera." : "Scene directed. Playing it through the camera.");
  } catch (err) {
    clearInterval(tick); aiBusy = false; renderDirect();
    dStatus(err.name === "AbortError" ? "Stopped." : `Could not direct: ${err.message}`, "err");
  } finally { aiBusy = false; aiAbort = null; const g = $("#dGo"); if (g) g.disabled = false; const a = $("#dAdjustGo"); if (a) a.disabled = false; const st = $("#dStop"); if (st) st.remove(); }
}
async function checkHealth() {
  try { const r = await fetch("api/direct", { method: "GET" }); if (!r.ok) throw 0; health = await r.json(); } catch (e) { health = false; }
  if (curTab === "direct") { const keep = $("#dBrief") ? $("#dBrief").value : null; renderDirect(); if (keep != null) $("#dBrief").value = keep; }
}

/* ======================================================================
   ADD TAB (catalogue with live thumbnails)
   ====================================================================== */
let addCat = "People", addQuery = "";
const thumbs = new Map();
let thumbR = null, thumbScene = null, thumbCam = null, thumbQueue = [], thumbBusy = false;
function thumbFor(type) {
  if (thumbs.has(type)) return thumbs.get(type);
  if (!thumbQueue.includes(type)) thumbQueue.push(type);
  if (!thumbBusy) requestAnimationFrame(drainThumbs);
  return null;
}
function drainThumbs() {
  thumbBusy = true;
  if (!thumbR) {
    const c = document.createElement("canvas"); c.width = c.height = 112;
    thumbR = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true }); thumbR.outputEncoding = THREE.sRGBEncoding; thumbR.setClearColor(0x000000, 0);
    thumbScene = new THREE.Scene(); thumbScene.add(new THREE.HemisphereLight(0xffffff, 0x8a857a, 1.0)); const d = new THREE.DirectionalLight(0xffffff, 0.9); d.position.set(3, 5, 4); thumbScene.add(d);
    thumbCam = new THREE.PerspectiveCamera(30, 1, 0.01, 5000);
  }
  const start = performance.now();
  while (thumbQueue.length && performance.now() - start < 30) {
    const type = thumbQueue.shift(); const cat = CAT[type]; if (!cat) continue;
    let url = "";
    try {
      const b = BR.newBlock(type, { label: cat.sign || cat.name.toUpperCase(), seed: 3 });
      const body = cat.camera ? buildCamera(b) : cat.card ? buildCard(b) : buildBody(b);
      body.traverse(n => n.layers.set(0));
      if (body.userData.anim && body.userData.anim.rig) BR.poseHuman((body.userData.inner || body).userData.rig, { pose: "auto", t: 0 });
      thumbScene.add(body); const box = new THREE.Box3().setFromObject(body); const sz = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
      const r = Math.max(sz.x, sz.y, sz.z) * 0.62 || 1; const dist = r / Math.tan(15 * D2R);
      thumbCam.position.set(ctr.x + dist * 0.55, ctr.y + dist * 0.42, ctr.z + dist * 0.72); thumbCam.near = dist / 50; thumbCam.far = dist * 10; thumbCam.updateProjectionMatrix(); thumbCam.lookAt(ctr);
      thumbR.render(thumbScene, thumbCam); url = thumbR.domElement.toDataURL("image/png");
      thumbScene.remove(body); disposeTree(body);
    } catch (e) { url = ""; }
    thumbs.set(type, url);
    document.querySelectorAll(`img[data-thumb="${type}"]`).forEach(im => { if (url) im.src = url; });
  }
  if (thumbQueue.length) requestAnimationFrame(drainThumbs); else thumbBusy = false;
}
function renderAdd() {
  const cats = ["Whole sets", ...BR.CATEGORIES];
  const q = addQuery.trim().toLowerCase();
  let body = "";
  if (!q && addCat === "Whole sets") body = `<p class="lede">Drop in a whole environment. It lands at the centre of your view.</p><div class="kits">${Object.entries(BR.KITS).map(([k, v]) => `<button class="kit" data-kit="${k}"><b>${esc(v.name)}</b><span>${esc(v.desc)}</span></button>`).join("")}</div>`;
  else {
    const items = BR.CATALOG.filter(c => q ? (c.name + " " + c.type + " " + c.cat).toLowerCase().includes(q) : c.cat === addCat);
    body = items.length ? `<div class="grid-add">${items.map(c => { const u = thumbs.get(c.type); if (!thumbs.has(c.type)) thumbFor(c.type); return `<button class="tile" data-add="${c.type}">${u ? `<img src="${u}" alt="" data-thumb="${c.type}">` : `<img alt="" data-thumb="${c.type}" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">`}<span>${esc(c.name)}</span></button>`; }).join("")}</div>` : `<div class="empty"><b>Nothing found</b>Try another word, like car, tree or shop.</div>`;
  }
  $("#tab-add").innerHTML = `<div class="search"><input class="in" id="aQ" type="search" placeholder="Search ${BR.CATALOG.length} items" value="${esc(addQuery)}" autocomplete="off"></div>
    ${q ? "" : `<div class="catpills">${cats.map(c => `<button data-cat="${esc(c)}" class="${c === addCat ? "on" : ""}">${esc(c)}</button>`).join("")}</div>`}${body}`;
}
$("#tab-add").addEventListener("input", e => { if (e.target.id === "aQ") { addQuery = e.target.value; const pos = e.target.selectionStart; renderAdd(); const q = $("#aQ"); q.focus(); q.setSelectionRange(pos, pos); } });
$("#tab-add").addEventListener("click", e => {
  const c = e.target.closest("[data-cat]"); if (c) { addCat = c.dataset.cat; renderAdd(); return; }
  const k = e.target.closest("[data-kit]"); if (k) { addKit(k.dataset.kit); return; }
  const a = e.target.closest("[data-add]"); if (a) addBlock(a.dataset.add);
});
function viewCentre() { const c = view === "top" ? orbitTop.target : orbit.target; return [Math.round(c.x * 2) / 2, Math.round(c.z * 2) / 2]; }
function addKit(name) {
  if (recording) return; pushUndo();
  const [cx, cz] = viewCentre(); const hasGround = S.blocks.some(b => CAT[b.type]?.ground);
  const specs = BR.buildKit(name, { seed: Math.floor(Math.random() * 9999) });
  let n = 0;
  for (const sp of specs) {
    const cat = CAT[sp.type]; if (!cat) continue;
    if (cat.ground && hasGround) continue;
    const b = BR.newBlock(sp.type, { ai: "kit", kit: name, pos: [r3(sp.x + cx), sp.y || 0, r3(sp.z + cz)], rot: [0, r1(sp.rot || 0), 0] });
    if (sp.size) b.size = sp.size.slice(); if (sp.color) b.color = sp.color; if (sp.color2) b.color2 = sp.color2; if (sp.sign) b.sign = sp.sign; if (sp.sidewalk === false) b.sidewalk = false; if (sp.showLabel === false) b.showLabel = false;
    if (cat.ground) { b.pos[1] = -b.size[1]; b.locked = true; }
    S.blocks.push(b); makeObj(b); n++;
  }
  evalAll(T); changed(); renderBlocks(); toast(`${BR.KITS[name].name} added (${n} pieces).`);
}
function addBlock(type) {
  if (recording) return; pushUndo();
  const cat = CAT[type]; const [cx, cz] = viewCentre();
  if (cat.crowd) {
    for (let i = 0; i < 10; i++) { const t = BR.pick(["man", "woman", "man", "woman", "elder", "child"]); const b = BR.newBlock(t, { label: `EXTRA ${i + 1}`, showLabel: false, pos: [r3(cx + (Math.random() - 0.5) * 6), 0, r3(cz + (Math.random() - 0.5) * 6)], rot: [0, r1(Math.random() * 360), 0], color: BR.pick(["#7a6a58", "#5a6a7a", "#8a5a4a", "#6a7a5a", "#9a8f80"]) }); S.blocks.push(b); makeObj(b); }
    evalAll(T); changed(); renderBlocks(); toast("Ten extras added."); return;
  }
  const same = S.blocks.filter(b => b.type === type).length;
  const b = BR.newBlock(type, { label: (cat.sign || cat.name.toUpperCase()).slice(0, 20) + (same ? ` ${same + 1}` : "") });
  if (!cat.ground) { b.pos = [r3(cx + (Math.random() - 0.5) * 0.8), 0, r3(cz + (Math.random() - 0.5) * 0.8)]; }
  else { b.pos = [0, -b.size[1], 0]; }
  if (cat.kind === "aircraft" && ["helicopter", "drone", "airliner", "small_plane", "fighter_jet", "blimp", "hot_air_balloon"].includes(type) && type !== "drone") b.pos[1] = 0;
  if (cat.camera) { const subj = S.blocks.find(x => kindOf(x) === "actor") || S.blocks.find(x => x.ai === "story"); b.pos = [r2(freeCam.position.x * 0.5 + cx * 0.5), 1.5, r2(freeCam.position.z * 0.5 + cz * 0.5)]; if (subj) b.cam.lookAt = subj.id; b.label = `CAM ${S.blocks.filter(x => x.cam).length + 1}`; if (!S.blocks.some(x => x.cam)) S.camId = b.id; }
  S.blocks.push(b); makeObj(b); evalAll(T);
  changed(); select(b.id); renderShot();
  toast(`${b.label} added. Name it and say what it stands for in Edit.`);
}

/* ======================================================================
   BLOCKS TAB
   ====================================================================== */
function rowHtml(b) {
  return `<div class="row ${b.id === sel ? "on" : ""}" data-sel="${b.id}" role="button" tabindex="0">
    <span class="dot" style="background:${esc(b.color)}"></span><span class="nm">${esc(b.label)}</span>
    ${b.keys.length ? `<span class="chip ${b.keys.some(k => k.e === 0) ? "rec" : ""}">moves</span>` : ""}
    ${b.id === activeCamId() ? `<span class="chip">live</span>` : ""}
    <span class="meta">${esc((catOf(b).name || "").slice(0, 16))}</span>
    <button class="mini" data-vis="${b.id}" title="${b.hidden ? "Show" : "Hide"}" aria-label="${b.hidden ? "Show" : "Hide"} ${esc(b.label)}">${b.hidden ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.6M6.6 6.7C3.9 8.4 2.5 12 2.5 12s3.5 6 9.5 6a9.6 9.6 0 0 0 4.4-1"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="3"/></svg>'}</button>
    <button class="mini" data-lock="${b.id}" title="${b.locked ? "Unlock" : "Lock"}" aria-label="${b.locked ? "Unlock" : "Lock"} ${esc(b.label)}">${b.locked ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>'}</button></div>`;
}
let setOpen = false;
function renderBlocks() {
  const el = $("#tab-blocks");
  if (!S.blocks.length) { el.innerHTML = `<div class="empty"><b>No blocks yet</b>Use Direct, or add pieces from Add.</div>`; return; }
  const cams = S.blocks.filter(b => b.cam), set = S.blocks.filter(b => b.ai === "kit" && !b.cam), cast = S.blocks.filter(b => !b.cam && b.ai !== "kit" && !b.crowdOf), crowd = S.blocks.filter(b => b.crowdOf);
  el.innerHTML = `<p class="lede">Tap to select. Cast and props become the legend in your prompt.</p>
    <h3>Cast and props (${cast.length})</h3><div class="list">${cast.map(rowHtml).join("") || `<p class="note">None yet.</p>`}</div>
    ${crowd.length ? `<details class="group"><summary>Extras (${crowd.length})</summary><div class="list">${crowd.map(rowHtml).join("")}</div></details>` : ""}
    <h3>Cameras (${cams.length})</h3><div class="list">${cams.map(rowHtml).join("") || `<p class="note">No camera yet.</p>`}</div>
    ${set.length ? `<details class="group" id="setGroup" ${setOpen ? "open" : ""}><summary>Set pieces (${set.length})</summary><div class="list">${setOpen ? set.map(rowHtml).join("") : ""}</div></details>` : ""}`;
  const sg = $("#setGroup"); if (sg) sg.addEventListener("toggle", () => { if (sg.open !== setOpen) { setOpen = sg.open; renderBlocks(); } });
}
$("#tab-blocks").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-sel]")) { e.preventDefault(); select(e.target.dataset.sel, { openEdit: true }); } });
$("#tab-blocks").addEventListener("click", e => {
  const v = e.target.closest("[data-vis]"), l = e.target.closest("[data-lock]"), r = e.target.closest("[data-sel]");
  if (v) { const b = S.blocks.find(x => x.id === v.dataset.vis); pushUndo(); b.hidden = !b.hidden; applyVis(objs.get(b.id)); attachSel(); changed(); renderBlocks(); return; }
  if (l) { const b = S.blocks.find(x => x.id === l.dataset.lock); pushUndo(); b.locked = !b.locked; attachSel(); changed(); renderBlocks(); renderEdit(); return; }
  if (r) select(r.dataset.sel, { openEdit: true });
});

/* ======================================================================
   EDIT TAB
   ====================================================================== */
function curBlock() { return sel ? S.blocks.find(b => b.id === sel) : null; }
function renderEdit() {
  const el = $("#tab-edit"), b = curBlock();
  if (!b) { el.innerHTML = `<div class="empty"><b>Nothing selected</b>Tap a block in the scene, or pick one in Blocks.</div>`; return; }
  const cat = catOf(b), p = U.poseAt(b, T), isCam = !!cat.camera, isActor = cat.kind === "actor";
  const sameCat = BR.CATALOG.filter(c => c.cat === cat.cat && !c.crowd);
  const others = S.blocks.filter(x => x.id !== b.id && !x.cam && !CAT[x.type]?.ground && x.ai !== "kit");
  const poseNow = U.poseNameAt(b, T);
  el.innerHTML = `
    <label class="field"><span>Label</span><input class="in" id="eLabel" value="${esc(b.label)}" maxlength="28" autocomplete="off"></label>
    <label class="field"><span>Stands for (goes into the prompt legend)</span><textarea class="in" id="eNotes" rows="2" placeholder="${isCam ? "e.g. handheld, slight shake" : "e.g. Kade, 30s, black tactical jacket, scar over left eye"}">${esc(b.notes)}</textarea></label>
    ${isCam ? `
      <h3>Lens</h3>
      <div class="slider"><input type="range" id="eLens" min="12" max="135" step="1" value="${Math.round(p.l ?? b.cam.lens)}"><output id="oLens">${Math.round(p.l ?? b.cam.lens)}mm</output></div>
      <div class="pills" style="margin:6px 0 10px">${[14, 18, 24, 28, 35, 50, 85, 135].map(l => `<button data-lens="${l}">${l}</button>`).join("")}</div>
      <label class="field"><span>Keep aimed at</span><select class="in" id="eLook"><option value="">Nothing (aim it yourself)</option>${others.map(x => `<option value="${x.id}" ${b.cam.lookAt === x.id ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select></label>
      ${b.cam.lookAt ? `<div class="field"><span>Aim height on subject</span><div class="slider"><input type="range" id="eAim" min="0" max="1.1" step="0.01" value="${b.cam.aim ?? 0.85}"><output id="oAim">${Math.round((b.cam.aim ?? 0.85) * 100)}%</output></div></div>` : ""}
      <div class="btns"><button class="btn" id="eCut">Cut to this camera at ${T.toFixed(2)}s</button></div>
    ` : `
      <h3>Look</h3>
      <div class="field"><span>Type</span><select class="in" id="eType">${sameCat.map(c => `<option value="${c.type}" ${c.type === b.type ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <div class="field"><span>Colour</span><div class="sw" id="eSw">${SWATCHES.map(([n, c]) => `<button data-col="${c}" title="${n}" aria-label="${n}" style="background:${c}" class="${b.color.toLowerCase() === c ? "on" : ""}"></button>`).join("")}<input type="color" id="eColor" value="${esc(b.color)}" aria-label="Custom colour"></div></div>
      ${cat.sign ? `<label class="field"><span>Sign text</span><input class="in" id="eSign" value="${esc(b.sign || "")}" maxlength="18"></label>` : ""}
      ${cat.card ? `<div class="field"><span>Picture on the card front</span><div class="btns"><button class="btn" id="eImg">${b.img ? "Replace picture" : "Add picture"}</button>${b.img ? `<button class="btn danger" id="eImgX">Remove</button>` : ""}</div></div>` : ""}
      <h3>Size (metres)</h3>
      <div class="trio"><label>WIDTH<input class="in" type="number" step="0.05" min="0.01" data-size="0" value="${b.size[0]}"></label><label>HEIGHT<input class="in" type="number" step="0.05" min="0.01" data-size="1" value="${b.size[1]}"></label><label>DEPTH<input class="in" type="number" step="0.05" min="0.005" data-size="2" value="${b.size[2]}"></label></div>
    `}
    <h3>Place${b.keys.length ? ` at ${T.toFixed(2)}s` : ""}</h3>
    <div class="trio"><label>X<input class="in" type="number" step="0.1" data-pos="0" value="${r2(p.p[0])}"></label><label>Y (up)<input class="in" type="number" step="0.1" data-pos="1" value="${r2(p.p[1])}"></label><label>Z<input class="in" type="number" step="0.1" data-pos="2" value="${r2(p.p[2])}"></label></div>
    <div class="trio" style="margin-top:6px"><label>TURN °<input class="in" type="number" step="5" data-rot="1" value="${r1(p.r[1])}"></label><label>TILT °<input class="in" type="number" step="5" data-rot="0" value="${r1(p.r[0])}"></label><label>ROLL °<input class="in" type="number" step="5" data-rot="2" value="${r1(p.r[2])}"></label></div>
    ${isActor ? `<h3>Pose from ${T.toFixed(2)}s</h3><select class="in" id="ePose">${Object.entries(POSE_NAMES).map(([k, n]) => `<option value="${k}" ${poseNow === k ? "selected" : ""}>${n}</option>`).join("")}</select><p class="note">Walking and running happen by themselves when the figure moves.${(b.poses || []).length ? ` ${(b.poses || []).length} pose change${b.poses.length > 1 ? "s" : ""} set.` : ""}</p>` : ""}
    <h3>Motion</h3>
    <p class="note">${b.keys.length ? `${b.keys.length} keys from ${b.keys[0].t.toFixed(2)}s to ${b.keys[b.keys.length - 1].t.toFixed(2)}s.` : "Not moving. Select it, press Rec and drag it with Walk, or set keys by hand."}</p>
    <div class="btns"><button class="btn" id="eKey">Key at ${T.toFixed(2)}s</button>${b.keys.length ? `<button class="btn" id="eShift">Shift motion…</button><button class="btn danger" id="eClear">Clear motion</button>` : ""}</div>
    <div id="eShiftBox" hidden><div class="slider"><input type="range" id="eShiftR" min="-3" max="3" step="0.05" value="0"><output id="oShift">+0.00s</output></div><div class="btns"><button class="btn primary" id="eShiftOk">Apply shift</button></div></div>
    <div class="btns"><button class="btn" id="eVis">${U.visAt(b, T) ? "Hide" : "Show"} from ${T.toFixed(2)}s</button>${(b.vis || []).length ? `<button class="btn" id="eVisClear">Always visible</button>` : ""}</div>
    <h3>Options</h3>
    <div class="checks">
      <label><input type="checkbox" id="eShowLabel" ${b.showLabel ? "checked" : ""}> Show label tag</label>
      ${isCam ? "" : `<label><input type="checkbox" id="eGuide" ${b.guide ? "checked" : ""}> Guide only (visible here, hidden in the shot)</label>`}
      <label><input type="checkbox" id="eLocked" ${b.locked ? "checked" : ""}> Locked</label>
    </div>
    <div class="btns"><button class="btn" id="eDup">Duplicate</button><button class="btn" id="eFocus">Frame in view</button><button class="btn danger" id="eDel">Delete</button></div>
    <div id="eDelConfirm" hidden><p class="note">Delete ${esc(b.label)} and its motion?</p><div class="btns"><button class="btn danger" id="eDelYes">Delete</button><button class="btn" id="eDelNo">Keep it</button></div></div>`;
}
function syncPoseFields() {
  if (curTab !== "edit") return; const b = curBlock(); if (!b) return; const o = objs.get(b.id); if (!o) return; const p = objPose(o);
  document.querySelectorAll("#tab-edit [data-pos]").forEach(i => { if (document.activeElement !== i) i.value = r2(p.p[+i.dataset.pos]); });
  document.querySelectorAll("#tab-edit [data-rot]").forEach(i => { if (document.activeElement !== i) i.value = r1(p.r[+i.dataset.rot]); });
  const lens = $("#eLens"); if (lens && document.activeElement !== lens && o.curLens) { lens.value = Math.round(o.curLens); $("#oLens").textContent = Math.round(o.curLens) + "mm"; }
}
let editOpen = false;
function beginEdit() { if (!editOpen) { pushUndo(); editOpen = true; } }
function endEdit() { if (editOpen) { editOpen = false; changed(); } }
const tabEdit = $("#tab-edit");
tabEdit.addEventListener("input", e => {
  const b = curBlock(); if (!b) return; const t = e.target, o = objs.get(b.id);
  if (t.id === "eLabel") { beginEdit(); b.label = t.value; if (o.label) { scene.remove(o.label); o.label.material.map.dispose(); o.label = null; } ensureLabel(o); renderBlocks(); return; }
  if (t.id === "eNotes") { beginEdit(); b.notes = t.value; return; }
  if (t.id === "eSign") { beginEdit(); b.sign = t.value; return; }
  if (t.id === "eLens") { beginEdit(); const v = +t.value; $("#oLens").textContent = v + "mm"; o.curLens = v; if (b.keys.length) { setKey(b, T, objPose(o), 1); renderTicks(); } else b.cam.lens = v; refreshFrustum(o); return; }
  if (t.id === "eAim") { beginEdit(); b.cam.aim = +t.value; $("#oAim").textContent = Math.round(t.value * 100) + "%"; return; }
  if (t.id === "eColor") { beginEdit(); b.color = t.value; rebuildObj(b); return; }
  if (t.id === "eShiftR") { $("#oShift").textContent = (t.value >= 0 ? "+" : "") + (+t.value).toFixed(2) + "s"; }
});
tabEdit.addEventListener("change", e => {
  const b = curBlock(); if (!b) return; const t = e.target, o = objs.get(b.id);
  if (["eLabel", "eNotes", "eLens", "eAim", "eColor"].includes(t.id)) { endEdit(); if (t.id === "eLens") rebuildPath(o); return; }
  if (t.id === "eSign") { endEdit(); rebuildObj(b); return; }
  if (t.id === "eShiftR") return;
  pushUndo();
  if (t.dataset.size != null) { b.size[+t.dataset.size] = r3(Math.max(0.005, +t.value || 0.01)); rebuildObj(b); }
  else if (t.dataset.pos != null || t.dataset.rot != null) { const p = objPose(o); if (t.dataset.pos != null) p.p[+t.dataset.pos] = +t.value || 0; else p.r[+t.dataset.rot] = +t.value || 0; applyPose(o, p); if (b.keys.length) setKey(b, T, p, 1); else { b.pos = p.p.map(r3); b.rot = p.r.map(r1); } rebuildPath(o); renderTicks(); }
  else if (t.id === "eType") { b.type = t.value; b.size = CAT[t.value].size.slice(); if (CAT[t.value].sign && !b.sign) b.sign = CAT[t.value].sign; rebuildObj(b); renderEdit(); renderBlocks(); }
  else if (t.id === "eLook") { b.cam.lookAt = t.value || null; renderEdit(); }
  else if (t.id === "ePose") { b.poses = (b.poses || []).filter(x => Math.abs(x.t - T) > 0.02); b.poses.push({ t: r3(T), pose: t.value }); b.poses.sort((a, c) => a.t - c.t); evalAll(T); renderEdit(); }
  else if (t.id === "eShowLabel") { b.showLabel = t.checked; ensureLabel(o); applyVis(o); }
  else if (t.id === "eGuide") { b.guide = t.checked; rebuildObj(b); }
  else if (t.id === "eLocked") { b.locked = t.checked; attachSel(); renderBlocks(); }
  else { undoStack.pop(); uiUndo(); return; }
  changed();
});
tabEdit.addEventListener("click", e => {
  const b = curBlock(); if (!b) return; const o = objs.get(b.id); const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.lens) { pushUndo(); const v = +t.dataset.lens; o.curLens = v; if (b.keys.length) { setKey(b, T, objPose(o), 1); renderTicks(); } else b.cam.lens = v; refreshFrustum(o); rebuildPath(o); changed(); renderEdit(); return; }
  if (t.dataset.col) { pushUndo(); b.color = t.dataset.col; rebuildObj(b); changed(); renderEdit(); renderBlocks(); return; }
  switch (t.id) {
    case "eCut": pushUndo(); S.cuts = (S.cuts || []).filter(c => Math.abs(c.t - T) > 0.02); S.cuts.push({ t: r3(T), cam: b.id }); S.cuts.sort((a, c) => a.t - c.t); if (!S.cuts.some(c => c.t <= 0.001)) S.cuts.unshift({ t: 0, cam: S.camId || b.id }); changed(); renderTicks(); renderShot(); toast(`Cut to ${b.label} at ${T.toFixed(2)}s.`); break;
    case "eKey": keyNow(); break;
    case "eClear": pushUndo(); { const p = objPose(o); b.pos = p.p.map(r3); b.rot = p.r.map(r1); if (b.cam) b.cam.lens = r1(p.l ?? b.cam.lens); } b.keys = []; rebuildPath(o); changed(); renderEdit(); renderTicks(); renderBlocks(); break;
    case "eShift": $("#eShiftBox").hidden = !$("#eShiftBox").hidden; break;
    case "eShiftOk": { const d = +$("#eShiftR").value; if (!d) break; pushUndo(); b.keys.forEach(k => k.t = r3(clamp(k.t + d, 0, S.duration))); (b.poses || []).forEach(k => k.t = r3(clamp(k.t + d, 0, S.duration))); rebuildPath(o); changed(); renderEdit(); renderTicks(); toast(`Shifted ${b.label} by ${d > 0 ? "+" : ""}${d.toFixed(2)}s.`); break; }
    case "eVis": pushUndo(); { const v = !U.visAt(b, T); b.vis = (b.vis || []).filter(x => Math.abs(x.t - T) > 0.02); b.vis.push({ t: r3(T), v }); b.vis.sort((a, c) => a.t - c.t); } evalAll(T); changed(); renderEdit(); break;
    case "eVisClear": pushUndo(); b.vis = []; evalAll(T); changed(); renderEdit(); break;
    case "eImg": $("#fileImg").click(); break;
    case "eImgX": pushUndo(); b.img = null; rebuildObj(b); changed(); renderEdit(); break;
    case "eDup": duplicate(b); break;
    case "eFocus": focusOn(o); break;
    case "eDel": $("#eDelConfirm").hidden = false; break;
    case "eDelNo": $("#eDelConfirm").hidden = true; break;
    case "eDelYes": removeBlock(b.id); break;
  }
});
function refreshFrustum(o) { if (!o.frust) return; o.root.remove(o.frust); o.frust.geometry.dispose(); o.frust.material.dispose(); o.frust = frustumLines(o.b, o.curLens || o.b.cam.lens); o.root.add(o.frust); }
function duplicate(b) {
  pushUndo(); const c = JSON.parse(JSON.stringify(b)); c.id = uid(); c.label = (b.label + " 2").slice(0, 28); delete c.autoCam;
  const off = [Math.max(0.7, b.size[0] + 0.3), 0, 0.4]; c.pos = c.pos.map((v, i) => r3(v + off[i])); c.keys.forEach(k => k.p = k.p.map((v, i) => r3(v + off[i])));
  S.blocks.push(c); makeObj(c); changed(); select(c.id); renderBlocks();
}
function removeBlock(id) {
  pushUndo(); const o = objs.get(id); if (o) { disposeObj(o); objs.delete(id); }
  S.blocks = S.blocks.filter(b => b.id !== id);
  S.blocks.forEach(b => { if (b.cam && b.cam.lookAt === id) b.cam.lookAt = null; });
  S.cuts = (S.cuts || []).filter(c => c.cam !== id);
  if (S.camId === id) { const c = S.blocks.find(b => b.cam); S.camId = c ? c.id : null; }
  sel = null; attachSel(); changed(); renderAll();
}
function focusOn(o) { setView("free"); const c = o.root.position.clone(); c.y += o.b.size[1] * 0.5; const d = freeCam.position.clone().sub(orbit.target); orbit.target.copy(c); freeCam.position.copy(c).add(d.setLength(Math.max(3, Math.max(...o.b.size) * 2.4))); }
$("#fileImg").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; const b = curBlock(); if (!f || !b) return;
  try {
    const img = await createImageBitmap(f); const s = Math.min(1, 640 / Math.max(img.width, img.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s); cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    pushUndo(); b.img = cv.toDataURL("image/jpeg", 0.82); b.size[1] = r2(b.size[0] / (img.width / img.height));
    rebuildObj(b); changed(); renderEdit(); toast("Picture added. Card height now matches the picture.");
  } catch (err) { toast("That picture could not be read. Try a JPG or PNG."); }
});

/* ======================================================================
   SHOT TAB
   ====================================================================== */
const TIME_NAMES = { day: "Day", golden_hour: "Golden hour", dusk: "Dusk", night: "Night", overcast: "Overcast", dawn: "Dawn" };
function renderShot() {
  const cams = S.blocks.filter(b => b.cam), L = S.look;
  $("#tab-shot").innerHTML = `
    <label class="field"><span>Scene name</span><input class="in" id="sName" value="${esc(S.name)}" maxlength="60"></label>
    <h3>Frame</h3>
    <div class="pills" id="sAspect">${BR.ENUMS.ASPECTS.map(a => `<button data-asp="${a}" class="${S.aspect === a ? "on" : ""}">${a}</button>`).join("")}</div>
    <div class="trio" style="margin-top:10px"><label>LENGTH S<input class="in" type="number" id="sDur" min="1" max="120" step="0.5" value="${S.duration}"></label><label>FPS<select class="in" id="sFps">${[24, 25, 30].map(f => `<option ${S.fps === f ? "selected" : ""}>${f}</option>`).join("")}</select></label><label>START CAMERA<select class="in" id="sCam">${cams.length ? cams.map(c => `<option value="${c.id}" ${c.id === (S.cuts && S.cuts[0] ? S.cuts[0].cam : S.camId) ? "selected" : ""}>${esc(c.label)}</option>`).join("") : `<option value="">None</option>`}</select></label></div>
    <h3>Cuts</h3>
    ${(S.cuts || []).length ? (S.cuts || []).map((c, i) => { const cb = S.blocks.find(b => b.id === c.cam); return `<div class="cutrow"><span class="t">${c.t.toFixed(2)}s</span><span class="nm">${esc(cb ? cb.label : "missing camera")}</span>${i ? `<button class="mini" data-delcut="${i}" aria-label="Remove cut" title="Remove cut"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg></button>` : ""}</div>`; }).join("") : `<p class="note">One continuous shot. Select a camera and use "Cut to this camera" in Edit to add cuts.</p>`}
    <h3>Light and look</h3>
    <div class="field"><span>Time of day</span><div class="pills">${Object.entries(TIME_NAMES).map(([k, n]) => `<button data-time="${k}" class="${L.time === k ? "on" : ""}">${n}</button>`).join("")}</div></div>
    <div class="field"><span>Weather</span><div class="pills">${["clear", "rain", "fog", "snow"].map(k => `<button data-weather="${k}" class="${L.weather === k ? "on" : ""}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div></div>
    <div class="field"><span>Render style</span><div class="pills"><button data-style="colour" class="${L.style !== "clay" ? "on" : ""}">Colour</button><button data-style="clay" class="${L.style === "clay" ? "on" : ""}">Clay (set grey, cast in colour)</button></div></div>
    <div class="field"><span>Sun direction</span><div class="slider"><input type="range" id="sAz" min="0" max="360" step="1" value="${L.sunAz}"><output id="oAz">${Math.round(L.sunAz)}°</output></div></div>
    <div class="field"><span>Sun height</span><div class="slider"><input type="range" id="sEl" min="2" max="88" step="1" value="${L.sunEl}"><output id="oEl">${Math.round(L.sunEl)}°</output></div></div>
    <div class="field"><span>Sun strength</span><div class="slider"><input type="range" id="sPow" min="0" max="3" step="0.05" value="${L.sunPower}"><output id="oPow">${(+L.sunPower).toFixed(2)}</output></div></div>
    <div class="checks"><label><input type="checkbox" id="sShadows" ${L.shadows ? "checked" : ""}> Shadows</label><label><input type="checkbox" id="sHaze" ${L.haze ? "checked" : ""}> Distance haze</label></div>
    <h3>Guides</h3>
    <div class="checks"><label><input type="checkbox" id="sLabels" ${S.labelsInShot ? "checked" : ""}> Show label tags in the shot and render</label><label><input type="checkbox" id="sGrid" ${S.grid ? "checked" : ""}> Ground grid (viewport only)</label><label><input type="checkbox" id="sThirds" ${S.thirds ? "checked" : ""}> Rule-of-thirds lines in Shot view</label></div>`;
  $("#thirds").hidden = !S.thirds;
}
const tabShot = $("#tab-shot");
tabShot.addEventListener("input", e => {
  const t = e.target;
  if (t.id === "sName") { beginEdit(); S.name = t.value || "Untitled scene"; renderName(); return; }
  if (["sAz", "sEl", "sPow"].includes(t.id)) { beginEdit(); const k = { sAz: "sunAz", sEl: "sunEl", sPow: "sunPower" }[t.id]; S.look[k] = +t.value; $("#o" + t.id.slice(1)).textContent = k === "sunPower" ? (+t.value).toFixed(2) : t.value + "°"; applyLook(); }
});
tabShot.addEventListener("change", e => {
  const t = e.target;
  if (["sName", "sAz", "sEl", "sPow"].includes(t.id)) { endEdit(); return; }
  pushUndo();
  if (t.id === "sDur") { S.duration = clamp(+t.value || 10, 1, 120); T = Math.min(T, S.duration); renderRuler(); renderTicks(); for (const o of objs.values()) rebuildPath(o); }
  else if (t.id === "sFps") S.fps = +t.value;
  else if (t.id === "sCam") { if (S.cuts && S.cuts.length) S.cuts[0].cam = t.value; S.camId = t.value || null; renderBlocks(); }
  else if (t.id === "sShadows") S.look.shadows = t.checked; else if (t.id === "sHaze") S.look.haze = t.checked;
  else if (t.id === "sLabels") S.labelsInShot = t.checked; else if (t.id === "sGrid") S.grid = t.checked;
  else if (t.id === "sThirds") { S.thirds = t.checked; $("#thirds").hidden = !S.thirds; }
  applyLook(); changed();
});
tabShot.addEventListener("click", e => {
  const a = e.target.closest("[data-asp]"), tm = e.target.closest("[data-time]"), w = e.target.closest("[data-weather]"), st = e.target.closest("[data-style]"), dc = e.target.closest("[data-delcut]");
  if (a) { pushUndo(); S.aspect = a.dataset.asp; layoutFrame(); for (const o of objs.values()) refreshFrustum(o); changed(); renderShot(); }
  if (tm) { pushUndo(); S.look.time = tm.dataset.time; Object.assign(S.look, { sunAz: BR.LOOKS[S.look.time].sunAz, sunEl: BR.LOOKS[S.look.time].sunEl, sunPower: BR.LOOKS[S.look.time].sunPower }); applyLook(); changed(); renderShot(); }
  if (w) { pushUndo(); S.look.weather = w.dataset.weather; applyLook(); changed(); renderShot(); }
  if (st) { pushUndo(); S.look.style = st.dataset.style; applyLook(); changed(); renderShot(); }
  if (dc) { pushUndo(); S.cuts.splice(+dc.dataset.delcut, 1); changed(); renderShot(); renderTicks(); }
});

/* ======================================================================
   BLOCKING NOTES (numbers, for the filmmaker) + video prompt
   ====================================================================== */
function colorName(hex) { return BR.colorWord(hex); }
function camBasisAt(t) {
  const id = activeCamId(t), cb = S.blocks.find(b => b.id === id); if (!cb) return null;
  const p = U.poseAt(cb, t).p; let f;
  if (cb.cam.lookAt) { const tb = S.blocks.find(b => b.id === cb.cam.lookAt); if (tb) { const q = U.poseAt(tb, t).p; f = [q[0] - p[0], 0, q[2] - p[2]]; } }
  if (!f) { const yaw = U.poseAt(cb, t).r[1] * D2R; f = [-Math.sin(yaw), 0, -Math.cos(yaw)]; }
  const l = Math.hypot(f[0], f[2]) || 1; f = [f[0] / l, 0, f[2] / l];
  return { f, r: [-f[2], 0, f[0]] };
}
function phases(b) {
  const step = 0.1, n = Math.round(S.duration / step), pts = [];
  for (let i = 0; i <= n; i++) { const t = i * step, p = U.poseAt(b, t); pts.push({ t, p: p.p, yaw: p.r[1] }); }
  const moving = pts.map((q, i) => { if (i === 0) return false; const a = pts[Math.max(0, i - 2)], c = pts[Math.min(pts.length - 1, i + 1)]; return Math.hypot(c.p[0] - a.p[0], c.p[1] - a.p[1], c.p[2] - a.p[2]) / (c.t - a.t) > 0.12; });
  const runs = []; let cur = null;
  for (let i = 1; i < pts.length; i++) { const m = moving[i]; if (!cur || cur.m !== m) { cur = { m, i0: i - 1, i1: i }; runs.push(cur); } else cur.i1 = i; }
  const merged = [];
  runs.forEach((r, k) => { const d = pts[r.i1].t - pts[r.i0].t; if (!r.m && d < 0.5 && runs.length > 1) { if (merged.length) merged[merged.length - 1].i1 = r.i1; else if (runs[k + 1]) runs[k + 1].i0 = r.i0; return; } if (merged.length && merged[merged.length - 1].m === r.m) { merged[merged.length - 1].i1 = r.i1; return; } merged.push({ ...r }); });
  return merged.map(r => ({ m: r.m, a: pts[r.i0], c: pts[r.i1] }));
}
const POSE_VERB = { stand: "stands", sit: "sits", crouch: "crouches", kneel: "kneels", lie: "lies down", fall: "falls", wave: "waves", point: "points", talk: "talks", hands_up: "puts hands up", aim: "aims", fight: "squares up to fight", dance: "dances", sing: "sings", phone: "talks on the phone", drive: "drives" };
function blockingNotes() {
  const cast = S.blocks.filter(b => !b.cam && b.ai !== "kit" && !b.hidden && !b.guide && !b.crowdOf && !CAT[b.type]?.ground);
  const L = [`BLOCKING NOTES · ${S.name} · ${S.duration}s · ${S.aspect} · ${S.fps}fps`, "", "LEGEND"];
  for (const b of cast) L.push(`- ${b.label} (${colorName(b.color)} ${catOf(b).name.toLowerCase()}) = ${b.notes.trim() || b.label.toLowerCase()}`);
  const crowd = S.blocks.filter(b => b.crowdOf); if (crowd.length) L.push(`- ${crowd.length} extras (muted figures) = background crowd`);
  L.push("", "SHOTS");
  const cuts = (S.cuts && S.cuts.length) ? S.cuts : (S.camId ? [{ t: 0, cam: S.camId }] : []);
  cuts.forEach((c, i) => { const cb = S.blocks.find(b => b.id === c.cam); if (!cb) return; const end = cuts[i + 1] ? cuts[i + 1].t : S.duration; const tgt = cb.cam.lookAt && S.blocks.find(b => b.id === cb.cam.lookAt); const sh = cb.shot; const p0 = U.poseAt(cb, c.t); L.push(`${c.t.toFixed(1)}-${end.toFixed(1)}s: ${cb.label}, ${Math.round(p0.l ?? cb.cam.lens)}mm, ${r1(p0.p[1])}m high${sh ? `, ${sh.size.replace(/_/g, " ")} ${sh.angle} angle, ${sh.move.replace(/_/g, " ")}` : ""}${tgt ? `, on ${tgt.label}` : ""}.`); });
  if (!cuts.length) L.push("No camera yet.");
  L.push("", "ACTION");
  const movers = cast.filter(b => b.keys.length > 1);
  if (!movers.length) L.push("Nothing moves.");
  for (const b of movers) {
    const isFig = catOf(b).kind === "actor";
    for (const ph of phases(b)) {
      const span = `${ph.a.t.toFixed(1)}-${ph.c.t.toFixed(1)}s`;
      if (!ph.m) { const pz = U.poseNameAt(b, (ph.a.t + ph.c.t) / 2); L.push(`${span}: ${b.label} ${POSE_VERB[pz] || "holds still"}.`); continue; }
      const d = [ph.c.p[0] - ph.a.p[0], ph.c.p[1] - ph.a.p[1], ph.c.p[2] - ph.a.p[2]], dist = Math.hypot(d[0], d[2]), sp = dist / Math.max(0.01, ph.c.t - ph.a.t);
      const bs = camBasisAt((ph.a.t + ph.c.t) / 2); const w = [];
      if (bs && dist > 0.2) { const dep = d[0] * bs.f[0] + d[2] * bs.f[2], lat = d[0] * bs.r[0] + d[2] * bs.r[2]; if (Math.abs(dep) > dist * 0.35) w.push(dep > 0 ? "away from camera" : "toward camera"); if (Math.abs(lat) > dist * 0.35) w.push(lat > 0 ? "to screen right" : "to screen left"); }
      const kd = catOf(b).kind;
      const verb = isFig ? (sp < 0.4 ? "edges" : sp < 1.9 ? "walks" : sp < 3.6 ? "runs" : "sprints") : kd === "animal" ? (b.type === "flock" || b.type === "bird" ? "flies" : sp < 1.6 ? "walks" : "runs") : kd === "boat" ? (sp < 5 ? "drifts" : "sails") : kd === "aircraft" ? "flies" : kd === "vehicle" ? (sp < 3 ? "rolls" : sp < 15 ? "drives" : "speeds") : (sp < 1 ? "drifts" : "moves");
      L.push(`${span}: ${b.label} ${verb} ${dist.toFixed(1)}m${w.length ? " " + w.join(", ") : ""}${Math.abs(d[1]) > 0.5 ? `, ${d[1] > 0 ? "rising" : "dropping"} ${Math.abs(d[1]).toFixed(1)}m` : ""}.`);
    }
  }
  return L.join("\n");
}
function videoPrompt() { return S.videoPrompt && S.videoPrompt.trim() ? S.videoPrompt.trim() : BR.localVideoPrompt(S); }

/* ======================================================================
   EXPORT TAB
   ====================================================================== */
let lastRender = null, exportRes = 720;
function renderExport() {
  const cam = activeCamObj(0);
  $("#tab-export").innerHTML = `
    <h3>Blocking video</h3>
    <p class="lede">Plays the scene through ${(S.cuts || []).length > 1 ? `your ${S.cuts.length} shots with their cuts` : cam ? esc(cam.b.label) : "the camera"} and records it for your video model.</p>
    <div class="field"><span>Size</span><div class="pills" id="xRes">${[[480, "480p"], [720, "720p"], [1080, "1080p"]].map(([v, n]) => `<button data-res="${v}" class="${exportRes === v ? "on" : ""}">${n}</button>`).join("")}</div></div>
    <div class="checks"><label><input type="checkbox" id="xLabels" ${S.labelsInShot ? "checked" : ""}> Burn label tags into the video</label></div>
    <div class="btns"><button class="btn primary" id="xVideo" ${cam ? "" : "disabled"}>Render video</button><button class="btn" id="xStill" ${cam ? "" : "disabled"}>Save still at ${T.toFixed(2)}s</button></div>
    ${cam ? "" : `<p class="note">Add a camera, or use Direct, to render.</p>`}
    <div id="xOut">${lastRender ? renderOutHtml() : ""}</div>
    <div class="sep"></div>
    <h3>Video prompt</h3>
    <p class="lede">Paste this into your video model with the blocking video.</p>
    <textarea class="in prompt" id="xPrompt" style="min-height:160px">${esc(videoPrompt())}</textarea>
    <div class="btns"><button class="btn primary" data-copy="xPrompt">Copy prompt</button><button class="btn" id="xPromptTxt">Save .txt</button></div>
    <h3>Blocking notes</h3>
    <p class="lede">Timings, distances and lenses for your own reference.</p>
    <textarea class="in prompt" id="xNotes" readonly>${esc(blockingNotes())}</textarea>
    <div class="btns"><button class="btn" data-copy="xNotes">Copy notes</button><button class="btn" id="xNotesTxt">Save .txt</button></div>
    <div class="sep"></div>
    <h3>Scene file</h3>
    <div class="btns"><button class="btn" id="xJson">Save scene .json</button><button class="btn" id="xImport">Import .json</button></div>`;
}
function renderOutHtml() { const r = lastRender; return `<p class="note">Rendered ${esc(r.name)} (${(r.blob.size / 1048576).toFixed(1)} MB).</p><video class="preview" src="${r.url}" controls playsinline muted loop></video><div class="btns"><button class="btn primary" id="xSave">Save video</button>${navigator.canShare ? `<button class="btn" id="xShare">Share</button>` : ""}</div>`; }
$("#tab-export").addEventListener("input", e => { if (e.target.id === "xPrompt") { S.videoPrompt = e.target.value; clearTimeout(saveTimer); saveTimer = setTimeout(saveLocal, 900); } });
$("#tab-export").addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.res) { exportRes = +t.dataset.res; renderExport(); return; }
  if (t.dataset.copy) { const ta = $("#" + t.dataset.copy); try { await navigator.clipboard.writeText(ta.value); toast("Copied."); } catch (err) { ta.focus(); ta.select(); toast("Selected. Copy it with your keyboard or long-press."); } return; }
  switch (t.id) {
    case "xVideo": renderVideo(); break;
    case "xStill": saveStill(); break;
    case "xSave": if (lastRender) saveFile(lastRender.name, lastRender.blob); break;
    case "xShare": if (lastRender) { try { const f = new File([lastRender.blob], lastRender.name, { type: lastRender.blob.type }); if (navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: S.name }); else saveFile(lastRender.name, lastRender.blob); } catch (err) {} } break;
    case "xPromptTxt": saveFile(slug() + "_video-prompt.txt", $("#xPrompt").value); break;
    case "xNotesTxt": saveFile(slug() + "_blocking-notes.txt", $("#xNotes").value); break;
    case "xJson": saveFile(slug() + "_scene.json", JSON.stringify(S)); break;
    case "xImport": $("#fileJson").click(); break;
  }
});
$("#tab-export").addEventListener("change", e => { if (e.target.id === "xLabels") { pushUndo(); S.labelsInShot = e.target.checked; changed(); } });
$("#fileJson").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try { const s = JSON.parse(await f.text()); if (!s.blocks) throw 0; s.id = "s" + uid().slice(1); s.example = false; saveLocal(); loadScene(migrate(s)); changed(); toast(`Imported ${s.name}.`); }
  catch (err) { toast("That file is not a Blockroom scene."); }
});
const slug = () => (S.name || "scene").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "scene";
function saveFile(name, data) { const blob = data instanceof Blob ? data : new Blob([data], { type: name.endsWith(".json") ? "application/json" : "text/plain" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); toast(`Saved ${name}.`); }
function exportSize() { const a = U.aspectNum(S.aspect), s = exportRes; return a >= 1 ? [Math.round(s * a / 2) * 2, s] : [s, Math.round(s / a / 2) * 2]; }
function prepExport(on) { exporting = on; tc.visible = !on; selBox.visible = !on && !!sel; if (on) tc.detach(); else attachSel(); }
function renderShotFrame(cam, w, h, t) {
  evalAll(t); updateLabels();
  const o = syncShotCam(cam, w / h, t); cam.clearViewOffset(); cam.updateProjectionMatrix();
  cam.layers.set(0); if (S.labelsInShot) cam.layers.enable(1);
  if (o) focusShadows(o.root.position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(o.root.quaternion).multiplyScalar(18)).setY(0));
  updateParticles(cam, t); setLabelScale(cam, 0.04);
  renderer.render(scene, cam);
}
async function saveStill() {
  const [w, h] = exportSize(); prepExport(true);
  const pr = renderer.getPixelRatio(); renderer.setPixelRatio(1); renderer.setSize(w, h, false);
  renderShotFrame(exportCam, w, h, T);
  const blob = await new Promise(r => renderer.domElement.toBlob(r, "image/png"));
  renderer.setPixelRatio(pr); resize(); prepExport(false); evalAll(T);
  if (blob) saveFile(`${slug()}_${T.toFixed(2).replace(".", "-")}s.png`, blob);
}
let cancelRender = false;
async function renderVideo() {
  if (typeof MediaRecorder === "undefined" || !renderer.domElement.captureStream) { toast("This browser cannot record video. Try Chrome or Safari."); return; }
  const mime = ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(t => MediaRecorder.isTypeSupported(t));
  if (!mime) { toast("This browser cannot record video."); return; }
  const ext = mime.startsWith("video/mp4") ? "mp4" : "webm", [w, h] = exportSize();
  playing = false; uiPlay(); cancelRender = false;
  $("#busy").hidden = false; $("#busyBar").style.width = "0%"; $("#busyNote").textContent = `${w}×${h}, ${S.duration}s at ${S.fps}fps. Keep this tab open.`;
  prepExport(true);
  const pr = renderer.getPixelRatio(); renderer.setPixelRatio(1); renderer.setSize(w, h, false);
  const stream = renderer.domElement.captureStream(S.fps);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.max(w, h) >= 1900 ? 16e6 : 9e6 });
  const chunks = []; rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  const stopped = new Promise(r => rec.onstop = r);
  renderShotFrame(exportCam, w, h, 0); await new Promise(r => setTimeout(r, 150));
  rec.start(250); const start = performance.now();
  await new Promise(res => { const frame = () => { if (cancelRender) return res(); const t = Math.min(S.duration, (performance.now() - start) / 1000); renderShotFrame(exportCam, w, h, t); $("#busyBar").style.width = (t / S.duration * 100).toFixed(1) + "%"; if (t >= S.duration) setTimeout(res, 200); else requestAnimationFrame(frame); }; requestAnimationFrame(frame); });
  rec.stop(); await stopped; stream.getTracks().forEach(t => t.stop());
  renderer.setPixelRatio(pr); resize(); prepExport(false); evalAll(T); $("#busy").hidden = true;
  if (cancelRender) { toast("Render cancelled."); return; }
  const blob = new Blob(chunks, { type: mime.split(";")[0] });
  if (lastRender) URL.revokeObjectURL(lastRender.url);
  lastRender = { blob, url: URL.createObjectURL(blob), name: `${slug()}_blocking_${S.aspect.replace(":", "x")}.${ext}` };
  if (curTab === "export") $("#xOut").innerHTML = renderOutHtml();
  toast("Video ready. Tap Save video.");
}
$("#bCancelRender").onclick = () => { cancelRender = true; };

/* ---------- scenes modal ---------- */
function renderSceneList() {
  const idx = sceneIndex();
  $("#sceneList").innerHTML = idx.length ? idx.map(s => `<div class="srow"><span class="nm">${esc(s.name)}${s.id === S.id ? ' <span class="chip">open</span>' : ""}</span><span class="meta">${new Date(s.updatedAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span><button class="btn" data-open="${s.id}" ${s.id === S.id ? "disabled" : ""}>Open</button><button class="btn danger" data-del="${s.id}">Delete</button></div>`).join("") : `<p class="note">No saved scenes yet. Edit anything and it saves here.</p>`;
}
$("#bScenes").onclick = () => { $("#scenesModal").hidden = false; renderSceneList(); };
$("#bCloseScenes").onclick = () => { $("#scenesModal").hidden = true; };
$("#bLock").onclick = () => { saveLocal(); location.href = "api/lock"; };
$("#scenesModal").addEventListener("click", e => {
  if (e.target.id === "scenesModal") { $("#scenesModal").hidden = true; return; }
  const o = e.target.closest("[data-open]"), d = e.target.closest("[data-del]");
  if (o) { saveLocal(); const raw = lsGet("br2.s." + o.dataset.open); if (raw) { try { loadScene(migrate(JSON.parse(raw))); lsSet("br2.current", S.id); setStatus("Saved", "ok"); renderDirect(); $("#scenesModal").hidden = true; } catch (err) { toast("That scene could not be opened."); } } }
  if (d) { if (d.dataset.armed) { lsDel("br2.s." + d.dataset.del); lsSet("br2.index", JSON.stringify(sceneIndex().filter(x => x.id !== d.dataset.del))); renderSceneList(); toast("Scene deleted."); } else { d.dataset.armed = "1"; d.textContent = "Tap again to delete"; } }
});
$("#bNewScene").onclick = () => { saveLocal(); loadScene(emptyScene()); changed(); renderDirect(); $("#scenesModal").hidden = true; toast("New scene. Describe it in Direct, or add pieces from Add."); };
$("#bNewExample").onclick = () => { saveLocal(); const s = exampleScene(); s.example = false; loadScene(s); changed(); renderDirect(); $("#scenesModal").hidden = true; };
$("#bDupScene").onclick = () => { saveLocal(); const s = JSON.parse(JSON.stringify(S)); s.id = "s" + uid().slice(1); s.name = (S.name + " copy").slice(0, 60); loadScene(s); changed(); $("#scenesModal").hidden = true; toast("Duplicated. You are now editing the copy."); };

/* ---------- example scenes ---------- */
function emptyScene() {
  const S0 = BR.baseScene({ name: "Untitled scene" });
  S0.look = Object.assign(S0.look, { style: "clay" });
  S0.blocks.push(BR.newBlock("ground_clay", { pos: [0, -0.05, 0], locked: true }));
  const f = BR.newBlock("woman", { label: "PERSON 1", pos: [0, 0, 0] }); S0.blocks.push(f);
  const c = BR.newBlock("camera", { label: "CAM 1", pos: [0, 1.5, 5] }); c.cam.lookAt = f.id; S0.blocks.push(c); S0.camId = c.id;
  return S0;
}
const EXAMPLE_PLAN = {
  title: "Night Chase", summary: "Maya sprints down a rain-soaked city street with two men on her heels until a police car swings across the road in front of her, while a helicopter circles overhead.",
  duration: 12, aspect: "16:9", look: { time: "night", weather: "rain", style: "colour" },
  kits: [{ kit: "city_street", x: 0, z: 0, rot: 0, length: 80, seed: 21 }],
  objects: [
    { id: "maya", type: "woman", label: "MAYA", notes: "Maya, late twenties, red trench coat, soaked hair, terrified", x: -1.2, y: 0, z: 30, rot: 180, scale: null, color: "#d6553a", count: null, sign: null },
    { id: "chaser1", type: "man", label: "CHASER 1", notes: "tall man in a black leather jacket", x: -1.8, y: 0, z: 37, rot: 180, scale: null, color: "#2f2f3a", count: null, sign: null },
    { id: "chaser2", type: "man", label: "CHASER 2", notes: "stocky man in a grey hoodie", x: 1.2, y: 0, z: 39, rot: 180, scale: null, color: "#6a6a72", count: null, sign: null },
    { id: "police", type: "police_car", label: "POLICE CAR", notes: "London police car with blue lights flashing", x: 2, y: 0, z: -36, rot: 0, scale: null, color: null, count: null, sign: null },
    { id: "heli", type: "helicopter", label: "HELICOPTER", notes: "police helicopter with a white searchlight", x: 0, y: 32, z: 24, rot: 90, scale: null, color: null, count: null, sign: null },
  ],
  actions: [
    { who: "maya", kind: "move", start: 0, end: 8.5, path: [[-1.4, 0, 22], [0.6, 0, 12], [-0.6, 0, 2], [0, 0, -9]], target: null, speed: "run", pose: null, distance: null },
    { who: "chaser1", kind: "follow", start: 0.6, end: 12, path: [], target: "maya", speed: "run", pose: null, distance: 4.5 },
    { who: "chaser2", kind: "follow", start: 1.0, end: 12, path: [], target: "maya", speed: "run", pose: null, distance: 7 },
    { who: "police", kind: "move", start: 5.5, end: 9.5, path: [[2, 0, -26], [1.4, 0, -17], [-0.8, 0, -14.5]], target: null, speed: "fast", pose: null, distance: null },
    { who: "maya", kind: "turn", start: 9, end: null, path: [], target: "chaser1", speed: null, pose: null, distance: null },
    { who: "maya", kind: "pose", start: 9.6, end: null, path: [], target: null, speed: null, pose: "hands_up", distance: null },
    { who: "heli", kind: "orbit", start: 0, end: 12, path: [[0, 32, 0]], target: null, speed: "slow", pose: null, distance: 24 },
  ],
  shots: [
    { start: 0, end: 3.5, size: "wide", angle: "high", move: "pan", subject: "maya", secondary: null, side: "front", lens: null },
    { start: 3.5, end: 7, size: "medium", angle: "eye", move: "lead", subject: "maya", secondary: null, side: "front", lens: null },
    { start: 7, end: 9.5, size: "full", angle: "low", move: "side_track", subject: "chaser1", secondary: null, side: "left", lens: null },
    { start: 9.5, end: 12, size: "wide", angle: "eye", move: "push_in", subject: "maya", secondary: null, side: "front_right", lens: null },
  ],
  video_prompt: "Follow the attached blocking video exactly for staging, movement, timing and every camera move. The coloured blocks in it are stand-ins; render real people, cars and streets, never the blocks or label tags.\nHigh wide shot of a narrow city street at night in heavy rain, wet tarmac mirroring shop signs and sodium street lamps, a young woman in a red trench coat sprinting toward camera with two men chasing her, a police helicopter circling above with a white searchlight sweeping the street.\nThe camera runs backwards in front of her as she runs, rain streaking past, soaked hair whipping across her terrified face, breath fogging, her coat flaring with each stride.\nLow tracking shot alongside the tall man in the black leather jacket as he pounds through puddles, the stocky man in the grey hoodie close behind, spray kicking up around their boots.\nA police car with flashing blue lights swerves across the road ahead of her and screeches to a stop, she spins to face the men and throws her hands up as the camera pushes in through the rain.\nAspect ratio 16:9",
};
function exampleScene() { const s = BR.compilePlan(EXAMPLE_PLAN, { brief: EXAMPLES[0] }); s.example = true; return s; }

/* ---------- misc ---------- */
let toastTimer = null;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3400); }
function renderName() { $("#sceneName").innerHTML = esc(S.name) + (S.example ? ' <span class="example-tag">example</span>' : ""); }
function renderAll() { renderName(); renderBlocks(); renderEdit(); renderShot(); renderRuler(); renderTicks(); uiTime(); uiPlay(); uiUndo(); if (curTab === "export") renderExport(); if (curTab === "add") renderAdd(); $("#thirds").hidden = !S.thirds; }
document.addEventListener("keydown", e => {
  const tag = (e.target.tagName || "").toLowerCase(); if (["input", "textarea", "select"].includes(tag) || exporting) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === " ") { e.preventDefault(); $("#bPlay").click(); }
  else if (k === "w") setTool("move"); else if (k === "e") setTool("rotate"); else if (k === "r") setTool("scale"); else if (k === "g") setTool("walk");
  else if (k === "k") keyNow(); else if (k === "1") setView("free"); else if (k === "2") setView("top"); else if (k === "3") setView("shot");
  else if ((k === "delete" || k === "backspace") && sel) { e.preventDefault(); removeBlock(sel); }
  else if (k === "d" && sel) duplicate(curBlock()); else if (k === "f" && sel) focusOn(objs.get(sel)); else if (k === "escape") select(null);
});
$("#bUndo").onclick = undo; $("#bRedo").onclick = redo;

/* ---------- boot ---------- */
(function boot() {
  let s = null; const cur = lsGet("br2.current");
  if (cur) { const raw = lsGet("br2.s." + cur); if (raw) { try { s = JSON.parse(raw); } catch (e) { s = null; } } }
  const fresh = !s;
  if (!s) s = exampleScene();
  resize(); loadScene(migrate(s));
  setStatus(fresh ? "Example" : "Saved", fresh ? "warn" : "ok");
  setTool("move"); setView(fresh ? "shot" : "free");
  renderDirect(); setTab("direct");
  if (fresh) { playing = true; uiPlay(); }
  loop();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { for (const o of objs.values()) if (o.label) { scene.remove(o.label); o.label.material.map.dispose(); o.label = null; ensureLabel(o); } });
  checkHealth();
  window.__br = { get S() { return S; }, objs, compile: BR.compilePlan, loadScene: s2 => loadScene(migrate(s2)), setT: t => { T = t; evalAll(T); }, setView, setTab };
})();
})();
