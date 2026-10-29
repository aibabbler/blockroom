/* Blockroom asset catalogue: procedural low-poly models + set kits.
   Convention: metres, Y up, every object's FRONT faces +Z, origin at the centre of its footprint on the ground. */
(function () {
"use strict";
const BR = window.BR = window.BR || {};
const PI = Math.PI;

/* ---------- seeded random ---------- */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let RNG = mulberry32(7);
BR.seed = s => { RNG = mulberry32(s >>> 0); };
const rnd = (a = 0, b = 1) => a + (b - a) * RNG();
const pick = arr => arr[Math.floor(RNG() * arr.length) % arr.length];
BR.rnd = rnd; BR.pick = pick;

/* ---------- materials ---------- */
const matCache = new Map();
function M(color, kind = "clay", o = {}) {
  if (BR.forceUnique && !o.unique) o = Object.assign({}, o, { unique: true });
  const key = o.unique ? null : color + "|" + kind + "|" + (o.opacity || "") + (o.side ? "s" : "") + (o.strength || "");
  if (!o.unique && matCache.has(key)) return matCache.get(key);
  const c = new THREE.Color(color);
  let m;
  switch (kind) {
    case "resin": m = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 0.55 }); break;
    case "paint": m = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.35, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15, envMapIntensity: 0.7 }); break;
    case "glass": m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.08, metalness: 0.75, envMapIntensity: 1.0, transparent: !!o.opacity, opacity: o.opacity || 1 }); break;
    case "metal": m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.85, envMapIntensity: 0.8 }); break;
    case "water": m = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.06, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.88, envMapIntensity: 1.1 }); break;
    case "emit": m = new THREE.MeshBasicMaterial({ color: c, toneMapped: false }); break;
    case "glow": m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }); m.userData.nightOnly = o.strength || 0.5; break;
    case "flat": m = new THREE.MeshStandardMaterial({ color: c, roughness: 1, envMapIntensity: 0.45 }); break;
    case "leaf": m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, envMapIntensity: 0.4, flatShading: true }); break;
    case "rock": m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, envMapIntensity: 0.4, flatShading: true }); break;
    default: m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, envMapIntensity: 0.45 });
  }
  if (o.side) m.side = THREE.DoubleSide;
  if (o.map) m.map = o.map;
  if (o.emap) { m.emissiveMap = o.emap; m.emissive = new THREE.Color(0xffd9a0); m.emissiveIntensity = 0; m.userData.nightWindows = 1; }
  m.userData.baseColor = c.clone(); m.userData.baseEnv = m.envMapIntensity ?? 0; m.userData.kind = kind;
  if (!o.unique) matCache.set(key, m); else m.userData.unique = true;
  return m;
}
BR.M = M;

/* ---------- geometry helpers ---------- */
function mk(geo, m, x = 0, y = 0, z = 0) { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = true; me.receiveShadow = true; return me; }
const bx = (m, w, h, d, x = 0, y = 0, z = 0) => mk(new THREE.BoxGeometry(w, h, d), m, x, y, z);
const cy = (m, rt, rb, h, x = 0, y = 0, z = 0, seg = 16) => mk(new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y, z);
const sp = (m, r, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, seg = 16) => { const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.6 | 0)); g.scale(sx, sy, sz); return mk(g, m, x, y, z); };
const cn = (m, r, h, x = 0, y = 0, z = 0, seg = 12) => mk(new THREE.ConeGeometry(r, h, seg), m, x, y, z);
const cap = (m, r, len, x = 0, y = 0, z = 0, seg = 12) => mk(new THREE.CapsuleGeometry(r, len, 4, seg), m, x, y, z);
const tor = (m, r, t, x = 0, y = 0, z = 0) => mk(new THREE.TorusGeometry(r, t, 8, 24), m, x, y, z);
function rot(o, x = 0, y = 0, z = 0) { o.rotation.set(x, y, z); return o; }
function grp(...kids) { const g = new THREE.Group(); kids.forEach(k => k && g.add(k)); return g; }
function wheel(r, w, x, y, z) { const g = new THREE.CylinderGeometry(r, r, w, 18); g.rotateZ(PI / 2); const m = mk(g, M("#1f1f1f", "clay")); m.position.set(x, y, z); const hub = mk(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w * 1.05, 10).rotateZ(PI / 2), M("#9a9a9a", "metal")); m.add(hub); return m; }
function anim(g, a) { g.userData.anim = Object.assign(g.userData.anim || {}, a); return g; }

/* ---------- canvas textures ---------- */
const texCache = new Map();
function facadeTex(style, color, cols = 4, rows = 8, seed = 1) {
  const key = [style, color, cols, rows, seed].join("|");
  if (texCache.has(key)) return texCache.get(key);
  const cw = 64, ch = 64, W = cw * cols, H = ch * rows;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const e = document.createElement("canvas"); e.width = W; e.height = H;
  const x = c.getContext("2d"), ex = e.getContext("2d");
  const r = mulberry32(seed * 977 + cols * 31 + rows);
  x.fillStyle = color; x.fillRect(0, 0, W, H); ex.fillStyle = "#000"; ex.fillRect(0, 0, W, H);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const X = i * cw, Y = j * ch;
    if (style === "glass") {
      x.fillStyle = `rgb(${60 + r() * 25},${84 + r() * 25},${104 + r() * 30})`; x.fillRect(X + 2, Y + 3, cw - 4, ch - 6);
      x.fillStyle = "rgba(255,255,255,.12)"; x.fillRect(X + 2, Y + 3, cw - 4, 8);
      if (r() < 0.35) { ex.fillStyle = `rgba(255,${210 + r() * 40},${150 + r() * 60},1)`; ex.fillRect(X + 4, Y + 6, cw - 8, ch - 12); }
    } else {
      const ww = style === "shop" ? 40 : 24, wh = style === "shop" ? 34 : 34;
      const wx = X + (cw - ww) / 2, wy = Y + (ch - wh) / 2;
      x.fillStyle = "rgba(0,0,0,.18)"; x.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      x.fillStyle = `rgb(${52 + r() * 20},${64 + r() * 20},${78 + r() * 20})`; x.fillRect(wx, wy, ww, wh);
      x.fillStyle = "rgba(255,255,255,.15)"; x.fillRect(wx, wy, ww, 6);
      x.fillStyle = "rgba(0,0,0,.25)"; x.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      if (r() < 0.45) { ex.fillStyle = `rgba(255,${190 + r() * 50},${120 + r() * 60},1)`; ex.fillRect(wx, wy, ww, wh); }
    }
  }
  const t = new THREE.CanvasTexture(c), te = new THREE.CanvasTexture(e);
  [t, te].forEach(tt => { tt.encoding = THREE.sRGBEncoding; tt.wrapS = tt.wrapT = THREE.RepeatWrapping; tt.anisotropy = 4; });
  const out = { map: t, emap: te }; texCache.set(key, out); return out;
}
function signTex(text, bg, fg) {
  const key = "sign|" + text + bg + fg; if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement("canvas"); c.width = 512; c.height = 96; const x = c.getContext("2d");
  x.fillStyle = bg; x.fillRect(0, 0, 512, 96); x.fillStyle = fg; x.font = "700 54px 'Instrument Sans', Arial, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
  let t = String(text || "").toUpperCase().slice(0, 18); x.fillText(t, 256, 52, 480);
  const tx = new THREE.CanvasTexture(c); tx.encoding = THREE.sRGBEncoding; texCache.set(key, tx); return tx;
}
function stripeTex(kind) {
  const key = "stripe|" + kind; if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement("canvas"); c.width = 64; c.height = 256; const x = c.getContext("2d");
  if (kind === "road") { x.fillStyle = "#3d3d3f"; x.fillRect(0, 0, 64, 256); x.fillStyle = "#e8e2cf"; x.fillRect(30, 0, 4, 120); }
  else if (kind === "runway") { x.fillStyle = "#454547"; x.fillRect(0, 0, 64, 256); x.fillStyle = "#f2f2f2"; x.fillRect(29, 0, 6, 140); }
  else if (kind === "crops") { x.fillStyle = "#6b4f2f"; x.fillRect(0, 0, 64, 256); x.fillStyle = "#7f9a3a"; for (let i = 0; i < 64; i += 16) x.fillRect(i + 3, 0, 10, 256); }
  else if (kind === "zebra") { x.fillStyle = "#3d3d3f"; x.fillRect(0, 0, 64, 256); x.fillStyle = "#efefe8"; for (let i = 0; i < 256; i += 64) x.fillRect(0, i, 64, 32); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; texCache.set(key, t); return t;
}

/* ======================================================================
   HUMAN RIG
   ====================================================================== */
function human(o) {
  const S = o.h / 1.75, g = new THREE.Group();
  const body = M(o.color, o.kind || "resin"), skin = M(o.skin || "#8a5a3c", "clay"), dark = M(o.pants || "#33302b", "clay");
  const hipY = 0.93 * S;
  const hips = new THREE.Group(); hips.position.y = hipY; g.add(hips);
  const pelvis = sp(dark, 0.16 * S * (o.wide || 1), 0, 0.02 * S, 0, 1, 0.75, 0.75); hips.add(pelvis);
  const chest = new THREE.Group(); chest.position.y = 0.05 * S; hips.add(chest);
  const torso = cap(body, 0.165 * S * (o.wide || 1), 0.26 * S, 0, 0.25 * S, 0); torso.scale.z = 0.72; chest.add(torso);
  if (o.skirt) { const sk = cn(body, 0.27 * S, 0.42 * S, 0, -0.12 * S, 0, 16); sk.rotation.x = PI; chest.add(sk); }
  const neck = new THREE.Group(); neck.position.y = 0.52 * S; chest.add(neck);
  const head = sp(skin, 0.105 * S * (o.headK || 1), 0, 0.12 * S, 0, 0.92, 1.05, 1, 18); neck.add(head);
  const nose = bx(skin, 0.03 * S, 0.04 * S, 0.04 * S, 0, 0.11 * S, 0.1 * S); neck.add(nose);
  if (o.hair) { const hr = sp(M(o.hair, "clay"), 0.112 * S * (o.headK || 1), 0, 0.15 * S, -0.015 * S, 0.98, 0.9, 1.0, 16); neck.add(hr); if (o.long) neck.add(bx(M(o.hair, "clay"), 0.2 * S, 0.3 * S, 0.06 * S, 0, 0.0, -0.08 * S)); }
  if (o.hat === "helmet") neck.add(sp(M("#4c5a3a", "clay"), 0.125 * S, 0, 0.17 * S, 0, 1, 0.7, 1.05));
  if (o.hat === "cap") { neck.add(cy(M("#1d2a4a", "clay"), 0.11 * S, 0.11 * S, 0.06 * S, 0, 0.21 * S, 0)); neck.add(bx(M("#1d2a4a", "clay"), 0.16 * S, 0.015 * S, 0.1 * S, 0, 0.19 * S, 0.1 * S)); }
  if (o.hat === "hard") neck.add(sp(M("#f2c230", "clay"), 0.13 * S, 0, 0.17 * S, 0, 1, 0.65, 1.1));
  const limb = (r, len, m) => { const p = new THREE.Group(); const c = cap(m, r, len, 0, -(len / 2 + r * 0.6), 0); p.add(c); return p; };
  const mkLeg = side => {
    const hip = new THREE.Group(); hip.position.set(side * 0.095 * S, -0.02 * S, 0); hips.add(hip);
    const th = cap(dark, 0.075 * S, 0.3 * S, 0, -0.22 * S, 0); hip.add(th);
    const knee = new THREE.Group(); knee.position.y = -0.44 * S; hip.add(knee);
    knee.add(cap(dark, 0.062 * S, 0.3 * S, 0, -0.21 * S, 0));
    const foot = bx(M("#2a2622", "clay"), 0.1 * S, 0.07 * S, 0.24 * S, 0, -0.44 * S, 0.05 * S); knee.add(foot);
    return { hip, knee };
  };
  const mkArm = side => {
    const sh = new THREE.Group(); sh.position.set(side * 0.215 * S * (o.wide || 1), 0.44 * S, 0); chest.add(sh);
    sh.add(cap(body, 0.055 * S, 0.2 * S, 0, -0.15 * S, 0));
    const el = new THREE.Group(); el.position.y = -0.3 * S; sh.add(el);
    el.add(cap(skin, 0.047 * S, 0.19 * S, 0, -0.14 * S, 0));
    el.add(sp(skin, 0.05 * S, 0, -0.3 * S, 0));
    sh.rotation.z = side * 0.08;
    return { sh, el };
  };
  const L = mkLeg(1), R = mkLeg(-1), LA = mkArm(1), RA = mkArm(-1);
  g.userData.rig = { S, hipY, hips, chest, neck, lHip: L.hip, lKnee: L.knee, rHip: R.hip, rKnee: R.knee, lSh: LA.sh, lEl: LA.el, rSh: RA.sh, rEl: RA.el, hunch: o.hunch || 0 };
  if (o.prop === "gun") { const gun = bx(M("#1b1b1b", "metal"), 0.05 * S, 0.08 * S, 0.3 * S, 0, -0.32 * S, 0.12 * S); RA.el.add(gun); }
  if (o.prop === "bag") { LA.el.add(bx(M("#6b4a2e", "clay"), 0.1 * S, 0.22 * S, 0.3 * S, 0.05 * S, -0.4 * S, 0)); }
  if (o.prop === "mic") { RA.el.add(cy(M("#222", "metal"), 0.018 * S, 0.012 * S, 0.18 * S, 0, -0.34 * S, 0.06 * S)); }
  return anim(g, { rig: true, walker: "biped" });
}
/* pose a human rig. st = {speed, phase, pose, t, k (blend)} */
BR.poseHuman = function (rig, st) {
  const { S, hipY } = rig, t = st.t || 0, sp = st.speed || 0, ph = (st.phase || 0) * PI * 2;
  const set = (o, x = 0, y = 0, z = 0) => o.rotation.set(x, y, z);
  // reset
  rig.hips.position.set(0, hipY, 0); set(rig.hips); set(rig.chest, rig.hunch); set(rig.neck, -rig.hunch * 0.6);
  set(rig.lHip); set(rig.rHip); set(rig.lKnee); set(rig.rKnee);
  set(rig.lSh, 0, 0, 0.08); set(rig.rSh, 0, 0, -0.08); set(rig.lEl, -0.12); set(rig.rEl, -0.12);
  const pose = st.pose || "auto";
  const moving = sp > 0.15 && (pose === "auto" || pose === "stand" || pose === "talk" || pose === "point" || pose === "wave");
  if (moving) {
    const run = sp > 2.6, k = Math.min(1, sp / 1.5);
    const amp = run ? 0.75 : 0.42 * k, s = Math.sin(ph), c = Math.cos(ph);
    rig.lHip.rotation.x = -s * amp; rig.rHip.rotation.x = s * amp;
    rig.lKnee.rotation.x = Math.max(0, c) * amp * (run ? 2.0 : 1.3) + 0.05; rig.rKnee.rotation.x = Math.max(0, -c) * amp * (run ? 2.0 : 1.3) + 0.05;
    rig.lSh.rotation.x = s * amp * 0.9; rig.rSh.rotation.x = -s * amp * 0.9;
    rig.lEl.rotation.x = run ? -1.4 : -0.25; rig.rEl.rotation.x = run ? -1.4 : -0.25;
    rig.chest.rotation.x = rig.hunch + (run ? 0.28 : 0.06);
    rig.hips.position.y = hipY - Math.abs(Math.cos(ph)) * (run ? 0.05 : 0.025) * S;
    rig.hips.rotation.y = s * 0.08; rig.chest.rotation.y = -s * 0.14;
  } else {
    const br = Math.sin(t * 1.8) * 0.012; rig.chest.rotation.x += br;
  }
  switch (pose) {
    case "sit": rig.hips.position.y = 0.48 * S; rig.lHip.rotation.x = rig.rHip.rotation.x = -1.5; rig.lKnee.rotation.x = rig.rKnee.rotation.x = 1.5; rig.lSh.rotation.x = rig.rSh.rotation.x = -0.35; rig.lEl.rotation.x = rig.rEl.rotation.x = -0.9; break;
    case "crouch": rig.hips.position.y = 0.52 * S; rig.lHip.rotation.x = -1.3; rig.rHip.rotation.x = -0.9; rig.lKnee.rotation.x = 2.1; rig.rKnee.rotation.x = 1.9; rig.chest.rotation.x = 0.5; rig.lSh.rotation.x = rig.rSh.rotation.x = -0.6; break;
    case "kneel": rig.hips.position.y = 0.55 * S; rig.lHip.rotation.x = -1.5; rig.lKnee.rotation.x = 1.5; rig.rHip.rotation.x = 0.1; rig.rKnee.rotation.x = 1.6; rig.chest.rotation.x = 0.1; break;
    case "lie": rig.hips.position.y = 0.14 * S; rig.hips.rotation.x = -PI / 2; rig.lSh.rotation.z = 0.3; rig.rSh.rotation.z = -0.3; break;
    case "fall": rig.hips.position.y = 0.14 * S; rig.hips.rotation.x = PI / 2; rig.lSh.rotation.z = 1.2; rig.rSh.rotation.z = -1.2; rig.lHip.rotation.z = 0.2; rig.rHip.rotation.z = -0.25; break;
    case "wave": rig.rSh.rotation.z = -2.7; rig.rEl.rotation.z = Math.sin(t * 7) * 0.45; rig.rEl.rotation.x = 0; break;
    case "point": rig.rSh.rotation.x = -1.55; rig.rEl.rotation.x = 0; break;
    case "talk": rig.lEl.rotation.x = -1.0 + Math.sin(t * 3.1) * 0.25; rig.rEl.rotation.x = -0.9 + Math.sin(t * 2.3 + 1) * 0.3; rig.lSh.rotation.x = -0.25; rig.rSh.rotation.x = -0.2; rig.neck.rotation.x += Math.sin(t * 2.7) * 0.06; rig.neck.rotation.y = Math.sin(t * 1.3) * 0.15; break;
    case "hands_up": rig.lSh.rotation.z = 2.8; rig.rSh.rotation.z = -2.8; rig.lEl.rotation.x = rig.rEl.rotation.x = 0; break;
    case "aim": rig.rSh.rotation.x = -1.5; rig.lSh.rotation.x = -1.4; rig.lSh.rotation.z = -0.5; rig.rEl.rotation.x = 0; rig.lEl.rotation.x = -0.2; rig.chest.rotation.y = 0.15; break;
    case "fight": { const b = Math.sin(t * 6); rig.hips.position.y -= 0.05 * S + Math.abs(b) * 0.02 * S; rig.lHip.rotation.x = -0.35; rig.rHip.rotation.x = 0.3; rig.lKnee.rotation.x = rig.rKnee.rotation.x = 0.45; rig.lSh.rotation.x = -1.2; rig.rSh.rotation.x = -1.0 + Math.max(0, Math.sin(t * 4)) * -0.6; rig.lEl.rotation.x = rig.rEl.rotation.x = -1.8; rig.chest.rotation.y = 0.3; break; }
    case "dance": { const b = Math.sin(t * 5.2), b2 = Math.sin(t * 2.6); rig.hips.position.y -= Math.abs(b) * 0.06 * S; rig.hips.rotation.y = b2 * 0.35; rig.chest.rotation.z = b * 0.12; rig.lSh.rotation.z = 1.4 + b * 0.8; rig.rSh.rotation.z = -1.4 + b * 0.8; rig.lEl.rotation.x = rig.rEl.rotation.x = -0.6; rig.lKnee.rotation.x = 0.3 + Math.max(0, b) * 0.5; rig.rKnee.rotation.x = 0.3 + Math.max(0, -b) * 0.5; rig.lHip.rotation.x = -0.15 - Math.max(0, b) * 0.3; rig.rHip.rotation.x = -0.15 - Math.max(0, -b) * 0.3; break; }
    case "sing": rig.rSh.rotation.x = -1.1; rig.rEl.rotation.x = -1.9; rig.lSh.rotation.z = 0.6 + Math.sin(t * 2) * 0.3; rig.neck.rotation.x = -0.12; break;
    case "phone": rig.rSh.rotation.x = -0.6; rig.rSh.rotation.z = -0.4; rig.rEl.rotation.x = -2.3; break;
    case "drive": rig.hips.position.y = 0.5 * S; rig.lHip.rotation.x = rig.rHip.rotation.x = -1.4; rig.lKnee.rotation.x = rig.rKnee.rotation.x = 1.2; rig.lSh.rotation.x = rig.rSh.rotation.x = -1.0; rig.lEl.rotation.x = rig.rEl.rotation.x = -0.6; break;
  }
};

/* quadruped */
function quad(o) {
  const g = new THREE.Group(), m = M(o.color, "clay"), L = o.L, H = o.H, W = o.W;
  const legH = H * 0.55;
  const torso = cap(m, W / 2, L * 0.55, 0, legH + W * 0.2, 0, 14); torso.rotation.x = PI / 2; g.add(torso);
  const neck = new THREE.Group(); neck.position.set(0, legH + W * 0.4, L * 0.38); g.add(neck);
  const nk = cap(m, W * 0.25, H * 0.22, 0, H * 0.12, 0); nk.rotation.x = 0.6; neck.add(nk);
  neck.add(sp(m, W * 0.32, 0, H * 0.28, H * 0.12, 0.9, 0.85, 1.4));
  if (o.ears) { neck.add(cn(m, W * 0.1, W * 0.25, W * 0.15, H * 0.38, H * 0.08)); neck.add(cn(m, W * 0.1, W * 0.25, -W * 0.15, H * 0.38, H * 0.08)); }
  const legs = [];
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const p = new THREE.Group(); p.position.set(x * W * 0.3, legH, z * L * 0.32); g.add(p);
    p.add(cap(M(o.leg || o.color, "clay"), W * 0.12, legH * 0.8, 0, -legH / 2, 0, 8)); legs.push({ p, phase: (x * z > 0 ? 0 : 0.5) });
  }
  const tail = cap(m, W * 0.06, L * 0.25, 0, legH + W * 0.35, -L * 0.48); tail.rotation.x = -0.9; g.add(tail);
  return anim(g, { walker: "quad", legs, stride: L * 1.1, neck });
}
function bird(color) {
  const g = new THREE.Group(), m = M(color, "clay");
  g.add(sp(m, 0.12, 0, 0, 0, 0.8, 0.7, 1.6)); g.add(sp(m, 0.07, 0, 0.06, 0.16)); g.add(cn(M("#e0a030"), 0.025, 0.08, 0, 0.05, 0.25).rotateX(PI / 2));
  const wings = [];
  for (const s of [1, -1]) { const p = new THREE.Group(); p.position.set(s * 0.06, 0.03, 0); const w = bx(m, 0.32, 0.015, 0.16, s * 0.16, 0, 0); p.add(w); g.add(p); wings.push({ p, s }); }
  return anim(g, { flap: wings });
}

/* ======================================================================
   VEHICLES
   ====================================================================== */
function car(o) {
  const g = new THREE.Group(), L = o.L || 4.5, W = o.W || 1.85, H = o.H || 1.45, r = o.r || 0.34;
  const paint = M(o.color, "paint"), glass = M("#1d2833", "glass"), trim = M("#2a2a2a", "clay");
  g.add(bx(paint, W, H * 0.42, L, 0, r + H * 0.2, 0));
  const cab = bx(glass, W * 0.86, H * 0.38, L * (o.cabL || 0.5), 0, r + H * 0.59, -L * (o.cabZ || 0.04)); g.add(cab);
  g.add(bx(paint, W * 0.88, 0.05, L * (o.cabL || 0.5) * 0.92, 0, r + H * 0.79, -L * (o.cabZ || 0.04)));
  g.add(bx(trim, W * 1.01, 0.12, L * 1.01, 0, r + 0.02, 0));
  for (const s of [1, -1]) { g.add(bx(M("#fff6d8", "emit"), 0.3, 0.1, 0.04, s * W * 0.33, r + H * 0.28, L / 2)); g.add(bx(M("#b51f1f", "emit"), 0.3, 0.1, 0.04, s * W * 0.33, r + H * 0.28, -L / 2)); }
  const wheels = [];
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { const w = wheel(r, 0.24, x * (W / 2 - 0.08), r, z * L * 0.32); g.add(w); wheels.push({ o: w, r }); }
  if (o.siren) { g.add(bx(M("#d62828", "emit"), 0.35, 0.1, 0.22, 0.2, r + H * 0.86, -L * 0.04)); g.add(bx(M("#2850d6", "emit"), 0.35, 0.1, 0.22, -0.2, r + H * 0.86, -L * 0.04)); }
  if (o.taxi) g.add(bx(M("#fff2b0", "emit"), 0.5, 0.14, 0.2, 0, r + H * 0.88, 0));
  if (o.stripe) g.add(bx(M(o.stripe, "flat"), W * 1.01, 0.12, L * 0.9, 0, r + H * 0.3, 0));
  return anim(g, { wheels, vehicle: "car" });
}
function boxTruck(o) {
  const g = new THREE.Group(), r = o.r || 0.5, paint = M(o.color, "paint"), glass = M("#1d2833", "glass");
  const L = o.L, W = o.W, H = o.H, cabL = o.cabL || 2.2;
  g.add(bx(paint, W, H * 0.6, cabL, 0, r + H * 0.32, L / 2 - cabL / 2));
  g.add(bx(glass, W * 0.9, H * 0.28, 0.1, 0, r + H * 0.48, L / 2 + 0.01));
  g.add(bx(M(o.box || "#e8e6e0", "clay"), W, H - r * 0.8, L - cabL - 0.2, 0, r * 0.6 + (H - r * 0.8) / 2 + 0.25, -cabL / 2 - 0.1));
  const wheels = [];
  for (const z of o.axles || [L / 2 - 1, -L / 2 + 1.2]) for (const x of [1, -1]) { const w = wheel(r, 0.32, x * (W / 2 - 0.1), r, z); g.add(w); wheels.push({ o: w, r }); }
  for (const s of [1, -1]) g.add(bx(M("#fff6d8", "emit"), 0.3, 0.14, 0.04, s * W * 0.35, r + 0.3, L / 2 + 0.02));
  if (o.stripe) g.add(bx(M(o.stripe, "flat"), W * 1.01, 0.25, L - cabL - 0.3, 0, r + 1.1, -cabL / 2 - 0.1));
  if (o.ladder) g.add(bx(M("#c0c0c0", "metal"), 0.6, 0.2, L * 0.85, 0, H + 0.3, -0.2));
  if (o.siren) { g.add(bx(M("#d62828", "emit"), 0.6, 0.15, 0.25, 0.4, H * 0.7 + r, L / 2 - 0.6)); g.add(bx(M("#2850d6", "emit"), 0.6, 0.15, 0.25, -0.4, H * 0.7 + r, L / 2 - 0.6)); }
  return anim(g, { wheels, vehicle: "car" });
}
function bus(o) {
  const g = new THREE.Group(), r = 0.5, L = o.L || 12, W = 2.55, H = o.H || 3.1, paint = M(o.color, "paint");
  g.add(bx(paint, W, H - r, L, 0, r + (H - r) / 2, 0));
  g.add(bx(M("#1d2833", "glass"), W * 1.01, H * 0.28, L * 0.92, 0, H * 0.68, -0.1));
  if (o.deck) g.add(bx(M("#1d2833", "glass"), W * 1.01, H * 0.16, L * 0.92, 0, H * 0.36, -0.1));
  g.add(bx(M("#1d2833", "glass"), W * 0.9, H * 0.4, 0.06, 0, H * 0.62, L / 2));
  const wheels = [];
  for (const z of [L / 2 - 2.2, -L / 2 + 2.6]) for (const x of [1, -1]) { const w = wheel(r, 0.3, x * (W / 2 - 0.12), r, z); g.add(w); wheels.push({ o: w, r }); }
  if (o.rails) { g.add(bx(M("#555", "metal"), 0.1, 0.8, 0.1, 0, H + 0.4, 0)); g.add(bx(M("#555", "metal"), 1.4, 0.06, 0.4, 0, H + 0.8, 0)); }
  return anim(g, { wheels, vehicle: "car" });
}
function bike(o) {
  const g = new THREE.Group(), r = o.r || 0.33, m = M(o.color, "paint");
  const wheels = [];
  for (const z of [0.55, -0.55]) { const w = tor(M("#1b1b1b"), r, 0.04 * (o.motor ? 2 : 1), 0, r, z); w.rotation.y = PI / 2; g.add(w); wheels.push({ o: w, r, axis: "x" }); }
  g.add(rot(cy(m, 0.025, 0.025, 1.1, 0, r + 0.25, 0), PI / 2 - 0.3, 0, 0));
  g.add(rot(cy(m, 0.025, 0.025, 0.6, 0, r + 0.2, 0.45), 0.35, 0, 0));
  g.add(bx(M("#222"), 0.25, 0.06, 0.3, 0, r + 0.45, -0.25));
  g.add(bx(M("#666", "metal"), 0.6, 0.04, 0.04, 0, r + 0.6, 0.55));
  if (o.motor) { g.add(bx(m, 0.35, 0.35, 0.8, 0, r + 0.2, 0)); g.add(sp(m, 0.2, 0, r + 0.5, 0.2, 1, 0.8, 1.4)); }
  return anim(g, { wheels, vehicle: "car" });
}
function tank(o) {
  const g = new THREE.Group(), m = M(o.color, "clay");
  g.add(bx(m, 3.4, 1.0, 7, 0, 0.95, 0)); for (const s of [1, -1]) g.add(bx(M("#2b2b26"), 0.7, 0.9, 7.4, s * 1.75, 0.45, 0));
  const tur = new THREE.Group(); tur.position.y = 1.45; g.add(tur);
  tur.add(bx(m, 2.4, 0.8, 3, 0, 0.4, -0.3)); const barrel = cy(m, 0.1, 0.12, 4.5, 0, 0.45, 3.3); barrel.rotation.x = PI / 2; tur.add(barrel);
  return anim(g, { vehicle: "tracked" });
}
function tractor(o) {
  const g = new THREE.Group(), m = M(o.color, "paint");
  g.add(bx(m, 1.2, 0.9, 2.4, 0, 1.0, 0.4)); g.add(bx(M("#1d2833", "glass", { opacity: 0.6 }), 1.3, 1.1, 1.3, 0, 2.0, -0.6)); g.add(bx(m, 1.4, 0.08, 1.4, 0, 2.6, -0.6));
  const wheels = []; for (const s of [1, -1]) { const a = wheel(0.8, 0.5, s * 0.9, 0.8, -0.8); const b = wheel(0.45, 0.3, s * 0.75, 0.45, 1.3); g.add(a, b); wheels.push({ o: a, r: 0.8 }, { o: b, r: 0.45 }); }
  g.add(cy(M("#333", "metal"), 0.06, 0.06, 0.9, 0.3, 1.9, 1.0));
  return anim(g, { wheels, vehicle: "car" });
}
function forklift(o) {
  const g = new THREE.Group(), m = M(o.color, "paint");
  g.add(bx(m, 1.1, 1.0, 1.8, 0, 0.8, 0)); g.add(bx(M("#333", "metal"), 1.0, 2.2, 0.1, 0, 1.4, 1.0)); for (const s of [1, -1]) g.add(bx(M("#555", "metal"), 0.12, 0.05, 1.1, s * 0.3, 0.2, 1.55));
  for (const s of [1, -1]) g.add(cy(M("#333", "metal"), 0.03, 0.03, 1.6, s * 0.5, 1.9, -0.4));
  g.add(bx(M("#333", "metal"), 1.1, 0.06, 1.2, 0, 2.7, -0.2));
  const wheels = []; for (const [x, z] of [[1, 0.6], [-1, 0.6], [1, -0.6], [-1, -0.6]]) { const w = wheel(0.3, 0.2, x * 0.55, 0.3, z); g.add(w); wheels.push({ o: w, r: 0.3 }); }
  return anim(g, { wheels, vehicle: "car" });
}
function train(o) {
  const g = new THREE.Group(), r = 0.45;
  const wheels = [];
  const unit = (z, len, color, front) => {
    g.add(bx(M(color, "paint"), 3, 3.4, len, 0, r + 1.9, z));
    g.add(bx(M("#1d2833", "glass"), 3.02, 0.9, len * 0.9, 0, r + 2.5, z));
    if (front) g.add(bx(M("#1d2833", "glass"), 2.6, 1.0, 0.08, 0, r + 2.6, z + len / 2));
    for (const zz of [z + len / 2 - 2, z - len / 2 + 2]) for (const s of [1, -1]) { const w = wheel(r, 0.2, s * 1.2, r, zz); g.add(w); wheels.push({ o: w, r }); }
  };
  unit(0, 16, o.color, true); unit(-16.6, 16, o.color2 || o.color); unit(-33.2, 16, o.color2 || o.color);
  return anim(g, { wheels, vehicle: "car" });
}

/* aircraft */
function airliner(o) {
  const g = new THREE.Group(), w = M(o.color, "paint"), acc = M(o.color2 || "#2f5ea8", "paint");
  const f = cy(w, 2, 2, 34, 0, 4, 0, 20); f.rotation.x = PI / 2; g.add(f);
  g.add(sp(w, 2, 0, 4, 17, 1, 1, 1.4)); const tail = cn(w, 2, 6, 0, 4.4, -19.5, 20); tail.rotation.x = -PI / 2; g.add(tail);
  g.add(bx(acc, 34, 0.35, 5, 0, 3.2, 0.5)); g.add(bx(acc, 12, 0.25, 2.8, 0, 5, -18.5)); g.add(bx(acc, 0.35, 7, 4, 0, 8, -18.5));
  for (const s of [1, -1]) { const e = cy(M("#bbbbbb", "metal"), 0.9, 0.8, 3.6, s * 6, 2.3, 1.5, 14); e.rotation.x = PI / 2; g.add(e); }
  g.add(bx(M("#1d2833", "glass"), 0.06, 0.4, 28, 2.01, 4.6, 0)); g.add(bx(M("#1d2833", "glass"), 0.06, 0.4, 28, -2.01, 4.6, 0));
  for (const z of [10, -2]) g.add(cy(M("#333"), 0.15, 0.15, 2.2, 0, 1.1, z));
  return anim(g, { flyer: "plane", liftH: 0 });
}
function smallPlane(o) {
  const g = new THREE.Group(), w = M(o.color, "paint"), acc = M(o.color2 || "#c23e29", "paint");
  const f = cap(w, 0.6, 5.5, 0, 1.2, 0, 14); f.rotation.x = PI / 2; g.add(f);
  g.add(bx(acc, 10, 0.12, 1.5, 0, 1.75, 0.6)); g.add(bx(acc, 3.2, 0.1, 0.9, 0, 1.5, -3.2)); g.add(bx(acc, 0.1, 1.3, 1, 0, 2.1, -3.2));
  g.add(bx(M("#1d2833", "glass"), 0.9, 0.5, 1.4, 0, 1.85, 1.2));
  const prop = new THREE.Group(); prop.position.set(0, 1.2, 3.4); prop.add(bx(M("#222"), 2, 0.12, 0.04)); g.add(prop);
  for (const s of [1, -1]) g.add(cy(M("#222"), 0.25, 0.25, 0.15, s * 1, 0.3, 0.8).rotateZ(PI / 2));
  return anim(g, { flyer: "plane", spin: [{ o: prop, axis: "z", rate: 40 }] });
}
function jet(o) {
  const g = new THREE.Group(), w = M(o.color, "paint");
  const f = cn(w, 0.9, 15, 0, 1.6, 0, 14); f.rotation.x = PI / 2; g.add(f);
  const s = new THREE.Shape(); s.moveTo(0, 3); s.lineTo(6, -3); s.lineTo(-6, -3); s.closePath();
  const wg = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: false }); wg.rotateX(-PI / 2); g.add(mk(wg, w, 0, 1.5, -1.5));
  g.add(bx(w, 0.15, 2.8, 2.5, 0, 3, -5.8)); g.add(bx(M("#1d2833", "glass"), 0.8, 0.6, 2.5, 0, 2.4, 3.2));
  g.add(cy(M("#ff9b40", "emit"), 0.5, 0.4, 0.2, 0, 1.6, -7.4).rotateX(PI / 2));
  return anim(g, { flyer: "plane" });
}
function helicopter(o) {
  const g = new THREE.Group(), w = M(o.color, "paint");
  g.add(sp(w, 1.4, 0, 2.0, 0.5, 1, 1, 1.6)); g.add(sp(M("#1d2833", "glass"), 1.15, 0, 2.2, 1.6, 0.9, 0.85, 0.9));
  const boom = cy(w, 0.18, 0.35, 6, 0, 2.3, -4); boom.rotation.x = PI / 2; g.add(boom); g.add(bx(w, 0.12, 1.4, 1, 0, 2.9, -6.8));
  for (const s of [1, -1]) { g.add(bx(M("#333", "metal"), 0.1, 0.1, 3.4, s * 1.1, 0.25, 0.4)); g.add(bx(M("#333", "metal"), 0.08, 0.6, 0.08, s * 1.1, 0.6, 1.2)); g.add(bx(M("#333", "metal"), 0.08, 0.6, 0.08, s * 1.1, 0.6, -0.5)); }
  g.add(cy(M("#333"), 0.15, 0.15, 0.6, 0, 3.6, 0.4));
  const rotor = new THREE.Group(); rotor.position.set(0, 3.95, 0.4); rotor.add(bx(M("#222"), 11, 0.06, 0.35)); rotor.add(bx(M("#222"), 0.35, 0.06, 11)); g.add(rotor);
  const tr = new THREE.Group(); tr.position.set(0.15, 3, -6.8); tr.add(bx(M("#222"), 0.05, 1.8, 0.2)); g.add(tr);
  return anim(g, { flyer: "heli", spin: [{ o: rotor, axis: "y", rate: 28 }, { o: tr, axis: "x", rate: 40 }] });
}
function drone(o) {
  const g = new THREE.Group(), w = M(o.color, "paint"); g.add(bx(w, 0.25, 0.08, 0.25, 0, 0.12, 0)); const spin = [];
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { g.add(bx(w, 0.03, 0.03, 0.25, x * 0.1, 0.12, z * 0.1).rotateY(x * z * PI / 4)); const p = new THREE.Group(); p.position.set(x * 0.18, 0.17, z * 0.18); p.add(bx(M("#222"), 0.2, 0.01, 0.03)); g.add(p); spin.push({ o: p, axis: "y", rate: 60 }); }
  g.add(sp(M("#111", "glass"), 0.04, 0, 0.06, 0.12));
  return anim(g, { flyer: "heli", spin });
}
function balloon(o) {
  const g = new THREE.Group(); g.add(sp(M(o.color, "resin"), 8, 0, 15, 0, 1, 1.15, 1, 20)); g.add(cn(M(o.color, "resin"), 4, 5, 0, 7.3, 0, 16).rotateX(PI));
  g.add(bx(M("#7a5a35", "clay"), 1.4, 1.1, 1.4, 0, 0.55, 0)); for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) g.add(cy(M("#444"), 0.02, 0.02, 4.4, x * 0.6, 3.2, z * 0.6));
  return anim(g, { flyer: "drift" });
}
function blimp(o) { const g = new THREE.Group(); g.add(sp(M(o.color, "paint"), 5, 0, 8, 0, 1, 1, 4, 20)); g.add(bx(M("#333"), 1.5, 1.2, 4, 0, 2.6, 2)); for (const s of [1, -1]) g.add(bx(M(o.color, "paint"), 0.2, 3, 3, s * 2, 8, -17)); g.add(bx(M(o.color, "paint"), 0.2, 3, 3, 0, 10, -17)); return anim(g, { flyer: "drift" }); }

/* boats */
function hull(m, L, W, H, y = 0) { const s = new THREE.Shape(); s.moveTo(-W / 2, H); s.lineTo(W / 2, H); s.lineTo(W * 0.32, 0); s.lineTo(-W * 0.32, 0); s.closePath(); const g = new THREE.ExtrudeGeometry(s, { depth: L * 0.82, bevelEnabled: false }); g.translate(0, y, -L / 2); const me = mk(g, m); const bow = cn(m, W / 2, L * 0.18, 0, y + H / 2, L * 0.41 + L * 0.09, 4); bow.rotation.x = PI / 2; bow.rotation.y = PI / 4; bow.scale.set(1, 1, H / W * 1.5); return [me, bow]; }
function boat(o) {
  const g = new THREE.Group(), m = M(o.color, "paint"), L = o.L, W = o.W, H = o.H || L * 0.12;
  hull(m, L, W, H, -H * 0.45).forEach(x => g.add(x));
  g.add(bx(M(o.deck || "#c9b28a", "clay"), W * 0.9, 0.05, L * 0.8, 0, H * 0.55, -L * 0.04));
  if (o.type === "sail") { g.add(cy(M("#ddd", "metal"), 0.06, 0.08, L * 1.2, 0, L * 0.6 + H * 0.5, L * 0.08)); const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0, L * 1.05); s.lineTo(-L * 0.45, 0); s.closePath(); const sg = new THREE.ShapeGeometry(s); sg.rotateY(PI / 2); g.add(mk(sg, M("#f4f1ea", "flat", { side: 1 }), 0, H * 0.7, L * 0.08)); }
  if (o.type === "cabin") { g.add(bx(M("#f2f2f0", "paint"), W * 0.7, H * 1.1, L * 0.35, 0, H * 1.1, -L * 0.05)); g.add(bx(M("#1d2833", "glass"), W * 0.72, H * 0.4, L * 0.3, 0, H * 1.3, -L * 0.03)); }
  if (o.type === "cargo") {
    g.add(bx(M("#f2f2f0", "paint"), W * 0.8, H * 2.2, L * 0.1, 0, H * 1.6, -L * 0.38)); g.add(bx(M("#1d2833", "glass"), W * 0.82, H * 0.4, L * 0.105, 0, H * 2.5, -L * 0.38));
    const cols = ["#b23b2e", "#2e5fa8", "#d38c2a", "#3d7a4c", "#7a4fc4", "#888"]; for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) g.add(bx(M(cols[(i + j * 3) % 6], "clay"), W * 0.8, 2.5, L * 0.1, 0, H * 0.6 + 1.3 + j * 2.6, L * 0.3 - i * L * 0.11));
  }
  if (o.type === "ferry") { g.add(bx(M("#f2f2f0", "paint"), W * 0.95, H * 1.6, L * 0.75, 0, H * 1.3, 0)); g.add(bx(M("#1d2833", "glass"), W * 0.96, H * 0.5, L * 0.7, 0, H * 1.5, 0)); g.add(cy(M(o.color, "paint"), 0.6, 0.7, H * 1.5, 0, H * 2.8, -L * 0.15)); }
  if (o.type === "speed") { g.add(bx(M("#1d2833", "glass", { opacity: 0.7 }), W * 0.8, 0.5, 0.1, 0, H * 0.85, L * 0.05).rotateX(-0.6)); }
  if (o.type === "sub") { g.children.length = 0; g.add(rot(cap(m, W / 2, L - W, 0, 0, 0, 16), PI / 2)); g.add(bx(m, W * 0.3, H * 1.2, L * 0.15, 0, W * 0.6, L * 0.1)); }
  return anim(g, { boat: true });
}

/* ======================================================================
   NATURE
   ====================================================================== */
function tree(o) {
  const g = new THREE.Group(), tr = M(o.trunk || "#6b4a2e", "clay"), lf = M(o.color, "leaf"), H = o.H;
  switch (o.type) {
    case "pine": g.add(cy(tr, 0.12 * H / 8, 0.2 * H / 8, H * 0.3, 0, H * 0.15, 0, 8)); for (let i = 0; i < 4; i++) g.add(cn(lf, H * (0.3 - i * 0.055), H * 0.32, 0, H * (0.32 + i * 0.16), 0, 9)); if (o.snow) g.add(cn(M("#f4f6f8", "leaf"), H * 0.1, H * 0.12, 0, H * 0.84, 0, 9)); break;
    case "palm": { const n = 6; let x = 0, y = 0; for (let i = 0; i < n; i++) { const seg = cy(tr, 0.14, 0.18, H / n, x, y + H / n / 2, 0, 8); seg.rotation.z = -0.06 * i; g.add(seg); x += Math.sin(0.06 * i) * H / n; y += H / n; } for (let i = 0; i < 7; i++) { const a = i / 7 * PI * 2; const f = bx(lf, 0.5, 0.05, H * 0.42, x + Math.sin(a) * H * 0.18, y - 0.25, Math.cos(a) * H * 0.18); f.rotation.y = a; f.rotation.x = 0.55; g.add(f); } g.add(sp(M("#5b4021"), 0.25, x, y - 0.1, 0)); break; }
    case "birch": g.add(cy(M("#e9e6dc", "clay"), 0.12, 0.16, H * 0.7, 0, H * 0.35, 0, 8)); g.add(sp(lf, H * 0.22, 0, H * 0.72, 0, 0.8, 1.3, 0.8, 9)); break;
    case "dead": g.add(cy(tr, 0.12, 0.25, H * 0.8, 0, H * 0.4, 0, 7)); for (let i = 0; i < 4; i++) { const b = cy(tr, 0.04, 0.08, H * 0.35, 0, H * (0.5 + i * 0.1), 0, 5); b.rotation.z = (i % 2 ? 1 : -1) * 0.8; b.rotation.y = i; b.position.x = (i % 2 ? -1 : 1) * H * 0.1; g.add(b); } break;
    case "willow": g.add(cy(tr, 0.25, 0.4, H * 0.5, 0, H * 0.25, 0, 8)); g.add(sp(lf, H * 0.35, 0, H * 0.6, 0, 1, 0.9, 1, 10)); for (let i = 0; i < 10; i++) { const a = i / 10 * PI * 2; g.add(bx(lf, 0.5, H * 0.45, 0.1, Math.sin(a) * H * 0.33, H * 0.4, Math.cos(a) * H * 0.33).rotateY(a)); } break;
    default: g.add(cy(tr, 0.15 * H / 7, 0.24 * H / 7, H * 0.5, 0, H * 0.25, 0, 8));
      g.add(sp(lf, H * 0.26, 0, H * 0.66, 0, 1, 0.9, 1, 9)); g.add(sp(lf, H * 0.19, H * 0.15, H * 0.56, H * 0.05, 1, 0.9, 1, 8)); g.add(sp(lf, H * 0.18, -H * 0.13, H * 0.6, -H * 0.08, 1, 0.9, 1, 8));
  }
  return g;
}
function rockG(o) {
  const g = new THREE.Group(), m = M(o.color, "rock");
  const geo = new THREE.IcosahedronGeometry(0.5, 1); const p = geo.attributes.position; const r = mulberry32(o.seed || 3);
  for (let i = 0; i < p.count; i++) { const k = 0.8 + r() * 0.4; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); } geo.computeVertexNormals();
  geo.scale(o.w, o.h * 2, o.d); g.add(mk(geo, m, 0, o.h * 0.35, 0)); return g;
}
function mountain(o) {
  const g = new THREE.Group(), geo = new THREE.ConeGeometry(0.5, 1, 9, 4); const p = geo.attributes.position; const r = mulberry32(o.seed || 9);
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < 0.49) { const k = 0.82 + r() * 0.36; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); p.setY(i, y + (r() - 0.5) * 0.06); } }
  geo.computeVertexNormals(); geo.scale(o.w, o.h, o.d); g.add(mk(geo, M(o.color, "rock"), 0, o.h / 2, 0));
  if (o.snow) { const cap2 = new THREE.ConeGeometry(0.5, 1, 9, 1); cap2.scale(o.w * 0.3, o.h * 0.3, o.d * 0.3); g.add(mk(cap2, M("#f3f5f7", "rock"), 0, o.h * 0.86, 0)); }
  return g;
}

/* ======================================================================
   BUILDINGS (parametric: get real w,h,d)
   ====================================================================== */
function facadeBox(w, h, d, style, color, roof, seed) {
  const g = new THREE.Group();
  const floorH = style === "glass" ? 3.6 : 3.1, cellW = style === "glass" ? 3 : 3.2;
  const f = facadeTex(style, color, 4, 8, seed);
  const mkSide = (len) => { const m = M(color, style === "glass" ? "glass" : "clay", { unique: true, map: f.map.clone(), emap: f.emap.clone() }); m.color.set("#ffffff"); m.userData.baseColor = new THREE.Color("#ffffff"); [m.map, m.emissiveMap].forEach(t => { t.needsUpdate = true; t.repeat.set(len / cellW / 4, h / floorH / 8); }); if (style === "glass") { m.metalness = 0.55; m.roughness = 0.15; } return m; };
  const sx = mkSide(d), sz = mkSide(w), top = M(roof || "#77736b", "clay");
  g.add(mk(new THREE.BoxGeometry(w, h, d), [sx, sx, top, top, sz, sz], 0, h / 2, 0));
  return g;
}
function building(kind, b) {
  const [w, h, d] = b.size, c = b.color, seed = (b.seed || 1);
  const g = new THREE.Group();
  const roofM = M("#5e5a53", "clay");
  switch (kind) {
    case "house": {
      const wallH = h * 0.6; g.add(facadeBox(w, wallH, d, "plaster", c, null, seed));
      const s = new THREE.Shape(); s.moveTo(-w / 2 - 0.3, 0); s.lineTo(w / 2 + 0.3, 0); s.lineTo(0, h - wallH); s.closePath();
      const rg = new THREE.ExtrudeGeometry(s, { depth: d + 0.6, bevelEnabled: false }); rg.translate(0, wallH, -d / 2 - 0.3); g.add(mk(rg, M(b.color2 || "#7b3f32", "clay")));
      g.add(bx(M("#4a3426"), 1.0, 2.1, 0.1, 0, 1.05, d / 2 + 0.03)); g.add(cy(M("#7b3f32"), 0.35, 0.35, 1.6, w * 0.3, h * 0.85, -d * 0.1, 8));
      break;
    }
    case "shop": case "cafe": case "restaurant": case "bar": case "pharmacy": case "bank": case "hotel": {
      const gh = Math.min(4, h * 0.45);
      g.add(facadeBox(w, h, d, "plaster", c, null, seed));
      g.add(bx(M("#1d2833", "glass", { emap: null }), w * 0.86, gh * 0.72, 0.08, 0, gh * 0.45, d / 2 + 0.03));
      const glow = bx(M("#ffd28a", "glow", { strength: 0.6 }), w * 0.84, gh * 0.7, 0.02, 0, gh * 0.45, d / 2 + 0.08); g.add(glow);
      g.add(bx(M("#3a2e25"), 1.1, gh * 0.7, 0.1, w * 0.3, gh * 0.4, d / 2 + 0.06));
      const sign = mk(new THREE.PlaneGeometry(w * 0.8, 0.8), new THREE.MeshStandardMaterial({ map: signTex(b.sign || b.label || kind, b.color2 || "#2b2620", "#f2e6c8"), roughness: 0.8 }), 0, gh + 0.5, d / 2 + 0.06); g.add(sign);
      const awn = bx(M(b.color2 || "#a8452f", "flat"), w * 0.9, 0.08, 1.4, 0, gh - 0.05, d / 2 + 0.7); awn.rotation.x = 0.25; if (kind !== "bank" && kind !== "pharmacy") g.add(awn);
      if (kind === "pharmacy") g.add(bx(M("#2ec060", "emit"), 0.6, 0.6, 0.1, w * 0.42, gh + 0.5, d / 2 + 0.1));
      break;
    }
    case "apartment": case "office": case "hospital": case "school": g.add(facadeBox(w, h, d, kind === "office" ? "glass" : "plaster", c, null, seed)); g.add(bx(M("#4a4640"), w + 0.3, 0.4, d + 0.3, 0, h + 0.2, 0)); g.add(bx(M("#2b2a28"), 1.8, 2.5, 0.1, 0, 1.25, d / 2 + 0.05)); if (kind === "hospital") { g.add(bx(M("#d62828", "emit"), 1.8, 0.5, 0.1, 0, h - 2, d / 2 + 0.06)); g.add(bx(M("#d62828", "emit"), 0.5, 1.8, 0.1, 0, h - 2, d / 2 + 0.06)); } break;
    case "skyscraper": {
      g.add(facadeBox(w, h * 0.7, d, "glass", c, null, seed));
      const t2 = facadeBox(w * 0.75, h * 0.25, d * 0.75, "glass", c, null, seed + 1); t2.position.y = h * 0.7; g.add(t2);
      const t3 = facadeBox(w * 0.45, h * 0.05, d * 0.45, "glass", c, null, seed + 2); t3.position.y = h * 0.95; g.add(t3);
      g.add(cy(M("#999", "metal"), 0.2, 0.3, h * 0.08, 0, h + h * 0.04, 0)); g.add(sp(M("#ff3030", "emit"), 0.4, 0, h * 1.08, 0));
      break;
    }
    case "townhouses": { const n = Math.max(2, Math.round(w / 5)), uw = w / n; const cols = ["#b8735a", "#d8c7a8", "#8a6c5a", "#c9b79c", "#9b5b4a", "#e0d6c2"]; for (let i = 0; i < n; i++) { const u = facadeBox(uw, h - 1.5, d, "brick", cols[(i + seed) % cols.length], null, seed + i); u.position.x = -w / 2 + uw * (i + 0.5); g.add(u); const r2 = bx(roofM, uw, 1.5, d * 0.9, u.position.x, h - 0.75, 0); g.add(r2); g.add(bx(M("#1f2f3f"), 0.95, 2.1, 0.08, u.position.x, 1.05, d / 2 + 0.04)); } break; }
    case "warehouse": case "hangar": case "factory": case "barn": {
      g.add(facadeBox(w, h * 0.65, d, kind === "barn" ? "brick" : "plaster", c, null, seed));
      const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h * 0.35); s.closePath();
      if (kind === "hangar") { g.children.length = 0; const a2 = new THREE.CylinderGeometry(w / 2, w / 2, d, 28, 1, true, -PI / 2, PI); a2.rotateX(-PI / 2); g.add(mk(a2, M(c, "metal", { side: 1 }))); }
      else { const rg = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }); rg.translate(0, h * 0.65, -d / 2); g.add(mk(rg, M(kind === "barn" ? "#5a3426" : "#7a7a78", "clay"))); }
      g.add(bx(M("#3a3632"), Math.min(6, w * 0.4), Math.min(5, h * 0.5), 0.1, 0, Math.min(5, h * 0.5) / 2, d / 2 + 0.05));
      if (kind === "factory") for (let i = 0; i < 2; i++) g.add(cy(M("#8a5a48"), 0.9, 1.2, h * 1.4, -w * 0.3 + i * 3, h * 0.7, -d * 0.3, 12));
      break;
    }
    case "church": {
      g.add(facadeBox(w, h * 0.45, d, "plaster", c, null, seed));
      const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h * 0.2); s.closePath(); const rg = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }); rg.translate(0, h * 0.45, -d / 2); g.add(mk(rg, roofM));
      g.add(facadeBox(w * 0.3, h * 0.75, w * 0.3, "plaster", c, null, seed + 1).translateZ(d / 2 - w * 0.15)); g.add(cn(roofM, w * 0.22, h * 0.25, 0, h * 0.875, d / 2 - w * 0.15, 4).rotateY(PI / 4));
      break;
    }
    case "gas_station": {
      g.add(bx(M("#e8e8e4"), w, 0.5, d * 0.5, 0, 5, d * 0.15)); for (const [x, z] of [[1, 1], [-1, 1]]) g.add(cy(M("#d0d0cc"), 0.25, 0.25, 5, x * w * 0.35, 2.5, d * 0.3));
      for (const x of [-w * 0.2, w * 0.2]) g.add(bx(M(c, "paint"), 0.7, 1.6, 0.5, x, 0.8, d * 0.15));
      g.add(facadeBox(w * 0.5, 3.5, d * 0.3, "shop", "#e8e3d6", null, seed).translateZ(-d * 0.3)); g.add(bx(M(c, "flat"), w * 1.01, 0.6, d * 0.505, 0, 5, d * 0.15));
      break;
    }
    case "lighthouse": g.add(cy(M(c), w * 0.35, w * 0.5, h * 0.8, 0, h * 0.4, 0, 16)); g.add(cy(M("#c23e29"), w * 0.3, w * 0.33, h * 0.12, 0, h * 0.3, 0, 16)); g.add(cy(M("#fff4c0", "emit"), w * 0.28, w * 0.28, h * 0.1, 0, h * 0.85, 0, 12)); g.add(cn(M("#c23e29"), w * 0.33, h * 0.1, 0, h * 0.95, 0, 12)); break;
    case "castle_tower": g.add(cy(M(c, "rock"), w / 2, w / 2 * 1.05, h * 0.85, 0, h * 0.425, 0, 12)); for (let i = 0; i < 8; i++) { const a = i / 8 * PI * 2; g.add(bx(M(c, "rock"), w * 0.18, h * 0.12, w * 0.18, Math.sin(a) * w * 0.45, h * 0.9, Math.cos(a) * w * 0.45)); } break;
    case "hut": g.add(bx(M(c), w, h * 0.55, d, 0, h * 0.275, 0)); g.add(cn(M("#9a7b4a", "leaf"), Math.max(w, d) * 0.78, h * 0.5, 0, h * 0.8, 0, 4).rotateY(PI / 4)); g.add(bx(M("#3a2a1c"), 0.8, 1.6, 0.1, 0, 0.8, d / 2 + 0.05)); break;
    case "control_tower": g.add(cy(M(c), w * 0.25, w * 0.32, h * 0.8, 0, h * 0.4, 0, 12)); g.add(cy(M("#1d2833", "glass"), w * 0.5, w * 0.4, h * 0.12, 0, h * 0.86, 0, 12)); g.add(cy(M(c), w * 0.52, w * 0.52, h * 0.04, 0, h * 0.94, 0, 12)); break;
    case "stadium": { const ring = new THREE.CylinderGeometry(w / 2, w / 2 * 0.85, h, 40, 1, true); g.add(mk(ring, M(c, "clay", { side: 1 }), 0, h / 2, 0)); g.add(cy(M("#4f8a3a", "flat"), w * 0.35, w * 0.35, 0.1, 0, 0.05, 0, 32)); break; }
    case "pyramid": g.add(cn(M(c, "rock"), w * 0.71, h, 0, h / 2, 0, 4).rotateY(PI / 4)); break;
    case "temple": g.add(bx(M(c), w, 1, d, 0, 0.5, 0)); for (let i = 0; i < 6; i++) for (const z of [-d * 0.4, d * 0.4]) g.add(cy(M(c), 0.4, 0.45, h * 0.7, -w * 0.4 + i * w * 0.16, 1 + h * 0.35, z)); g.add(bx(M(c), w, 0.8, d, 0, 1 + h * 0.7 + 0.4, 0)); { const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h * 0.18); s.closePath(); const rg = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }); rg.translate(0, 1.8 + h * 0.7, -d / 2); g.add(mk(rg, M(c))); } break;
    case "garage": g.add(facadeBox(w, h, d, "plaster", c, null, seed)); g.add(bx(M("#8a8a86", "metal"), w * 0.8, h * 0.75, 0.08, 0, h * 0.375, d / 2 + 0.04)); break;
    case "container": { g.add(bx(M(c, "metal"), w, h, d, 0, h / 2, 0)); for (let i = -4; i <= 4; i++) g.add(bx(M(c, "metal"), 0.04, h * 0.9, d * 1.005, 0, h / 2, 0).translateX(i * w / 10)); break; }
    case "silo": g.add(cy(M(c, "metal"), w / 2, w / 2, h * 0.88, 0, h * 0.44, 0, 20)); g.add(sp(M(c, "metal"), w / 2, 0, h * 0.88, 0, 1, 0.5, 1)); break;
    case "water_tower": for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) g.add(cy(M("#5a4a3a"), 0.12, 0.12, h * 0.55, x * w * 0.3, h * 0.275, z * w * 0.3)); g.add(cy(M(c), w / 2, w / 2, h * 0.35, 0, h * 0.73, 0, 16)); g.add(cn(M(c), w * 0.55, h * 0.12, 0, h * 0.96, 0, 16)); break;
    case "bus_shelter": g.add(bx(M("#333", "metal"), w, 0.1, d, 0, h, 0)); g.add(bx(M("#9fb4c4", "glass", { opacity: 0.5 }), w, h * 0.9, 0.04, 0, h * 0.5, -d / 2)); g.add(bx(M("#666", "metal"), w * 0.8, 0.08, 0.4, 0, 0.45, -d * 0.2)); g.add(bx(M("#f0d050", "emit"), 0.8, 1.2, 0.05, w / 2 - 0.4, h * 0.6, -d / 2 + 0.05)); break;
    case "market_stall": g.add(bx(M("#8a6a44"), w, 0.9, d * 0.5, 0, 0.45, d * 0.2)); for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) g.add(cy(M("#5a4430"), 0.05, 0.05, h, x * w * 0.48, h / 2, z * d * 0.45)); g.add(bx(M(c, "flat"), w * 1.05, 0.08, d * 1.05, 0, h, 0).rotateX(0.12)); for (let i = 0; i < 6; i++) g.add(sp(M(pick(["#d6553a", "#efbf35", "#8cbc3a", "#e5832a"])), 0.18, -w * 0.4 + i * w * 0.16, 1.0, d * 0.25)); break;
    case "tent": { const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath(); const tg = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }); tg.translate(0, 0, -d / 2); g.add(mk(tg, M(c, "flat"))); break; }
    case "fountain": g.add(cy(M("#bcb6aa"), w / 2, w / 2, 0.6, 0, 0.3, 0, 24)); g.add(cy(M("#4d86a8", "water"), w / 2 - 0.25, w / 2 - 0.25, 0.05, 0, 0.55, 0, 24)); g.add(cy(M("#bcb6aa"), 0.3, 0.4, h * 0.6, 0, h * 0.3, 0)); g.add(cy(M("#bcb6aa"), w * 0.2, w * 0.15, 0.2, 0, h * 0.6, 0)); g.add(cn(M("#cfe8f4", "water"), w * 0.18, h * 0.4, 0, h * 0.8, 0)); break;
    case "statue": g.add(bx(M("#a8a39a"), w, h * 0.35, d, 0, h * 0.175, 0)); { const st = human({ h: h * 0.65, color: c, skin: c, pants: c, kind: "metal" }); st.position.y = h * 0.35; g.add(st); BR.poseHuman(st.userData.rig, { pose: "point", t: 0 }); } break;
    case "helipad": g.add(cy(M("#4a4a4c"), w / 2, w / 2, 0.15, 0, 0.075, 0, 32)); g.add(bx(M("#f2f2f2", "flat"), 0.6, 0.02, w * 0.4, -w * 0.12, 0.16, 0)); g.add(bx(M("#f2f2f2", "flat"), 0.6, 0.02, w * 0.4, w * 0.12, 0.16, 0)); g.add(bx(M("#f2f2f2", "flat"), w * 0.24, 0.02, 0.6, 0, 0.16, 0)); g.add(tor(M("#f2f2f2", "flat"), w * 0.42, 0.12, 0, 0.16, 0).rotateX(PI / 2)); break;
  }
  return g;
}

/* roads, water and ground pieces (parametric) */
function road(kind, b) {
  const [w, h, d] = b.size, g = new THREE.Group();
  if (kind === "road" || kind === "highway" || kind === "runway") {
    const lanes = kind === "runway" ? 1 : Math.max(1, Math.round(w / 3.5));
    const t = stripeTex(kind === "runway" ? "runway" : "road").clone(); t.needsUpdate = true; t.repeat.set(kind === "runway" ? 1 : lanes / 2, d / 8);
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, envMapIntensity: 0.3 }); m.userData.baseEnv = 0.3; m.userData.baseColor = new THREE.Color(0xffffff);
    const top = mk(new THREE.PlaneGeometry(w, d).rotateX(-PI / 2), m, 0, 0.02, 0); top.castShadow = false; g.add(top);
    if (kind === "highway") g.add(bx(M("#b9b6b0"), 0.4, 0.8, d, 0, 0.4, 0));
    if (b.sidewalk !== false && kind === "road") for (const s of [1, -1]) { const sw = bx(M("#b7b2a8"), 3, 0.15, d, s * (w / 2 + 1.5), 0.075, 0); sw.castShadow = false; g.add(sw); g.add(bx(M("#8f8a80"), 0.2, 0.18, d, s * (w / 2 + 0.1), 0.09, 0)); }
  } else if (kind === "crossroads") {
    const m = M("#3d3d3f", "flat"); const a = mk(new THREE.PlaneGeometry(w, w).rotateX(-PI / 2), m, 0, 0.021, 0); a.castShadow = false; g.add(a);
    for (const s of [1, -1]) for (const s2 of [1, -1]) g.add(bx(M("#b7b2a8"), 3, 0.15, 3, s * (w / 2 + 1.5), 0.075, s2 * (w / 2 + 1.5)));
  } else if (kind === "crosswalk") {
    const t = stripeTex("zebra").clone(); t.needsUpdate = true; t.repeat.set(1, w / 2.4); const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }); m.userData.baseColor = new THREE.Color(0xffffff);
    const z = mk(new THREE.PlaneGeometry(d, w).rotateX(-PI / 2).rotateY(PI / 2), m, 0, 0.03, 0); z.castShadow = false; g.add(z);
  } else if (kind === "sidewalk" || kind === "plaza" || kind === "path" || kind === "parking") {
    const c = kind === "path" ? "#b59c78" : kind === "parking" ? "#4a4a4c" : "#bdb7ab"; const p = bx(M(c), w, 0.1, d, 0, 0.05, 0); p.castShadow = false; g.add(p);
    if (kind === "parking") for (let i = -Math.floor(d / 2.6 / 2); i <= Math.floor(d / 2.6 / 2); i++) g.add(bx(M("#eeeeea", "flat"), w * 0.45, 0.02, 0.1, -w * 0.2, 0.11, i * 2.6));
  } else if (kind === "rails") {
    for (const s of [1, -1]) g.add(bx(M("#777", "metal"), 0.08, 0.15, d, s * 0.72, 0.25, 0));
    for (let z = -d / 2; z < d / 2; z += 0.7) g.add(bx(M("#5a4430"), 2.4, 0.14, 0.25, 0, 0.1, z));
    g.add(bx(M("#8a8478", "rock"), 3.2, 0.12, d, 0, 0.03, 0));
  } else if (kind === "bridge") {
    g.add(bx(M(b.color), w, 0.8, d, 0, h, 0)); for (const s of [1, -1]) g.add(bx(M(b.color), 0.3, 1.1, d, s * (w / 2 - 0.15), h + 0.95, 0));
    for (const z of [-d * 0.3, d * 0.3]) for (const s of [1, -1]) g.add(bx(M(b.color), 1, h, 1, s * (w / 2 - 0.7), h / 2, z));
    const t = stripeTex("road").clone(); t.needsUpdate = true; t.repeat.set(1, d / 8); const rm = new THREE.MeshStandardMaterial({ map: t, roughness: .9 }); rm.userData.baseColor = new THREE.Color(0xffffff); g.add(mk(new THREE.PlaneGeometry(w - 0.8, d).rotateX(-PI / 2), rm, 0, h + 0.41, 0));
  } else if (kind === "pier") {
    g.add(bx(M(b.color), w, 0.25, d, 0, h, 0)); for (let z = -d / 2 + 1; z < d / 2; z += 3) for (const s of [1, -1]) g.add(cy(M("#4a3626"), 0.15, 0.15, h + 2, s * (w / 2 - 0.2), (h - 2) / 2, z, 8));
  } else if (kind === "fence" || kind === "railing") {
    const n = Math.max(2, Math.round(w / 2)); for (let i = 0; i <= n; i++) g.add(bx(M(b.color), 0.1, h, 0.1, -w / 2 + i * w / n, h / 2, 0));
    g.add(bx(M(b.color), w, 0.08, 0.06, 0, h * 0.85, 0)); g.add(bx(M(b.color), w, 0.08, 0.06, 0, h * 0.4, 0));
  } else if (kind === "wall_brick" || kind === "wall") { g.add(bx(M(b.color), w, h, d, 0, h / 2, 0)); }
  else if (kind === "guardrail") { for (let i = 0; i <= Math.round(w / 2.5); i++) g.add(bx(M("#888", "metal"), 0.1, 0.7, 0.1, -w / 2 + i * 2.5, 0.35, 0)); g.add(bx(M("#bbb", "metal"), w, 0.3, 0.05, 0, 0.6, 0.06)); }
  else if (kind === "crops") { const t = stripeTex("crops").clone(); t.needsUpdate = true; t.repeat.set(w / 4, 1); const m = new THREE.MeshStandardMaterial({ map: t, roughness: 1 }); m.userData.baseColor = new THREE.Color(0xffffff); g.add(mk(new THREE.BoxGeometry(w, 0.4, d), m, 0, 0.2, 0)); }
  return g;
}
function waterPiece(kind, b) {
  const [w, h, d] = b.size, g = new THREE.Group(), wm = M(b.color, "water");
  if (kind === "river") { const s = mk(new THREE.PlaneGeometry(w, d, 1, 1).rotateX(-PI / 2), wm, 0, 0.02, 0); s.castShadow = false; g.add(s); for (const x of [1, -1]) g.add(bx(M("#7d7258"), 1.4, 0.4, d, x * (w / 2 + 0.5), -0.05, 0).rotateZ(x * 0.35)); }
  else if (kind === "lake" || kind === "pond") { const s = mk(new THREE.CircleGeometry(0.5, 48).rotateX(-PI / 2).scale(w, 1, d), wm, 0, 0.03, 0); s.castShadow = false; g.add(s); const rim = mk(new THREE.RingGeometry(0.49, 0.53, 48).rotateX(-PI / 2).scale(w, 1, d), M("#8f8366"), 0, 0.035, 0); rim.castShadow = false; g.add(rim); }
  else if (kind === "ocean") { const s = mk(new THREE.PlaneGeometry(w, d).rotateX(-PI / 2), wm, 0, 0.0, 0); s.castShadow = false; g.add(s); const foam = mk(new THREE.PlaneGeometry(w, 1.2).rotateX(-PI / 2), M("#eef4f4", "flat"), 0, 0.03, d / 2 - 0.6); foam.castShadow = false; g.add(foam); }
  else if (kind === "pool") { g.add(bx(M("#e9e6df"), w + 1, 0.2, d + 1, 0, 0.1, 0)); const s = mk(new THREE.PlaneGeometry(w, d).rotateX(-PI / 2), M("#5fb6d6", "water"), 0, 0.21, 0); s.castShadow = false; g.add(s); }
  else if (kind === "waterfall") { g.add(mountain({ w: w * 1.6, h: h * 1.1, d: d * 2, color: "#7d7a72" })); g.add(mk(new THREE.PlaneGeometry(w * 0.4, h), M("#d8eef6", "water", { side: 1 }), 0, h / 2, d * 0.55)); }
  return g;
}
function ground(b) {
  const [w, h, d] = b.size; const g = new THREE.Group();
  const m = b.ground === "water" ? M(b.color, "water") : M(b.color, "flat");
  const p = mk(new THREE.BoxGeometry(w, h, d), m, 0, h / 2, 0); p.castShadow = false; g.add(p); return g;
}

/* furniture & props (scaled) */
function seat(c, sofa) { const g = new THREE.Group(), m = M(c); if (sofa) { g.add(bx(m, 2.0, 0.45, 0.9, 0, 0.25, 0)); g.add(bx(m, 2.0, 0.5, 0.2, 0, 0.7, -0.35)); for (const s of [1, -1]) g.add(bx(m, 0.2, 0.3, 0.9, s * 0.9, 0.6, 0)); } else { g.add(bx(m, 0.45, 0.06, 0.45, 0, 0.45, 0)); g.add(bx(m, 0.45, 0.5, 0.05, 0, 0.72, -0.2)); for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) g.add(bx(m, 0.04, 0.45, 0.04, x * 0.2, 0.22, z * 0.2)); } return g; }
function table(c, w = 1.2, d = 0.8, h = 0.75, round) { const g = new THREE.Group(), m = M(c); if (round) { g.add(cy(m, w / 2, w / 2, 0.05, 0, h, 0, 20)); g.add(cy(m, 0.05, 0.05, h, 0, h / 2, 0)); g.add(cy(m, 0.25, 0.25, 0.03, 0, 0.02, 0)); } else { g.add(bx(m, w, 0.05, d, 0, h, 0)); for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) g.add(bx(m, 0.05, h, 0.05, x * (w / 2 - 0.05), h / 2, z * (d / 2 - 0.05))); } return g; }
function lamp(c, h = 5.5) {
  const g = new THREE.Group(); g.add(cy(M(c, "metal"), 0.07, 0.1, h, 0, h / 2, 0)); g.add(bx(M(c, "metal"), 0.08, 0.08, 1.0, 0, h - 0.04, 0.45));
  g.add(bx(M("#fff1c4", "emit"), 0.35, 0.1, 0.25, 0, h - 0.12, 0.9));
  const pool = mk(new THREE.CircleGeometry(3.2, 24).rotateX(-PI / 2), M("#ffcf87", "glow", { strength: 0.35 }), 0, 0.05, 0.9); pool.castShadow = pool.receiveShadow = false; g.add(pool);
  return g;
}
function trafficLight() { const g = new THREE.Group(); g.add(cy(M("#2b2b2b", "metal"), 0.07, 0.08, 3.4, 0, 1.7, 0)); g.add(bx(M("#222"), 0.35, 1.0, 0.3, 0, 3.6, 0)); g.add(sp(M("#d62828", "emit"), 0.1, 0, 3.9, 0.16)); g.add(sp(M("#3a2a0a"), 0.1, 0, 3.6, 0.16)); g.add(sp(M("#0a3a14"), 0.1, 0, 3.3, 0.16)); return g; }
function stageKit(kind, c) {
  const g = new THREE.Group();
  switch (kind) {
    case "mic_stand": g.add(cy(M("#222", "metal"), 0.02, 0.02, 1.5, 0, 0.75, 0)); g.add(cy(M("#222", "metal"), 0.25, 0.25, 0.03, 0, 0.02, 0, 12)); g.add(sp(M("#555", "metal"), 0.045, 0, 1.55, 0.05)); break;
    case "speaker": g.add(bx(M("#1c1c1c"), 0.8, 1.4, 0.6, 0, 0.7, 0)); g.add(cy(M("#333"), 0.25, 0.25, 0.04, 0, 0.5, 0.31).rotateX(PI / 2)); g.add(cy(M("#333"), 0.12, 0.12, 0.04, 0, 1.1, 0.31).rotateX(PI / 2)); break;
    case "drum_kit": g.add(cy(M(c), 0.3, 0.3, 0.45, 0, 0.35, 0).rotateX(PI / 2)); for (const [x, y, z, r] of [[0.45, 0.65, 0.15, 0.2], [-0.45, 0.65, 0.15, 0.2], [0.75, 0.55, -0.2, 0.24]]) g.add(cy(M(c), r, r, 0.22, x, y, z)); g.add(cy(M("#d4b040", "metal"), 0.3, 0.3, 0.01, -0.75, 1.1, -0.1)); g.add(cy(M("#333", "metal"), 0.015, 0.015, 1.1, -0.75, 0.55, -0.1)); break;
    case "dj_booth": g.add(bx(M(c), 2, 1.0, 0.8, 0, 0.5, 0)); g.add(bx(M("#222"), 1.6, 0.06, 0.5, 0, 1.03, 0)); for (const x of [-0.5, 0.5]) g.add(cy(M("#555", "metal"), 0.15, 0.15, 0.03, x, 1.07, 0)); g.add(bx(M("#6db0de", "emit"), 1.9, 0.08, 0.02, 0, 0.6, 0.41)); break;
    case "truss": for (const x of [-1, 1]) g.add(bx(M("#bbb", "metal"), 0.3, 5, 0.3, x * 5, 2.5, 0)); g.add(bx(M("#bbb", "metal"), 10.3, 0.3, 0.3, 0, 5, 0)); for (let i = -2; i <= 2; i++) { const s = cy(M("#222", "metal"), 0.15, 0.2, 0.35, i * 2, 4.7, 0.1); s.rotation.x = 0.6; g.add(s); } break;
    case "spotlight": g.add(cy(M("#222", "metal"), 0.03, 0.03, 1.8, 0, 0.9, 0)); { const h2 = cy(M("#222", "metal"), 0.15, 0.22, 0.4, 0, 1.9, 0.1); h2.rotation.x = 1.1; g.add(h2); } g.add(cy(M("#fff3d0", "emit"), 0.2, 0.2, 0.02, 0, 2.0, 0.28).rotateX(1.1)); break;
    case "piano": g.add(bx(M("#111", "paint"), 1.5, 1.0, 0.6, 0, 0.75, 0)); g.add(bx(M("#f2f2f0"), 1.4, 0.04, 0.2, 0, 0.74, 0.35)); break;
    case "film_light": g.add(cy(M("#333", "metal"), 0.025, 0.025, 2, 0, 1, 0)); g.add(bx(M("#222", "metal"), 0.6, 0.6, 0.2, 0, 2.1, 0)); g.add(bx(M("#fff8e8", "emit"), 0.5, 0.5, 0.02, 0, 2.1, 0.11)); break;
  }
  return g;
}

/* ======================================================================
   CATALOGUE
   size = default [width, height, depth] in metres (depth runs along the object's front +Z)
   kind: actor | animal | vehicle | aircraft | boat | building | nature | water | ground | street | prop | furniture | stage | shape | camera
   param: geometry rebuilt at real size (else built at design size and scaled)
   ====================================================================== */
const SK = ["#8a5a3c", "#5e3a24", "#c48a62", "#e2b48c", "#3e2a1e"];
const C = [];
const add = (type, name, cat, kind, size, color, build, extra = {}) => C.push(Object.assign({ type, name, cat, kind, size, color, build }, extra));

/* people */
add("man", "Man", "People", "actor", [0.5, 1.8, 0.32], "#3a5ec4", b => human({ h: 1.8, color: b.color, skin: b.skin || SK[0], hair: "#1b1410" }));
add("woman", "Woman", "People", "actor", [0.46, 1.68, 0.3], "#c43f86", b => human({ h: 1.68, color: b.color, skin: b.skin || SK[1], hair: "#140f0c", long: true, skirt: !!b.skirt }));
add("child", "Child", "People", "actor", [0.36, 1.2, 0.24], "#efbf35", b => human({ h: 1.2, color: b.color, skin: b.skin || SK[2], hair: "#1b1410", headK: 1.25 }));
add("elder", "Elderly person", "People", "actor", [0.48, 1.65, 0.32], "#7a6a58", b => human({ h: 1.65, color: b.color, skin: b.skin || SK[0], hair: "#d8d4cc", hunch: 0.28 }));
add("soldier", "Soldier", "People", "actor", [0.52, 1.82, 0.34], "#556b3e", b => human({ h: 1.82, color: b.color, skin: b.skin || SK[1], pants: "#4a5a36", hat: "helmet", prop: "gun" }));
add("police", "Police officer", "People", "actor", [0.52, 1.82, 0.34], "#1d2a4a", b => human({ h: 1.82, color: b.color, skin: b.skin || SK[3], pants: "#1d2a4a", hat: "cap" }));
add("worker", "Worker", "People", "actor", [0.52, 1.8, 0.34], "#e5832a", b => human({ h: 1.8, color: b.color, skin: b.skin || SK[0], pants: "#3a4a66", hat: "hard" }));
add("dancer", "Dancer", "People", "actor", [0.44, 1.7, 0.28], "#e396a6", b => human({ h: 1.7, color: b.color, skin: b.skin || SK[2], hair: "#140f0c", long: true }));
add("singer", "Singer with mic", "People", "actor", [0.46, 1.72, 0.3], "#b58d3d", b => human({ h: 1.72, color: b.color, skin: b.skin || SK[1], hair: "#140f0c", prop: "mic" }));
add("traveller", "Person with bag", "People", "actor", [0.5, 1.76, 0.4], "#278a83", b => human({ h: 1.76, color: b.color, skin: b.skin || SK[4], hair: "#1b1410", prop: "bag" }));
add("crowd", "Crowd (spawns people)", "People", "actor", [6, 1.75, 6], "#9a8f80", b => { const g = new THREE.Group(); const cols = ["#7a6a58", "#5a6a7a", "#8a5a4a", "#6a7a5a", "#9a8f80"]; [[0, 0], [1.2, 0.6], [-1.1, 0.4], [0.5, -1.2], [-0.6, -1.0]].forEach(([x, z], i) => { const h = human({ h: 1.7, color: cols[i], skin: SK[i % 5], hair: "#1b1410" }); h.position.set(x, 0, z); h.rotation.y = i; g.add(h); }); return g; }, { crowd: true });

/* animals */
add("dog", "Dog", "Animals", "animal", [0.3, 0.6, 0.9], "#8a6a44", b => quad({ L: 0.9, H: 0.6, W: 0.3, color: b.color, ears: true }));
add("cat", "Cat", "Animals", "animal", [0.2, 0.3, 0.5], "#3a3833", b => quad({ L: 0.5, H: 0.3, W: 0.18, color: b.color, ears: true }));
add("horse", "Horse", "Animals", "animal", [0.6, 1.7, 2.3], "#6b4a2e", b => quad({ L: 2.2, H: 1.7, W: 0.6, color: b.color }));
add("cow", "Cow", "Animals", "animal", [0.8, 1.5, 2.3], "#e8e2d6", b => quad({ L: 2.2, H: 1.4, W: 0.8, color: b.color, ears: true, leg: "#3a3833" }));
add("deer", "Deer", "Animals", "animal", [0.4, 1.4, 1.6], "#9a6a3e", b => quad({ L: 1.5, H: 1.4, W: 0.4, color: b.color, ears: true }));
add("bird", "Bird", "Animals", "animal", [0.6, 0.2, 0.4], "#3a3833", b => bird(b.color));
add("flock", "Bird flock", "Animals", "animal", [6, 2, 6], "#3a3833", b => { const g = new THREE.Group(); const r = mulberry32(b.seed || 5); for (let i = 0; i < 9; i++) { const k = bird(b.color); k.position.set((r() - 0.5) * 6, r() * 2, (r() - 0.5) * 6); k.userData.anim.flapOff = r() * 6; g.add(k); } return anim(g, { flyer: "drift", flock: true }); });

/* vehicles */
add("car", "Car (sedan)", "Vehicles", "vehicle", [1.85, 1.45, 4.5], "#9aa3ab", b => car({ color: b.color }));
add("suv", "SUV", "Vehicles", "vehicle", [1.95, 1.8, 4.8], "#2b3a4a", b => car({ color: b.color, L: 4.8, W: 1.95, H: 1.8, r: 0.4, cabL: 0.62, cabZ: 0.08 }));
add("sports_car", "Sports car", "Vehicles", "vehicle", [1.9, 1.15, 4.4], "#d6553a", b => car({ color: b.color, H: 1.15, r: 0.32, cabL: 0.4, cabZ: 0.08 }));
add("taxi", "Taxi", "Vehicles", "vehicle", [1.85, 1.6, 4.6], "#efbf35", b => car({ color: b.color, taxi: true, L: 4.6 }));
add("police_car", "Police car", "Vehicles", "vehicle", [1.9, 1.6, 4.8], "#f2f2f0", b => car({ color: b.color, siren: true, L: 4.8, stripe: "#1d3a8a" }));
add("van", "Van", "Vehicles", "vehicle", [2.0, 2.4, 5.4], "#e8e6e0", b => boxTruck({ color: b.color, L: 5.4, W: 2.0, H: 2.4, r: 0.38, cabL: 1.6 }));
add("ambulance", "Ambulance", "Vehicles", "vehicle", [2.1, 2.7, 6], "#f2f2f0", b => boxTruck({ color: b.color, L: 6, W: 2.1, H: 2.7, r: 0.42, cabL: 1.8, stripe: "#d62828", siren: true }));
add("pickup", "Pickup truck", "Vehicles", "vehicle", [2.0, 1.9, 5.4], "#7a2a22", b => car({ color: b.color, L: 5.4, W: 2.0, H: 1.9, r: 0.42, cabL: 0.35, cabZ: -0.12 }));
add("truck", "Lorry / box truck", "Vehicles", "vehicle", [2.5, 3.8, 9], "#d8d4cc", b => boxTruck({ color: "#c23e29", box: b.color, L: 9, W: 2.5, H: 3.8, r: 0.52, cabL: 2.3, axles: [3.4, -2.2, -3.4] }));
add("fire_truck", "Fire engine", "Vehicles", "vehicle", [2.5, 3.3, 10], "#c22d22", b => boxTruck({ color: b.color, box: b.color, L: 10, W: 2.5, H: 3.3, r: 0.52, cabL: 2.8, ladder: true, siren: true }));
add("bus", "Bus", "Vehicles", "vehicle", [2.55, 3.1, 12], "#d6553a", b => bus({ color: b.color }));
add("double_decker", "Double-decker bus", "Vehicles", "vehicle", [2.55, 4.4, 11], "#c22d22", b => bus({ color: b.color, H: 4.4, L: 11, deck: true }));
add("tram", "Tram", "Vehicles", "vehicle", [2.6, 3.4, 16], "#e5c040", b => bus({ color: b.color, L: 16, H: 3.4, rails: true }));
add("train", "Train", "Vehicles", "vehicle", [3, 4.2, 50], "#2e5fa8", b => train({ color: b.color, color2: "#c9c4b8" }));
add("motorbike", "Motorbike", "Vehicles", "vehicle", [0.7, 1.2, 2.1], "#1b1b1b", b => bike({ color: b.color, motor: true, r: 0.32 }));
add("bicycle", "Bicycle", "Vehicles", "vehicle", [0.6, 1.0, 1.7], "#278a83", b => bike({ color: b.color, r: 0.34 }));
add("tank", "Tank", "Vehicles", "vehicle", [3.6, 2.4, 7.4], "#5c6a44", b => tank({ color: b.color }));
add("tractor", "Tractor", "Vehicles", "vehicle", [2.2, 2.7, 3.8], "#3d7a4c", b => tractor({ color: b.color }));
add("forklift", "Forklift", "Vehicles", "vehicle", [1.2, 2.8, 2.6], "#efbf35", b => forklift({ color: b.color }));
add("golf_cart", "Golf cart", "Vehicles", "vehicle", [1.3, 1.9, 2.5], "#f2f2f0", b => car({ color: b.color, L: 2.5, W: 1.3, H: 1.9, r: 0.25, cabL: 0.6 }));

/* aircraft */
add("airliner", "Airliner", "Aircraft", "aircraft", [36, 12, 40], "#f2f2f0", b => airliner({ color: b.color }));
add("small_plane", "Small prop plane", "Aircraft", "aircraft", [10, 2.6, 8], "#f2f2f0", b => smallPlane({ color: b.color }));
add("fighter_jet", "Fighter jet", "Aircraft", "aircraft", [12, 4.5, 16], "#7f8a94", b => jet({ color: b.color }));
add("helicopter", "Helicopter", "Aircraft", "aircraft", [11, 4.2, 13], "#2b3a4a", b => helicopter({ color: b.color }));
add("drone", "Drone", "Aircraft", "aircraft", [0.5, 0.2, 0.5], "#2b2b2b", b => drone({ color: b.color }));
add("hot_air_balloon", "Hot-air balloon", "Aircraft", "aircraft", [16, 25, 16], "#d6553a", b => balloon({ color: b.color }));
add("blimp", "Blimp", "Aircraft", "aircraft", [10, 13, 42], "#c9c4b8", b => blimp({ color: b.color }));

/* boats */
add("cargo_ship", "Cargo ship", "Boats", "boat", [12, 12, 70], "#2b3a4a", b => boat({ color: b.color, L: 70, W: 12, H: 6, type: "cargo" }));
add("ferry", "Ferry", "Boats", "boat", [10, 10, 40], "#f2f2f0", b => boat({ color: "#2e5fa8", L: 40, W: 10, H: 4, type: "ferry" }));
add("yacht", "Yacht", "Boats", "boat", [5, 5, 18], "#f2f2f0", b => boat({ color: b.color, L: 18, W: 5, H: 2, type: "cabin" }));
add("sailboat", "Sailboat", "Boats", "boat", [3, 12, 9], "#f2f2f0", b => boat({ color: b.color, L: 9, W: 3, H: 1.1, type: "sail" }));
add("speedboat", "Speedboat", "Boats", "boat", [2.4, 1.8, 7], "#c23e29", b => boat({ color: b.color, L: 7, W: 2.4, H: 0.9, type: "speed" }));
add("rowboat", "Rowboat", "Boats", "boat", [1.4, 0.7, 3.6], "#8a6a44", b => boat({ color: b.color, L: 3.6, W: 1.4, H: 0.55 }));
add("fishing_boat", "Fishing boat", "Boats", "boat", [4, 5, 12], "#2e5fa8", b => boat({ color: b.color, L: 12, W: 4, H: 1.6, type: "cabin" }));
add("submarine", "Submarine", "Boats", "boat", [6, 6, 40], "#2b2b2b", b => boat({ color: b.color, L: 40, W: 6, H: 3, type: "sub" }));
add("kayak", "Kayak", "Boats", "boat", [0.7, 0.4, 3.4], "#efbf35", b => boat({ color: b.color, L: 3.4, W: 0.7, H: 0.35 }));

/* nature */
add("tree", "Tree (leafy)", "Nature", "nature", [5, 8, 5], "#4f7a3a", b => tree({ H: 8, color: b.color }));
add("pine", "Pine tree", "Nature", "nature", [4, 11, 4], "#2f5a3a", b => tree({ H: 11, color: b.color, type: "pine" }));
add("snowy_pine", "Snowy pine", "Nature", "nature", [4, 10, 4], "#2f4a3a", b => tree({ H: 10, color: b.color, type: "pine", snow: true }));
add("palm", "Palm tree", "Nature", "nature", [5, 9, 5], "#5a8a3a", b => tree({ H: 9, color: b.color, type: "palm", trunk: "#9a7a52" }));
add("birch", "Birch tree", "Nature", "nature", [3, 9, 3], "#8cb050", b => tree({ H: 9, color: b.color, type: "birch" }));
add("willow", "Willow tree", "Nature", "nature", [7, 8, 7], "#6f9a48", b => tree({ H: 8, color: b.color, type: "willow" }));
add("dead_tree", "Dead tree", "Nature", "nature", [3, 6, 3], "#5a4430", b => tree({ H: 6, color: b.color, type: "dead", trunk: b.color }));
add("bush", "Bush", "Nature", "nature", [1.6, 1.1, 1.6], "#4f7a3a", b => { const g = new THREE.Group(), m = M(b.color, "leaf"); g.add(sp(m, 0.6, 0, 0.5, 0, 1.3, 0.9, 1.3, 8)); g.add(sp(m, 0.45, 0.35, 0.6, 0.2, 1, 1, 1, 7)); return g; });
add("hedge", "Hedge", "Nature", "nature", [4, 1.4, 1], "#3f6a34", b => grp(bx(M(b.color, "leaf"), 4, 1.4, 1, 0, 0.7, 0)));
add("flowers", "Flower bed", "Nature", "nature", [2, 0.4, 1], "#c43f86", b => { const g = new THREE.Group(); g.add(bx(M("#5a4430"), 2, 0.15, 1, 0, 0.075, 0)); const r = mulberry32(4); for (let i = 0; i < 18; i++) g.add(sp(M(["#c43f86", "#efbf35", "#f4f2ee", "#d6553a"][i % 4], "leaf"), 0.08, (r() - 0.5) * 1.8, 0.3, (r() - 0.5) * 0.8)); return g; });
add("grass_tuft", "Tall grass", "Nature", "nature", [1, 0.7, 1], "#7a9a48", b => { const g = new THREE.Group(), m = M(b.color, "leaf"); for (let i = 0; i < 7; i++) { const c2 = cn(m, 0.05, 0.7, (i % 3 - 1) * 0.2, 0.35, ((i * 7) % 5 - 2) * 0.15, 4); c2.rotation.z = (i - 3) * 0.08; g.add(c2); } return g; });
add("cactus", "Cactus", "Nature", "nature", [1.2, 3, 0.6], "#4f8a4a", b => { const g = new THREE.Group(), m = M(b.color, "leaf"); g.add(cap(m, 0.28, 2.4, 0, 1.5, 0)); g.add(cap(m, 0.16, 0.6, 0.45, 1.6, 0)); g.add(cap(m, 0.16, 0.8, -0.45, 1.9, 0)); g.add(rot(cap(m, 0.15, 0.3, 0.3, 1.25, 0), 0, 0, PI / 2)); g.add(rot(cap(m, 0.15, 0.3, -0.3, 1.5, 0), 0, 0, PI / 2)); return g; });
add("rock", "Rock", "Nature", "nature", [1, 0.7, 0.9], "#8a857c", b => rockG({ w: 1, h: 0.7, d: 0.9, color: b.color }));
add("boulder", "Boulder", "Nature", "nature", [3, 2.2, 2.6], "#8a857c", b => rockG({ w: 3, h: 2.2, d: 2.6, color: b.color, seed: 7 }));
add("log", "Fallen log", "Nature", "nature", [0.6, 0.6, 4], "#6b4a2e", b => grp(rot(cy(M(b.color), 0.3, 0.3, 4, 0, 0.3, 0, 10), PI / 2)));
add("mountain", "Mountain", "Nature", "nature", [120, 70, 120], "#7d7a72", b => mountain({ w: 120, h: 70, d: 120, color: b.color, snow: true }));
add("hill", "Hill", "Nature", "nature", [40, 8, 40], "#6a8a48", b => grp(sp(M(b.color, "leaf"), 0.5, 0, 0, 0, 40, 16, 40, 18)));
add("cliff", "Cliff", "Nature", "nature", [20, 15, 8], "#8a7f6c", b => rockG({ w: 20, h: 15, d: 8, color: b.color, seed: 11 }));
add("sand_dune", "Sand dune", "Nature", "nature", [20, 4, 12], "#d9bf8a", b => grp(sp(M(b.color, "flat"), 0.5, 0, 0, 0, 20, 8, 12, 16)));
add("campfire", "Campfire", "Nature", "nature", [1, 0.8, 1], "#ff8a30", b => { const g = new THREE.Group(); for (let i = 0; i < 5; i++) g.add(rot(cy(M("#4a3626"), 0.06, 0.06, 0.9, 0, 0.12, 0), PI / 2, i * 0.63, 0)); g.add(cn(M("#ff8a30", "emit"), 0.25, 0.6, 0, 0.4, 0, 7)); g.add(cn(M("#ffd060", "emit"), 0.14, 0.4, 0, 0.35, 0, 7)); const pool = mk(new THREE.CircleGeometry(4, 24).rotateX(-PI / 2), M("#ff9a40", "glow", { strength: 0.5 }), 0, 0.04, 0); pool.castShadow = false; g.add(pool); return anim(g, { flicker: true }); });

/* water + ground */
add("river", "River", "Water & ground", "water", [12, 0.1, 80], "#3d7a96", b => waterPiece("river", b), { param: true });
add("lake", "Lake / pond", "Water & ground", "water", [20, 0.1, 14], "#3d7a96", b => waterPiece("lake", b), { param: true });
add("ocean", "Sea / ocean", "Water & ground", "water", [300, 0.1, 150], "#2f6a8a", b => waterPiece("ocean", b), { param: true });
add("pool", "Swimming pool", "Water & ground", "water", [8, 0.3, 4], "#5fb6d6", b => waterPiece("pool", b), { param: true });
add("waterfall", "Waterfall", "Water & ground", "water", [6, 14, 6], "#d8eef6", b => waterPiece("waterfall", b), { param: true });
for (const [t, n, c] of [["ground_grass", "Grass ground", "#6f8f4a"], ["ground_sand", "Sand / beach", "#d9c49a"], ["ground_asphalt", "Asphalt ground", "#4a4a4c"], ["ground_concrete", "Concrete ground", "#a8a39a"], ["ground_dirt", "Dirt ground", "#8a6f50"], ["ground_snow", "Snow ground", "#eef1f4"], ["ground_clay", "Clay floor (studio)", "#bdb7ac"], ["ground_wood", "Wooden floor", "#a07a52"], ["ground_tiles", "Tiled floor", "#d8d2c6"]])
  add(t, n, "Water & ground", "ground", [200, 0.05, 200], c, b => ground(b), { param: true, ground: true });

/* street */
add("road", "Road (2 lanes + pavements)", "Streets", "street", [8, 0.05, 60], "#3d3d3f", b => road("road", b), { param: true });
add("highway", "Highway (4 lanes)", "Streets", "street", [16, 0.05, 120], "#3d3d3f", b => road("highway", b), { param: true });
add("crossroads", "Crossroads", "Streets", "street", [8, 0.05, 8], "#3d3d3f", b => road("crossroads", b), { param: true });
add("crosswalk", "Zebra crossing", "Streets", "street", [8, 0.05, 3], "#eeeeea", b => road("crosswalk", b), { param: true });
add("sidewalk", "Pavement", "Streets", "street", [3, 0.1, 20], "#bdb7ab", b => road("sidewalk", b), { param: true });
add("plaza", "Plaza / square", "Streets", "street", [30, 0.1, 30], "#c9c2b4", b => road("plaza", b), { param: true });
add("path", "Footpath", "Streets", "street", [2, 0.1, 20], "#b59c78", b => road("path", b), { param: true });
add("parking", "Car park", "Streets", "street", [12, 0.1, 26], "#4a4a4c", b => road("parking", b), { param: true });
add("runway", "Runway", "Streets", "street", [45, 0.05, 400], "#454547", b => road("runway", b), { param: true });
add("rails", "Railway track", "Streets", "street", [3.2, 0.3, 60], "#777777", b => road("rails", b), { param: true });
add("bridge", "Bridge", "Streets", "street", [10, 6, 40], "#a8a39a", b => road("bridge", b), { param: true });
add("pier", "Pier / dock", "Streets", "street", [5, 1.2, 30], "#7a5a3a", b => road("pier", b), { param: true });
add("streetlamp", "Street lamp", "Streets", "street", [0.4, 5.6, 1.2], "#2b2b2b", b => lamp(b.color));
add("traffic_light", "Traffic light", "Streets", "street", [0.4, 4.1, 0.4], "#2b2b2b", b => trafficLight());
add("bus_stop", "Bus shelter", "Streets", "street", [4, 2.5, 1.6], "#333333", b => building("bus_shelter", b), { param: true });
add("bench", "Bench", "Streets", "street", [1.8, 0.85, 0.6], "#6b4a2e", b => { const g = new THREE.Group(), m = M(b.color); g.add(bx(m, 1.8, 0.06, 0.45, 0, 0.45, 0)); g.add(bx(m, 1.8, 0.4, 0.05, 0, 0.7, -0.22)); for (const x of [-0.8, 0.8]) g.add(bx(M("#222", "metal"), 0.06, 0.45, 0.45, x, 0.22, 0)); return g; });
add("bin", "Bin", "Streets", "street", [0.5, 1, 0.5], "#2f5a3a", b => grp(cy(M(b.color), 0.25, 0.22, 0.95, 0, 0.475, 0)));
add("dumpster", "Dumpster", "Streets", "street", [2, 1.4, 1.2], "#2f5a3a", b => grp(bx(M(b.color, "metal"), 2, 1.2, 1.2, 0, 0.75, 0), bx(M("#222"), 2.05, 0.08, 1.25, 0, 1.38, 0)));
add("hydrant", "Fire hydrant", "Streets", "street", [0.4, 0.8, 0.4], "#c22d22", b => grp(cy(M(b.color, "paint"), 0.12, 0.15, 0.65, 0, 0.33, 0), sp(M(b.color, "paint"), 0.13, 0, 0.66, 0), rot(cy(M(b.color, "paint"), 0.06, 0.06, 0.4, 0, 0.45, 0), 0, 0, PI / 2)));
add("phone_box", "Phone box", "Streets", "street", [1, 2.5, 1], "#c22d22", b => grp(bx(M(b.color, "paint"), 1, 2.4, 1, 0, 1.2, 0), bx(M("#1d2833", "glass"), 0.8, 1.6, 1.02, 0, 1.2, 0), bx(M(b.color, "paint"), 1.05, 0.12, 1.05, 0, 2.45, 0)));
add("billboard", "Billboard", "Streets", "street", [8, 8, 0.6], "#e6dcc8", b => { const g = new THREE.Group(); for (const x of [-2.5, 2.5]) g.add(cy(M("#555", "metal"), 0.2, 0.2, 5, x, 2.5, 0)); g.add(mk(new THREE.BoxGeometry(8, 3, 0.3), [M("#444"), M("#444"), M("#444"), M("#444"), new THREE.MeshStandardMaterial({ map: signTex(b.sign || b.label || "AD", b.color, "#1c1a16"), roughness: .8 }), M("#444")], 0, 6.5, 0)); return g; });
add("street_sign", "Street sign", "Streets", "street", [0.6, 2.6, 0.1], "#2e5fa8", b => grp(cy(M("#888", "metal"), 0.04, 0.04, 2.6, 0, 1.3, 0), bx(M(b.color, "flat"), 0.6, 0.6, 0.04, 0, 2.3, 0.04)));
add("bollard", "Bollard", "Streets", "street", [0.25, 0.9, 0.25], "#2b2b2b", b => grp(cy(M(b.color, "metal"), 0.1, 0.12, 0.9, 0, 0.45, 0)));
add("traffic_cone", "Traffic cone", "Streets", "street", [0.4, 0.7, 0.4], "#e5832a", b => grp(cn(M(b.color), 0.18, 0.65, 0, 0.35, 0), bx(M("#222"), 0.4, 0.04, 0.4, 0, 0.02, 0)));
add("barrier", "Road barrier", "Streets", "street", [2, 1, 0.5], "#e8e6e0", b => grp(bx(M(b.color), 2, 0.8, 0.5, 0, 0.4, 0), bx(M("#c22d22", "flat"), 2.02, 0.15, 0.52, 0, 0.6, 0)));
add("fence", "Fence", "Streets", "street", [6, 1.2, 0.1], "#8a6a44", b => road("fence", b), { param: true });
add("guardrail", "Guardrail", "Streets", "street", [10, 0.8, 0.2], "#bbbbbb", b => road("guardrail", b), { param: true });
add("brick_wall", "Brick wall", "Streets", "street", [6, 2.2, 0.3], "#9b5b4a", b => road("wall_brick", b), { param: true });
add("mailbox", "Postbox", "Streets", "street", [0.5, 1.6, 0.5], "#c22d22", b => grp(cy(M(b.color, "paint"), 0.25, 0.25, 1.4, 0, 0.7, 0), sp(M(b.color, "paint"), 0.25, 0, 1.4, 0, 1, 0.5, 1)));
add("crops", "Crop field", "Streets", "street", [30, 0.4, 30], "#7f9a3a", b => road("crops", b), { param: true });
add("fountain", "Fountain", "Streets", "street", [5, 2.5, 5], "#bcb6aa", b => building("fountain", b), { param: true });
add("statue", "Statue", "Streets", "street", [1.6, 4, 1.6], "#9aa08a", b => building("statue", b), { param: true });
add("helipad", "Helipad", "Streets", "street", [16, 0.2, 16], "#4a4a4c", b => building("helipad", b), { param: true });
add("market_stall", "Market stall", "Streets", "street", [3, 2.6, 2], "#d6553a", b => building("market_stall", b), { param: true });

/* buildings */
add("house", "House", "Buildings", "building", [9, 7.5, 9], "#e6dcc8", b => building("house", b), { param: true });
add("townhouses", "Row of townhouses", "Buildings", "building", [20, 11, 10], "#b8735a", b => building("townhouses", b), { param: true });
add("apartment", "Apartment block", "Buildings", "building", [20, 24, 14], "#d4cdc0", b => building("apartment", b), { param: true });
add("office", "Office block", "Buildings", "building", [24, 40, 20], "#7f97aa", b => building("office", b), { param: true });
add("skyscraper", "Skyscraper", "Buildings", "building", [24, 140, 24], "#6f8aa0", b => building("skyscraper", b), { param: true });
add("shop", "Shop", "Buildings", "building", [8, 6, 9], "#e8e0cf", b => building("shop", b), { param: true, sign: "SHOP" });
add("cafe", "Café", "Buildings", "building", [8, 6, 9], "#d8c7a8", b => building("cafe", b), { param: true, sign: "CAFE" });
add("restaurant", "Restaurant", "Buildings", "building", [10, 6, 10], "#b8735a", b => building("restaurant", b), { param: true, sign: "RESTAURANT" });
add("bar", "Bar / pub", "Buildings", "building", [8, 6, 9], "#3a3833", b => building("bar", b), { param: true, sign: "BAR" });
add("pharmacy", "Pharmacy", "Buildings", "building", [8, 6, 9], "#f4f2ee", b => building("pharmacy", b), { param: true, sign: "PHARMACY" });
add("bank", "Bank", "Buildings", "building", [12, 9, 12], "#d4cdc0", b => building("bank", b), { param: true, sign: "BANK" });
add("hotel", "Hotel", "Buildings", "building", [16, 20, 14], "#c9b79c", b => building("hotel", b), { param: true, sign: "HOTEL" });
add("hospital", "Hospital", "Buildings", "building", [30, 18, 20], "#eeeeea", b => building("hospital", b), { param: true });
add("school", "School", "Buildings", "building", [30, 10, 16], "#c9a27c", b => building("school", b), { param: true });
add("warehouse", "Warehouse", "Buildings", "building", [30, 10, 20], "#9aa3ab", b => building("warehouse", b), { param: true });
add("factory", "Factory", "Buildings", "building", [30, 12, 22], "#a8735a", b => building("factory", b), { param: true });
add("hangar", "Hangar", "Buildings", "building", [30, 15, 34], "#9aa3ab", b => building("hangar", b), { param: true });
add("barn", "Barn", "Buildings", "building", [12, 9, 16], "#9b3b2e", b => building("barn", b), { param: true });
add("church", "Church", "Buildings", "building", [12, 24, 22], "#d4cdc0", b => building("church", b), { param: true });
add("gas_station", "Petrol station", "Buildings", "building", [16, 6, 14], "#c23e29", b => building("gas_station", b), { param: true });
add("garage", "Garage", "Buildings", "building", [6, 3.2, 7], "#d4cdc0", b => building("garage", b), { param: true });
add("hut", "Hut / cabin", "Buildings", "building", [5, 4.5, 5], "#8a6a44", b => building("hut", b), { param: true });
add("lighthouse", "Lighthouse", "Buildings", "building", [5, 22, 5], "#f2f2f0", b => building("lighthouse", b), { param: true });
add("castle_tower", "Castle tower", "Buildings", "building", [8, 18, 8], "#9a958a", b => building("castle_tower", b), { param: true });
add("control_tower", "Control tower", "Buildings", "building", [8, 30, 8], "#d4cdc0", b => building("control_tower", b), { param: true });
add("stadium", "Stadium", "Buildings", "building", [120, 25, 120], "#b8b2a6", b => building("stadium", b), { param: true });
add("pyramid", "Pyramid", "Buildings", "building", [60, 40, 60], "#d9bf8a", b => building("pyramid", b), { param: true });
add("temple", "Classical temple", "Buildings", "building", [20, 12, 14], "#e6dcc8", b => building("temple", b), { param: true });
add("shipping_container", "Shipping container", "Buildings", "building", [2.5, 2.6, 12], "#b23b2e", b => building("container", b), { param: true });
add("silo", "Silo", "Buildings", "building", [5, 16, 5], "#b8b2a6", b => building("silo", b), { param: true });
add("water_tower", "Water tower", "Buildings", "building", [4, 10, 4], "#8a6a44", b => building("water_tower", b), { param: true });
add("tent", "Tent", "Buildings", "building", [3, 2, 3], "#e5832a", b => building("tent", b), { param: true });

/* interiors */
add("room", "Room (walls + floor)", "Interiors", "building", [8, 3, 6], "#e6dcc8", b => { const [w, h, d] = b.size, g = new THREE.Group(), m = M(b.color); g.add(bx(M("#a07a52"), w, 0.05, d, 0, 0.025, 0)); g.add(bx(m, w, h, 0.15, 0, h / 2, -d / 2)); g.add(bx(m, 0.15, h, d, -w / 2, h / 2, 0)); g.add(bx(m, 0.15, h, d, w / 2, h / 2, 0)); g.add(bx(M("#cfe0ea", "glass", { opacity: 0.5 }), w * 0.3, h * 0.45, 0.17, w * 0.2, h * 0.55, -d / 2)); return g; }, { param: true });
add("table", "Table", "Interiors", "furniture", [1.4, 0.75, 0.9], "#8a6a44", b => table(b.color, 1.4, 0.9));
add("round_table", "Round café table", "Interiors", "furniture", [0.8, 0.75, 0.8], "#3a3833", b => table(b.color, 0.8, 0.8, 0.75, true));
add("chair", "Chair", "Interiors", "furniture", [0.45, 0.95, 0.45], "#6b4a2e", b => seat(b.color));
add("sofa", "Sofa", "Interiors", "furniture", [2, 0.9, 0.9], "#5a6a7a", b => seat(b.color, true));
add("bed", "Bed", "Interiors", "furniture", [1.6, 0.9, 2.1], "#e6dcc8", b => grp(bx(M("#6b4a2e"), 1.6, 0.4, 2.1, 0, 0.2, 0), bx(M(b.color), 1.55, 0.2, 2.0, 0, 0.5, 0), bx(M("#f4f2ee"), 1.2, 0.15, 0.4, 0, 0.65, -0.75), bx(M("#6b4a2e"), 1.6, 1.0, 0.08, 0, 0.5, -1.05)));
add("desk", "Desk", "Interiors", "furniture", [1.6, 0.75, 0.75], "#d4cdc0", b => { const g = table(b.color, 1.6, 0.75); g.add(bx(M("#1b1b1b"), 0.6, 0.38, 0.04, 0, 1.0, -0.2)); return g; });
add("counter", "Counter / bar top", "Interiors", "furniture", [4, 1.1, 0.7], "#3a2e25", b => grp(bx(M(b.color), 4, 1.05, 0.7, 0, 0.525, 0), bx(M("#d8d2c6"), 4.1, 0.05, 0.8, 0, 1.08, 0)));
add("shelf", "Shelves", "Interiors", "furniture", [1.8, 2, 0.4], "#8a6a44", b => { const g = new THREE.Group(), m = M(b.color); for (let i = 0; i < 5; i++) g.add(bx(m, 1.8, 0.04, 0.4, 0, 0.02 + i * 0.49, 0)); for (const x of [-0.88, 0.88]) g.add(bx(m, 0.04, 2, 0.4, x, 1, 0)); for (let i = 0; i < 4; i++) g.add(bx(M(pick(["#c23e29", "#2e5fa8", "#efbf35", "#3d7a4c"])), 1.4, 0.3, 0.25, 0, 0.2 + i * 0.49, 0)); return g; });
add("tv", "TV / screen", "Interiors", "furniture", [1.4, 0.85, 0.1], "#1b1b1b", b => grp(bx(M(b.color), 1.4, 0.82, 0.06, 0, 0.9, 0), bx(M("#4d6a80", "emit"), 1.32, 0.74, 0.01, 0, 0.9, 0.035), bx(M(b.color), 0.4, 0.05, 0.2, 0, 0.45, 0), cy(M(b.color), 0.03, 0.03, 0.45, 0, 0.7, 0)));
add("floor_lamp", "Floor lamp", "Interiors", "furniture", [0.4, 1.7, 0.4], "#e6dcc8", b => grp(cy(M("#333", "metal"), 0.02, 0.02, 1.5, 0, 0.75, 0), cy(M(b.color), 0.15, 0.22, 0.3, 0, 1.55, 0), cy(M("#333"), 0.15, 0.15, 0.03, 0, 0.02, 0)));
add("rug", "Rug", "Interiors", "furniture", [3, 0.02, 2], "#a8452f", b => grp(bx(M(b.color, "flat"), 3, 0.02, 2, 0, 0.01, 0)));
add("plant", "Pot plant", "Interiors", "furniture", [0.6, 1.3, 0.6], "#4f7a3a", b => grp(cy(M("#c9a27c"), 0.2, 0.15, 0.4, 0, 0.2, 0), sp(M(b.color, "leaf"), 0.35, 0, 0.85, 0, 1, 1.3, 1, 8)));
add("door_frame", "Doorway (single)", "Interiors", "furniture", [1.2, 2.3, 0.15], "#d4cdc0", b => grp(bx(M(b.color), 0.12, 2.3, 0.15, -0.54, 1.15, 0), bx(M(b.color), 0.12, 2.3, 0.15, 0.54, 1.15, 0), bx(M(b.color), 1.2, 0.12, 0.15, 0, 2.24, 0), rot(bx(M("#6b4a2e"), 0.9, 2.1, 0.05, 0.42, 1.05, 0.4), 0, -1.1, 0)));
add("kitchen", "Kitchen units", "Interiors", "furniture", [3, 2.2, 0.65], "#e8e6e0", b => grp(bx(M(b.color), 3, 0.9, 0.6, 0, 0.45, 0), bx(M("#3a3833"), 3.05, 0.04, 0.65, 0, 0.92, 0), bx(M(b.color), 3, 0.7, 0.35, 0, 1.85, -0.15), bx(M("#888", "metal"), 0.5, 0.02, 0.4, 0.6, 0.95, 0)));
add("fridge", "Fridge", "Interiors", "furniture", [0.7, 1.8, 0.7], "#e8e6e0", b => grp(bx(M(b.color, "paint"), 0.7, 1.8, 0.7, 0, 0.9, 0), bx(M("#888", "metal"), 0.03, 0.5, 0.03, 0.3, 1.2, 0.36)));
add("bathtub", "Bathtub", "Interiors", "furniture", [0.8, 0.6, 1.7], "#f4f2ee", b => grp(bx(M(b.color, "paint"), 0.8, 0.6, 1.7, 0, 0.3, 0), bx(M("#5fb6d6", "water"), 0.65, 0.02, 1.5, 0, 0.5, 0)));
add("arcade", "Arcade machine", "Interiors", "furniture", [0.8, 1.9, 0.8], "#3a5ec4", b => grp(bx(M(b.color), 0.8, 1.9, 0.8, 0, 0.95, 0), bx(M("#6db0de", "emit"), 0.6, 0.45, 0.02, 0, 1.4, 0.41)));
add("hospital_bed", "Hospital bed", "Interiors", "furniture", [1, 1.0, 2.1], "#e8e6e0", b => grp(bx(M("#bbb", "metal"), 1, 0.08, 2.1, 0, 0.6, 0), bx(M(b.color), 0.95, 0.15, 2.0, 0, 0.72, 0), bx(M("#bbb", "metal"), 1, 0.6, 0.05, 0, 0.9, -1.05)));

/* stage & music video */
add("stage", "Stage platform", "Stage & studio", "building", [12, 1.2, 8], "#2b2b2b", b => { const [w, h, d] = b.size; return grp(bx(M(b.color), w, h, d, 0, h / 2, 0), bx(M("#d1aa5e", "emit"), w, 0.05, 0.05, 0, h, d / 2)); }, { param: true });
add("mic_stand", "Mic stand", "Stage & studio", "stage", [0.5, 1.6, 0.5], "#222222", b => stageKit("mic_stand", b.color));
add("speaker", "Speaker stack", "Stage & studio", "stage", [0.8, 1.4, 0.6], "#1c1c1c", b => stageKit("speaker", b.color));
add("drum_kit", "Drum kit", "Stage & studio", "stage", [2, 1.2, 1.4], "#c23e29", b => stageKit("drum_kit", b.color));
add("dj_booth", "DJ booth", "Stage & studio", "stage", [2, 1.1, 0.8], "#2b2b2b", b => stageKit("dj_booth", b.color));
add("light_truss", "Lighting truss", "Stage & studio", "stage", [10.5, 5.2, 0.4], "#bbbbbb", b => stageKit("truss", b.color));
add("spotlight", "Spotlight", "Stage & studio", "stage", [0.5, 2.1, 0.6], "#222222", b => stageKit("spotlight", b.color));
add("piano", "Piano", "Stage & studio", "stage", [1.5, 1.3, 0.7], "#111111", b => stageKit("piano", b.color));
add("film_light", "Film light", "Stage & studio", "stage", [0.6, 2.3, 0.4], "#222222", b => stageKit("film_light", b.color));
add("cyclorama", "Studio cyclorama", "Stage & studio", "building", [10, 5, 8], "#f2f0ea", b => { const [w, h, d] = b.size, g = new THREE.Group(), m = M(b.color, "flat"); g.add(bx(m, w, 0.05, d, 0, 0.025, 0)); g.add(bx(m, w, h, 0.1, 0, h / 2, -d / 2)); const cv = new THREE.CylinderGeometry(1.5, 1.5, w, 16, 1, true, PI, PI / 2); cv.rotateZ(PI / 2); g.add(mk(cv, M(b.color, "flat", { side: 1 }), 0, 1.5, -d / 2 + 1.5)); return g; }, { param: true });

/* props */
add("crate", "Crate", "Props", "prop", [0.8, 0.8, 0.8], "#b58d3d", b => grp(bx(M(b.color), 0.8, 0.8, 0.8, 0, 0.4, 0), bx(M("#7a5a2a"), 0.82, 0.08, 0.82, 0, 0.4, 0)));
add("barrel", "Barrel", "Props", "prop", [0.6, 0.9, 0.6], "#2e5fa8", b => grp(cy(M(b.color, "metal"), 0.3, 0.3, 0.9, 0, 0.45, 0), tor(M("#333", "metal"), 0.3, 0.02, 0, 0.25, 0).rotateX(PI / 2), tor(M("#333", "metal"), 0.3, 0.02, 0, 0.65, 0).rotateX(PI / 2)));
add("suitcase", "Suitcase", "Props", "prop", [0.45, 0.65, 0.25], "#3a3833", b => grp(bx(M(b.color), 0.45, 0.6, 0.25, 0, 0.35, 0), bx(M("#222"), 0.2, 0.15, 0.03, 0, 0.72, 0)));
add("beach_umbrella", "Beach umbrella", "Props", "prop", [2.4, 2.4, 2.4], "#d6553a", b => grp(cy(M("#e8e6e0"), 0.03, 0.03, 2.4, 0, 1.2, 0), cn(M(b.color, "flat"), 1.2, 0.5, 0, 2.3, 0, 12)));
add("sun_lounger", "Sun lounger", "Props", "prop", [0.7, 0.8, 1.9], "#f2f2f0", b => grp(bx(M(b.color), 0.7, 0.08, 1.3, 0, 0.35, 0.3), rot(bx(M(b.color), 0.7, 0.08, 0.7, 0, 0.55, -0.55), -0.6, 0, 0)));
add("beach_towel", "Beach towel", "Props", "prop", [0.9, 0.02, 1.8], "#3a5ec4", b => grp(bx(M(b.color, "flat"), 0.9, 0.02, 1.8, 0, 0.01, 0)));
add("lifeguard_tower", "Lifeguard tower", "Props", "prop", [2.5, 4.5, 2.5], "#d6553a", b => { const g = new THREE.Group(); for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) g.add(cy(M("#e8e6e0"), 0.08, 0.08, 2.5, x * 1, 1.25, z * 1)); g.add(bx(M(b.color), 2.4, 1.5, 2.4, 0, 3.2, 0)); g.add(cn(M("#e8e6e0"), 1.9, 0.6, 0, 4.25, 0, 4).rotateY(PI / 4)); return g; });
add("ladder", "Ladder", "Props", "prop", [0.5, 3, 0.1], "#9a9a9a", b => { const g = new THREE.Group(), m = M(b.color, "metal"); for (const x of [-0.22, 0.22]) g.add(bx(m, 0.05, 3, 0.05, x, 1.5, 0)); for (let i = 0; i < 9; i++) g.add(bx(m, 0.44, 0.03, 0.04, 0, 0.3 + i * 0.32, 0)); return g; });
add("tyres", "Tyre stack", "Props", "prop", [0.8, 0.8, 0.8], "#1b1b1b", b => { const g = new THREE.Group(); for (let i = 0; i < 3; i++) g.add(tor(M(b.color), 0.3, 0.1, 0, 0.1 + i * 0.22, 0).rotateX(PI / 2)); return g; });
add("flagpole", "Flagpole", "Props", "prop", [1.5, 8, 0.2], "#c23e29", b => grp(cy(M("#ccc", "metal"), 0.05, 0.06, 8, 0, 4, 0), bx(M(b.color, "flat", { side: 1 }), 1.5, 0.9, 0.02, 0.75, 7.4, 0)));
add("ac_unit", "Rooftop AC unit", "Props", "prop", [2, 1.4, 1.6], "#b8b2a6", b => grp(bx(M(b.color, "metal"), 2, 1.4, 1.6, 0, 0.7, 0), cy(M("#444"), 0.5, 0.5, 0.05, 0, 1.42, 0)));
add("sandbags", "Sandbags", "Props", "prop", [3, 1, 0.8], "#a8946a", b => { const g = new THREE.Group(); for (let r = 0; r < 3; r++) for (let i = 0; i < 5 - r; i++) g.add(sp(M(b.color), 0.32, -1.2 + i * 0.6 + r * 0.3, 0.17 + r * 0.3, 0, 1, 0.5, 0.7)); return g; });
add("picnic_table", "Picnic table", "Props", "prop", [1.8, 0.8, 1.6], "#8a6a44", b => grp(bx(M(b.color), 1.8, 0.06, 0.8, 0, 0.75, 0), bx(M(b.color), 1.8, 0.05, 0.3, 0, 0.45, 0.65), bx(M(b.color), 1.8, 0.05, 0.3, 0, 0.45, -0.65), bx(M(b.color), 0.08, 0.75, 1.5, 0.7, 0.37, 0), bx(M(b.color), 0.08, 0.75, 1.5, -0.7, 0.37, 0)));
add("vending_machine", "Vending machine", "Props", "prop", [1, 1.9, 0.8], "#c22d22", b => grp(bx(M(b.color, "paint"), 1, 1.9, 0.8, 0, 0.95, 0), bx(M("#cfe0ea", "emit"), 0.6, 1.2, 0.02, -0.1, 1.15, 0.41)));
add("atm", "Cash machine", "Props", "prop", [0.8, 1.6, 0.6], "#3a3833", b => grp(bx(M(b.color), 0.8, 1.6, 0.6, 0, 0.8, 0), bx(M("#6db0de", "emit"), 0.4, 0.3, 0.02, 0, 1.25, 0.31)));
add("sign_board", "Sandwich board sign", "Props", "prop", [0.6, 1, 0.5], "#1c1a16", b => grp(rot(bx(M(b.color), 0.6, 1, 0.03, 0, 0.5, 0.12), -0.25, 0, 0), rot(bx(M(b.color), 0.6, 1, 0.03, 0, 0.5, -0.12), 0.25, 0, 0)));
add("treasure_chest", "Chest", "Props", "prop", [0.9, 0.6, 0.6], "#7a5a2a", b => grp(bx(M(b.color), 0.9, 0.45, 0.6, 0, 0.225, 0), rot(cy(M(b.color), 0.3, 0.3, 0.9, 0, 0.45, 0, 12), 0, 0, PI / 2), bx(M("#d4b040", "metal"), 0.1, 0.15, 0.02, 0, 0.4, 0.31)));

/* blocking shapes (kept from v1) */
add("box", "Box block", "Blocking shapes", "shape", [1, 1, 1], "#b8b2a6", b => grp(bx(M(b.color), 1, 1, 1, 0, 0.5, 0)));
add("card", "Standee card", "Blocking shapes", "shape", [0.75, 1.75, 0.03], "#e6dcc8", null, { card: true });
add("resin_pill", "Resin pill", "Blocking shapes", "shape", [0.55, 1.5, 0.55], "#c43f86", b => grp(cap(M(b.color, "resin"), 0.275, 0.95, 0, 0.75, 0, 24)));
add("resin_pebble", "Resin pebble", "Blocking shapes", "shape", [1, 0.55, 0.75], "#278a83", b => grp(mk(new THREE.RoundedBoxGeometry(1, 0.55, 0.75, 5, 0.2), M(b.color, "resin"), 0, 0.275, 0)));
add("resin_blob", "Resin blob", "Blocking shapes", "shape", [0.9, 0.7, 0.9], "#7550c0", b => grp(sp(M(b.color, "resin"), 0.5, 0, 0.35, 0, 0.9, 0.7, 0.9, 28)));
add("resin_dome", "Resin dome", "Blocking shapes", "shape", [1, 0.5, 1], "#e5832a", b => { const gg = new THREE.SphereGeometry(0.5, 28, 12, 0, PI * 2, 0, PI / 2); gg.scale(1, 1, 1); return grp(mk(gg, M(b.color, "resin"))); });
add("pillar", "Pillar", "Blocking shapes", "shape", [0.5, 3, 0.5], "#b8b2a6", b => grp(cy(M(b.color), 0.25, 0.25, 3, 0, 1.5, 0, 24)));
add("wall_block", "Wall block", "Blocking shapes", "shape", [4, 3, 0.2], "#d4cdc0", b => road("wall", b), { param: true });
add("ramp", "Ramp", "Blocking shapes", "shape", [1.5, 0.8, 3], "#b8b2a6", b => { const [w, h, d] = b.size; const s = new THREE.Shape(); s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(d / 2, h); s.closePath(); const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false }); g.translate(0, 0, -w / 2); g.rotateY(PI / 2); return grp(mk(g, M(b.color))); }, { param: true });
add("stairs", "Stairs", "Blocking shapes", "shape", [1.5, 1.2, 2.4], "#b8b2a6", b => { const [w, h, d] = b.size, g = new THREE.Group(), n = Math.max(2, Math.round(h / 0.18)), sd = d / n; for (let i = 0; i < n; i++) { const sh = (i + 1) * h / n; g.add(bx(M(b.color), w, sh, sd, 0, sh / 2, d / 2 - (i + 0.5) * sd)); } return g; }, { param: true });
add("platform", "Platform", "Blocking shapes", "shape", [3, 0.4, 3], "#d4cdc0", b => { const [w, h, d] = b.size; return grp(bx(M(b.color), w, h, d, 0, h / 2, 0)); }, { param: true });

/* camera */
add("camera", "Camera", "Camera", "camera", [0.2, 0.15, 0.3], "#3a3833", null, { camera: true });

BR.CATALOG = C;
BR.CAT = Object.fromEntries(C.map(c => [c.type, c]));
BR.CATEGORIES = [...new Set(C.map(c => c.cat))];

/* ======================================================================
   SET KITS: deterministic environment generators. Each returns block specs.
   spec = {type, label?, x, z, y?, rot (deg), size?, color?, notes?, sign?, showLabel?}
   Kits are built around (0,0) running along Z unless noted; the app offsets/rotates them.
   ====================================================================== */
const SHOPS = ["BAKERY", "BOOKS", "FLOWERS", "BARBER", "DELI", "RECORDS", "TAILOR", "MARKET", "JEWELLER", "NOODLES", "LAUNDRY", "CORNER SHOP"];
function rowOfBuildings(out, side, L, setback, types, opts = {}) {
  let z = -L / 2;
  while (z < L / 2 - 4) {
    const t = pick(types), cat = BR.CAT[t];
    let w = cat.size[0] * rnd(0.8, 1.1), h = cat.size[1] * rnd(0.75, 1.3), d = cat.size[2];
    if (opts.hMul) h *= opts.hMul;
    w = Math.min(w, L / 2 - z);
    if (w < 4) break;
    const cols = ["#d4cdc0", "#c9b79c", "#b8735a", "#e6dcc8", "#9aa3ab", "#d8c7a8", "#8a6c5a", "#a8a39a"];
    out.push({ type: t, x: side * (setback + d / 2), z: z + w / 2, rot: side > 0 ? -90 : 90, size: [r1(w), r1(h), r1(d)], color: t === "skyscraper" || t === "office" ? pick(["#6f8aa0", "#7f97aa", "#5f7a8f", "#8a9aa8"]) : pick(cols), sign: ["shop", "cafe", "restaurant", "bar"].includes(t) ? pick(SHOPS) : undefined, showLabel: false });
    z += w + rnd(0, opts.gap || 0.4);
  }
}
const r1 = v => Math.round(v * 10) / 10;
function streetFurniture(out, L, half, opts = {}) {
  for (let z = -L / 2 + 6; z < L / 2 - 4; z += opts.lampEvery || 14) for (const s of [1, -1]) out.push({ type: "streetlamp", x: s * (half + 0.6), z: z + (s > 0 ? 0 : 7), rot: s > 0 ? -90 : 90, showLabel: false });
  if (opts.trees) for (let z = -L / 2 + 10; z < L / 2 - 6; z += 16) for (const s of [1, -1]) if (RNG() < 0.7) out.push({ type: "tree", x: s * (half + 1.8), z: z + rnd(-2, 2), rot: rnd(0, 360), size: [3.5, 7, 3.5], showLabel: false });
  for (let i = 0; i < (opts.props || 6); i++) { const s = RNG() < 0.5 ? 1 : -1; out.push({ type: pick(["bin", "bench", "hydrant", "bollard", "mailbox", "phone_box", "sign_board"]), x: s * (half + rnd(0.6, 2.4)), z: rnd(-L / 2 + 3, L / 2 - 3), rot: s > 0 ? -90 : 90, showLabel: false }); }
}
function parkedCars(out, L, x, n) { for (let i = 0; i < n; i++) out.push({ type: pick(["car", "car", "suv", "taxi", "van", "pickup"]), x, z: -L / 2 + 6 + i * (L - 12) / Math.max(1, n - 1) + rnd(-1.5, 1.5), rot: x > 0 ? 180 : 0, color: pick(["#9aa3ab", "#2b3a4a", "#7a2a22", "#e8e6e0", "#1b1b1b", "#3a5ec4", "#efbf35"]), showLabel: false }); }

const KITS = {
  city_street: { name: "City street", desc: "Two-lane street, pavements, shops and apartments both sides, lamps, parked cars, trees", build(o) { const L = o.length || 70, out = []; out.push({ type: "ground_concrete", x: 0, z: 0 }); out.push({ type: "road", x: 0, z: 0, size: [8, 0.05, L] }); out.push({ type: "crosswalk", x: 0, z: rnd(-8, 8), size: [8, 0.05, 3] }); rowOfBuildings(out, 1, L, 7.2, ["shop", "cafe", "apartment", "townhouses", "shop", "restaurant", "bar", "pharmacy"]); rowOfBuildings(out, -1, L, 7.2, ["shop", "apartment", "cafe", "townhouses", "bank", "hotel", "shop"]); streetFurniture(out, L, 4.6, { trees: true }); parkedCars(out, L, 3.0, 3); parkedCars(out, L, -3.0, 2); return out; } },
  downtown: { name: "Downtown", desc: "Wide avenue with skyscrapers and office towers, traffic lights", build(o) { const L = o.length || 90, out = []; out.push({ type: "ground_concrete", x: 0, z: 0 }); out.push({ type: "highway", x: 0, z: 0, size: [14, 0.05, L] }); for (const s of [1, -1]) out.push({ type: "sidewalk", x: s * 9, z: 0, size: [4, 0.1, L] }); rowOfBuildings(out, 1, L, 11.5, ["skyscraper", "office", "office", "hotel"], { gap: 3 }); rowOfBuildings(out, -1, L, 11.5, ["office", "skyscraper", "office", "bank"], { gap: 3 }); streetFurniture(out, L, 7.4, { trees: true, lampEvery: 18 }); out.push({ type: "traffic_light", x: 7.6, z: -6, rot: -90, showLabel: false }, { type: "traffic_light", x: -7.6, z: 6, rot: 90, showLabel: false }); out.push({ type: "crosswalk", x: 0, z: 0, size: [14, 0.05, 4] }); parkedCars(out, L, 5.2, 3); return out; } },
  suburb: { name: "Suburban street", desc: "Quiet road, detached houses with lawns, fences, trees", build(o) { const L = o.length || 70, out = [{ type: "ground_grass", x: 0, z: 0 }, { type: "road", x: 0, z: 0, size: [7, 0.05, L] }]; for (const s of [1, -1]) for (let z = -L / 2 + 8; z < L / 2 - 6; z += 15) { out.push({ type: "house", x: s * 17, z, rot: s > 0 ? -90 : 90, color: pick(["#e6dcc8", "#d8c7a8", "#c9d4dc", "#e8e0cf", "#d4b8a0"]), color2: pick(["#7b3f32", "#4a4a52", "#5a4436"]), showLabel: false }); out.push({ type: "fence", x: s * 11.5, z, rot: 90, size: [12, 1.0, 0.1], color: "#f2f2f0", showLabel: false }); if (RNG() < 0.7) out.push({ type: "tree", x: s * 9.5, z: z + 5, showLabel: false, size: [4, 7, 4] }); if (RNG() < 0.4) out.push({ type: pick(["car", "suv", "pickup"]), x: s * 12.5, z: z - 5, rot: s > 0 ? -90 : 90, showLabel: false }); out.push({ type: "mailbox", x: s * 6.4, z: z - 2, showLabel: false }); } return out; } },
  village_square: { name: "Village square", desc: "Cobbled plaza, fountain, market stalls, church, small shops", build() { const out = [{ type: "ground_concrete", x: 0, z: 0 }, { type: "plaza", x: 0, z: 0, size: [34, 0.1, 34] }, { type: "fountain", x: 0, z: 0, showLabel: false }, { type: "church", x: 0, z: -26, showLabel: false }]; for (let i = 0; i < 4; i++) out.push({ type: "market_stall", x: -9 + i * 6, z: 9, rot: 180, color: pick(["#d6553a", "#3a5ec4", "#efbf35", "#278a83"]), showLabel: false }); rowOfBuildings(out, 1, 34, 18, ["shop", "cafe", "townhouses", "restaurant"]); rowOfBuildings(out, -1, 34, 18, ["shop", "townhouses", "bar"]); for (let i = 0; i < 6; i++) out.push({ type: pick(["bench", "streetlamp", "tree", "bin"]), x: rnd(-14, 14), z: rnd(-14, 14), showLabel: false }); return out; } },
  alley: { name: "Back alley", desc: "Narrow alley between tall brick buildings, bins, dumpsters, crates", build(o) { const L = o.length || 40, out = [{ type: "ground_asphalt", x: 0, z: 0 }]; rowOfBuildings(out, 1, L, 2.5, ["townhouses", "apartment", "warehouse"], { gap: 0 }); rowOfBuildings(out, -1, L, 2.5, ["apartment", "townhouses", "warehouse"], { gap: 0 }); for (let i = 0; i < 8; i++) out.push({ type: pick(["dumpster", "bin", "crate", "barrel", "tyres"]), x: (RNG() < 0.5 ? -1 : 1) * rnd(1.4, 2), z: rnd(-L / 2 + 2, L / 2 - 2), rot: rnd(-20, 20), showLabel: false }); out.push({ type: "streetlamp", x: 2.2, z: 0, rot: -90, size: [0.4, 4.5, 1.2], showLabel: false }); return out; } },
  beach: { name: "Beach", desc: "Sand beach, sea, palms, umbrellas, loungers, lifeguard tower, boats offshore", build() { const out = [{ type: "ground_sand", x: 0, z: 40, size: [300, 0.05, 80] }, { type: "ocean", x: 0, z: -75, size: [400, 0.1, 150] }]; for (let i = 0; i < 9; i++) out.push({ type: "palm", x: rnd(-40, 40), z: rnd(14, 34), rot: rnd(0, 360), showLabel: false }); for (let i = 0; i < 8; i++) { const x = -28 + i * 7 + rnd(-1, 1), z = rnd(2, 9); out.push({ type: "beach_umbrella", x, z, color: pick(["#d6553a", "#3a5ec4", "#efbf35", "#278a83", "#f4f2ee"]), showLabel: false }); out.push({ type: pick(["sun_lounger", "beach_towel"]), x: x + 1.2, z: z + 0.5, rot: 180, color: pick(["#f2f2f0", "#3a5ec4", "#d6553a"]), showLabel: false }); } out.push({ type: "lifeguard_tower", x: 14, z: 4, rot: 180, showLabel: false }); out.push({ type: "sailboat", x: -30, z: -40, rot: 70, showLabel: false }, { type: "yacht", x: 40, z: -60, rot: -40, showLabel: false }); return out; } },
  riverside: { name: "Riverside", desc: "Grass banks either side of a river, footbridge, path, trees, benches", build(o) { const L = o.length || 120, out = [{ type: "ground_grass", x: 0, z: 0 }, { type: "river", x: 0, z: 0, size: [14, 0.1, L], rot: 90 }, { type: "bridge", x: 0, z: 0, size: [5, 2.5, 22], showLabel: false }]; for (const s of [1, -1]) { out.push({ type: "path", x: 0, z: s * 12, rot: 90, size: [2.5, 0.1, L] }); for (let i = 0; i < 8; i++) out.push({ type: pick(["tree", "willow", "tree", "bench", "streetlamp"]), x: rnd(-L / 2 + 5, L / 2 - 5), z: s * rnd(14, 26), rot: s > 0 ? 180 : 0, showLabel: false }); } out.push({ type: "rowboat", x: 14, z: 2, rot: 80, showLabel: false }); return out; } },
  forest: { name: "Forest", desc: "Dense woodland of pines and leafy trees with a clearing at the centre, rocks, logs", build(o) { const out = [{ type: "ground_dirt", x: 0, z: 0, color: "#5f6a3e" }]; const R = o.radius || 45; for (let i = 0; i < 70; i++) { const a = RNG() * PI * 2, r = rnd(9, R); out.push({ type: pick(["pine", "pine", "tree", "birch"]), x: Math.cos(a) * r, z: Math.sin(a) * r, rot: rnd(0, 360), size: undefined, showLabel: false }); } for (let i = 0; i < 12; i++) { const a = RNG() * PI * 2, r = rnd(4, R); out.push({ type: pick(["rock", "boulder", "log", "bush", "grass_tuft", "bush"]), x: Math.cos(a) * r, z: Math.sin(a) * r, rot: rnd(0, 360), showLabel: false }); } return out; } },
  park: { name: "City park", desc: "Lawns, crossing paths, pond, benches, lamps, trees, fountain", build() { const out = [{ type: "ground_grass", x: 0, z: 0 }, { type: "path", x: 0, z: 0, size: [3, 0.1, 70] }, { type: "path", x: 0, z: 0, size: [3, 0.1, 70], rot: 90 }, { type: "fountain", x: 0, z: 0, showLabel: false }, { type: "lake", x: 18, z: -16, size: [20, 0.1, 12], showLabel: false }]; for (let i = 0; i < 16; i++) out.push({ type: pick(["tree", "tree", "birch", "willow"]), x: rnd(-34, 34), z: rnd(-34, 34), showLabel: false }); for (let i = 0; i < 6; i++) { const s = i % 2 ? 1 : -1; out.push({ type: "bench", x: s * 2.4, z: -24 + i * 9, rot: s > 0 ? -90 : 90, showLabel: false }); out.push({ type: "streetlamp", x: -s * 2.4, z: -20 + i * 9, rot: s > 0 ? 90 : -90, size: [0.4, 4.2, 1.2], showLabel: false }); } return out; } },
  harbour: { name: "Harbour / docks", desc: "Quay with warehouses, shipping containers, pier, cargo ship and boats on water", build() { const out = [{ type: "ground_concrete", x: 0, z: 20, size: [160, 0.05, 60] }, { type: "ocean", x: 0, z: -60, size: [300, 0.1, 100] }, { type: "pier", x: -25, z: -22, size: [6, 1.2, 30] }, { type: "cargo_ship", x: 20, z: -30, rot: 90, showLabel: false }, { type: "fishing_boat", x: -32, z: -24, rot: 10, showLabel: false }, { type: "speedboat", x: -18, z: -30, rot: -20, showLabel: false }]; for (let i = 0; i < 3; i++) out.push({ type: "warehouse", x: -40 + i * 34, z: 38, rot: 180, showLabel: false }); for (let i = 0; i < 10; i++) out.push({ type: "shipping_container", x: -20 + (i % 5) * 3, z: 12 + Math.floor(i / 5) * 13, color: pick(["#b23b2e", "#2e5fa8", "#d38c2a", "#3d7a4c", "#888"]), showLabel: false }); for (let i = 0; i < 8; i++) out.push({ type: pick(["crate", "barrel", "forklift", "bollard"]), x: rnd(-10, 30), z: rnd(2, 8), showLabel: false }); return out; } },
  airport: { name: "Airport apron", desc: "Runway, taxiway, terminal, control tower, hangar, parked airliners", build() { const out = [{ type: "ground_grass", x: 0, z: 0, size: [600, 0.05, 600] }, { type: "runway", x: -60, z: 0, size: [45, 0.05, 500] }, { type: "ground_concrete", x: 30, z: 0, size: [120, 0.06, 200] }, { type: "office", x: 85, z: 0, rot: -90, size: [80, 18, 30], color: "#8a9aa8", showLabel: false }, { type: "control_tower", x: 70, z: -70, showLabel: false }, { type: "hangar", x: 60, z: 80, rot: -90, showLabel: false }]; for (let i = 0; i < 3; i++) out.push({ type: "airliner", x: 40, z: -50 + i * 50, rot: -90, color: pick(["#f2f2f0", "#e8e6e0"]), showLabel: false }); return out; } },
  desert_road: { name: "Desert road", desc: "Straight road through sand, cacti, rocks, distant mountains", build(o) { const L = o.length || 200, out = [{ type: "ground_sand", x: 0, z: 0, size: [600, 0.05, 600], color: "#d9b77e" }, { type: "road", x: 0, z: 0, size: [8, 0.05, L], sidewalk: false }]; for (let i = 0; i < 24; i++) out.push({ type: pick(["cactus", "rock", "boulder", "dead_tree", "cactus"]), x: (RNG() < 0.5 ? -1 : 1) * rnd(8, 60), z: rnd(-L / 2, L / 2), rot: rnd(0, 360), showLabel: false }); for (let i = 0; i < 5; i++) out.push({ type: "mountain", x: -200 + i * 100, z: -230, color: "#b88a5a", showLabel: false }); out.push({ type: "sand_dune", x: 40, z: 30, showLabel: false }); return out; } },
  highway: { name: "Highway", desc: "Four-lane highway with barrier, guardrails, billboards, open land", build(o) { const L = o.length || 240, out = [{ type: "ground_grass", x: 0, z: 0, size: [600, 0.05, 600], color: "#7a8a52" }, { type: "highway", x: 0, z: 0, size: [16, 0.05, L] }]; for (const s of [1, -1]) out.push({ type: "guardrail", x: s * 8.5, z: 0, rot: 90, size: [L, 0.8, 0.2], showLabel: false }); for (let i = 0; i < 3; i++) out.push({ type: "billboard", x: (i % 2 ? 1 : -1) * 18, z: -80 + i * 70, rot: i % 2 ? -60 : 60, showLabel: false }); for (let i = 0; i < 20; i++) out.push({ type: pick(["tree", "pine", "bush"]), x: (RNG() < 0.5 ? -1 : 1) * rnd(14, 60), z: rnd(-L / 2, L / 2), showLabel: false }); return out; } },
  mountain_road: { name: "Mountain road", desc: "Road with guardrail, pine forest, snowy peaks behind", build(o) { const L = o.length || 160, out = [{ type: "ground_grass", x: 0, z: 0, size: [600, 0.05, 600], color: "#5f6f4a" }, { type: "road", x: 0, z: 0, size: [7, 0.05, L], sidewalk: false }, { type: "guardrail", x: 4.2, z: 0, rot: 90, size: [L, 0.8, 0.2], showLabel: false }]; for (let i = 0; i < 40; i++) out.push({ type: "pine", x: (RNG() < 0.5 ? -1 : 1) * rnd(7, 70), z: rnd(-L / 2, L / 2), showLabel: false }); for (let i = 0; i < 4; i++) out.push({ type: "mountain", x: -180 + i * 120, z: -200, size: [160, rnd(80, 130), 160], showLabel: false }); return out; } },
  farm: { name: "Farm", desc: "Barn, silo, crop fields, fences, tractor, animals", build() { const out = [{ type: "ground_grass", x: 0, z: 0 }, { type: "barn", x: -14, z: -14, rot: 30, showLabel: false }, { type: "silo", x: -24, z: -20, showLabel: false }, { type: "crops", x: 24, z: -8, size: [30, 0.4, 36], showLabel: false }, { type: "path", x: 0, z: 0, size: [4, 0.1, 80], color: "#8a6f50" }, { type: "tractor", x: 10, z: 10, rot: -90, showLabel: false }]; for (let i = 0; i < 4; i++) out.push({ type: "fence", x: -20 + i * 8, z: 14, size: [8, 1.1, 0.1], showLabel: false }); for (let i = 0; i < 5; i++) out.push({ type: pick(["cow", "horse", "cow"]), x: rnd(-30, -6), z: rnd(16, 34), rot: rnd(0, 360), showLabel: false }); for (let i = 0; i < 6; i++) out.push({ type: "tree", x: rnd(-40, 40), z: rnd(30, 45), showLabel: false }); return out; } },
  snowfield: { name: "Snowy wilderness", desc: "Snow ground, snowy pines, cabin, rocks, mountains", build() { const out = [{ type: "ground_snow", x: 0, z: 0, size: [600, 0.05, 600] }, { type: "hut", x: -10, z: -12, rot: 20, color: "#6b4a2e", showLabel: false }]; for (let i = 0; i < 40; i++) { const a = RNG() * PI * 2, r = rnd(10, 60); out.push({ type: "snowy_pine", x: Math.cos(a) * r, z: Math.sin(a) * r, showLabel: false }); } for (let i = 0; i < 3; i++) out.push({ type: "mountain", x: -150 + i * 150, z: -220, size: [180, 110, 180], color: "#a8adb4", showLabel: false }); return out; } },
  rooftop: { name: "Rooftop", desc: "Flat rooftop with parapet, AC units, water tower, helipad, skyline around", build() { const out = [{ type: "ground_concrete", x: 0, z: 0, size: [36, 0.05, 36], color: "#8f8a80" }, { type: "helipad", x: 6, z: -6, showLabel: false }, { type: "water_tower", x: -12, z: -12, showLabel: false }]; for (const [x, z, r, l] of [[0, 18, 0, 36], [0, -18, 0, 36], [18, 0, 90, 36], [-18, 0, 90, 36]]) out.push({ type: "brick_wall", x, z, rot: r, size: [l, 1.1, 0.3], color: "#7f7a70", showLabel: false }); for (let i = 0; i < 4; i++) out.push({ type: "ac_unit", x: rnd(-14, -4), z: rnd(2, 14), showLabel: false }); for (let i = 0; i < 14; i++) { const a = i / 14 * PI * 2; out.push({ type: pick(["skyscraper", "office", "apartment"]), x: Math.cos(a) * rnd(70, 110), z: Math.sin(a) * rnd(70, 110), y: -40, size: [24, rnd(60, 160), 24], showLabel: false }); } return out; } },
  living_room: { name: "Living room", desc: "Interior room with sofa, coffee table, TV, rug, lamp, shelves, plant", build() { return [{ type: "ground_wood", x: 0, z: 0, size: [30, 0.05, 30] }, { type: "room", x: 0, z: 0, size: [8, 3, 6], showLabel: false }, { type: "sofa", x: 0, z: -1.6, showLabel: false }, { type: "rug", x: 0, z: 0, showLabel: false }, { type: "table", x: 0, z: -0.2, size: [1.2, 0.45, 0.6], showLabel: false }, { type: "tv", x: 0, z: 2.6, rot: 180, showLabel: false }, { type: "floor_lamp", x: -1.6, z: -2.3, showLabel: false }, { type: "shelf", x: 3.6, z: -1, rot: -90, showLabel: false }, { type: "plant", x: -3.5, z: -2.5, showLabel: false }]; } },
  bedroom: { name: "Bedroom", desc: "Interior room with bed, desk, chair, lamp, wardrobe", build() { return [{ type: "ground_wood", x: 0, z: 0, size: [30, 0.05, 30] }, { type: "room", x: 0, z: 0, size: [6, 3, 5], color: "#d8d2e0", showLabel: false }, { type: "bed", x: 0, z: -1.3, showLabel: false }, { type: "desk", x: 2.2, z: 1.6, rot: -90, showLabel: false }, { type: "chair", x: 1.6, z: 1.6, rot: 90, showLabel: false }, { type: "shelf", x: -2.7, z: 0.5, rot: 90, color: "#e6dcc8", showLabel: false }, { type: "rug", x: 0, z: 1, size: [2, 0.02, 1.4], showLabel: false }]; } },
  kitchen: { name: "Kitchen", desc: "Kitchen units, fridge, table and chairs", build() { return [{ type: "ground_tiles", x: 0, z: 0, size: [30, 0.05, 30] }, { type: "room", x: 0, z: 0, size: [6, 3, 5], color: "#e8e6e0", showLabel: false }, { type: "kitchen", x: -0.5, z: -2.15, showLabel: false }, { type: "fridge", x: 2.4, z: -2.1, showLabel: false }, { type: "table", x: 0, z: 0.8, showLabel: false }, { type: "chair", x: -0.5, z: 1.5, rot: 180, showLabel: false }, { type: "chair", x: 0.5, z: 0.1, showLabel: false }]; } },
  cafe_interior: { name: "Café interior", desc: "Counter, small round tables and chairs, shelves, plants", build() { const out = [{ type: "ground_wood", x: 0, z: 0, size: [40, 0.05, 40] }, { type: "room", x: 0, z: 0, size: [12, 3.4, 9], color: "#d8c7a8", showLabel: false }, { type: "counter", x: -1, z: -3, showLabel: false }, { type: "shelf", x: -1, z: -4.2, size: [3, 2, 0.4], showLabel: false }]; for (let i = 0; i < 4; i++) { const x = -4 + (i % 2) * 5, z = 0 + Math.floor(i / 2) * 2.8; out.push({ type: "round_table", x, z, showLabel: false }, { type: "chair", x: x - 0.6, z, rot: 90, showLabel: false }, { type: "chair", x: x + 0.6, z, rot: -90, showLabel: false }); } out.push({ type: "plant", x: 5.3, z: -3.8, showLabel: false }); return out; } },
  nightclub: { name: "Club / bar interior", desc: "Dark room, bar counter with stools, DJ booth, dance floor, speakers", build() { const out = [{ type: "ground_tiles", x: 0, z: 0, size: [40, 0.05, 40], color: "#2a2730" }, { type: "room", x: 0, z: 0, size: [16, 4, 12], color: "#2b2830", showLabel: false }, { type: "counter", x: -5, z: -5, showLabel: false }, { type: "dj_booth", x: 4, z: -5, showLabel: false }, { type: "speaker", x: 6.5, z: -5.2, showLabel: false }, { type: "speaker", x: 1.5, z: -5.2, showLabel: false }]; for (let i = 0; i < 4; i++) out.push({ type: "chair", x: -6.5 + i, z: -4.2, color: "#444", showLabel: false }); return out; } },
  concert_stage: { name: "Concert stage", desc: "Stage with lighting truss, speaker stacks, drum kit, mic stands, crowd area", build() { return [{ type: "ground_asphalt", x: 0, z: 0 }, { type: "stage", x: 0, z: -6, showLabel: false }, { type: "light_truss", x: 0, z: -9, y: 1.2, showLabel: false }, { type: "speaker", x: -6.5, z: -3, size: [1.2, 2.4, 1], showLabel: false }, { type: "speaker", x: 6.5, z: -3, size: [1.2, 2.4, 1], showLabel: false }, { type: "drum_kit", x: 0, z: -8, y: 1.2, showLabel: false }, { type: "mic_stand", x: 0, z: -3.2, y: 1.2, showLabel: false }, { type: "spotlight", x: -3, z: -2.5, y: 1.2, rot: 160, showLabel: false }, { type: "spotlight", x: 3, z: -2.5, y: 1.2, rot: -160, showLabel: false }]; } },
  studio: { name: "Film studio cyc", desc: "White cyclorama with film lights, for product shots and music videos", build() { return [{ type: "ground_clay", x: 0, z: 0, color: "#d8d4cc" }, { type: "cyclorama", x: 0, z: -2, showLabel: false }, { type: "film_light", x: -4, z: 2, rot: 145, showLabel: false }, { type: "film_light", x: 4, z: 2, rot: -145, showLabel: false }]; } },
  warehouse_interior: { name: "Warehouse interior", desc: "Big empty concrete space with shelving, crates, forklift, pillars", build() { const out = [{ type: "ground_concrete", x: 0, z: 0, size: [60, 0.05, 60], color: "#8f8a80" }, { type: "room", x: 0, z: 0, size: [30, 9, 24], color: "#7f7a70", showLabel: false }, { type: "forklift", x: 6, z: 2, rot: -40, showLabel: false }]; for (let i = 0; i < 4; i++) out.push({ type: "shelf", x: -10 + i * 4, z: -9, size: [3.5, 4, 1.2], color: "#5f7a8f", showLabel: false }); for (let i = 0; i < 8; i++) out.push({ type: pick(["crate", "barrel", "crate"]), x: rnd(-12, 12), z: rnd(-6, 8), rot: rnd(0, 90), showLabel: false }); for (const x of [-7, 7]) for (const z of [-4, 4]) out.push({ type: "pillar", x, z, size: [0.6, 9, 0.6], showLabel: false }); return out; } },
  empty_clay: { name: "Empty clay stage", desc: "Plain grey clay floor for pure blocking", build() { return [{ type: "ground_clay", x: 0, z: 0 }]; } },
};
BR.KITS = KITS;
BR.buildKit = function (name, o = {}) { BR.seed(o.seed || 11); const k = KITS[name] || KITS.empty_clay; return k.build(o); };

/* collision footprint helpers */
BR.footprint = function (type, size) { const c = BR.CAT[type]; const s = size || (c && c.size) || [1, 1, 1]; return { w: s[0], d: s[2], h: s[1] }; };
})();
