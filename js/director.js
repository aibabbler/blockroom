/* Blockroom AI director: builds the OpenRouter request, then compiles the returned plan into a scene
   (objects, motion keys, poses, visibility, cameras and cuts). Pure data, no three.js scene access. */
(function () {
"use strict";
const BR = window.BR;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const r3 = v => Math.round(v * 1000) / 1000, r1 = v => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => "b" + Math.random().toString(36).slice(2, 9);
const num = (v, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);

/* ---------- shared animation maths (also used by the app) ---------- */
function lerpAng(a, b, u) { const d = ((((b - a) % 360) + 540) % 360) - 180; return a + d * u; }
function poseAt(b, t) {
  const k = b.keys || [], lensBase = b.cam ? b.cam.lens : undefined;
  if (!k.length) return { p: b.pos.slice(), r: b.rot.slice(), l: lensBase };
  const pick = x => ({ p: x.p.slice(), r: x.r.slice(), l: x.l ?? lensBase });
  if (t <= k[0].t) return pick(k[0]);
  if (t >= k[k.length - 1].t) return pick(k[k.length - 1]);
  let lo = 0, hi = k.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (k[m].t <= t) lo = m; else hi = m; }
  const a = k[lo], c = k[hi]; let u = (t - a.t) / Math.max(1e-6, c.t - a.t);
  if (c.e) u = u * u * (3 - 2 * u);
  const la = a.l ?? lensBase, lc = c.l ?? lensBase;
  return { p: a.p.map((v, i) => v + (c.p[i] - v) * u), r: a.r.map((v, i) => lerpAng(v, c.r[i], u)), l: la == null ? undefined : la + (lc - la) * u };
}
function poseNameAt(b, t) { let p = "auto"; for (const x of b.poses || []) { if (x.t <= t + 1e-6) p = x.pose; else break; } return p; }
function visAt(b, t) { let v = true; for (const x of b.vis || []) { if (x.t <= t + 1e-6) v = x.v; else break; } return v; }
function aspectNum(a) { const [x, y] = String(a || "16:9").split(":").map(Number); return x / y || 16 / 9; }
function halfTan(lens, asp) { const t = 18 / lens; return asp >= 1 ? { tx: t, ty: t / asp } : { tx: t * asp, ty: t }; }
function vfovFor(lens, asp) { return 2 * Math.atan(halfTan(lens, asp).ty) * R2D; }
function cutCamAt(S, t) { const cuts = S.cuts || []; let id = S.camId; for (const c of cuts) { if (c.t <= t + 1e-6) id = c.cam; else break; } return id; }
BR.util = { lerpAng, poseAt, poseNameAt, visAt, aspectNum, halfTan, vfovFor, cutCamAt, uid, r1, r3, clamp };

/* ---------- mover classes and speeds ---------- */
function moverOf(type) {
  const c = BR.CAT[type]; if (!c) return "static";
  if (c.kind === "actor") return "walker";
  if (c.kind === "animal") return type === "bird" || type === "flock" ? "heli" : "walker";
  if (c.kind === "vehicle") return "car";
  if (c.kind === "boat") return "boat";
  if (c.kind === "aircraft") return ["helicopter", "drone"].includes(type) ? "heli" : ["hot_air_balloon", "blimp"].includes(type) ? "drift" : "plane";
  if (c.kind === "camera") return "cam";
  return "prop";
}
const SPEEDS = {
  walker: { crawl: 0.4, slow: 0.8, walk: 1.4, jog: 2.8, run: 4.6, sprint: 6.6, cruise: 1.4, fast: 4.6 },
  car: { crawl: 2, slow: 4, walk: 6, jog: 9, run: 14, sprint: 28, cruise: 12, fast: 22 },
  heli: { crawl: 2, slow: 5, walk: 8, jog: 12, run: 20, sprint: 35, cruise: 15, fast: 30 },
  plane: { crawl: 20, slow: 35, walk: 45, jog: 55, run: 70, sprint: 100, cruise: 60, fast: 90 },
  boat: { crawl: 1, slow: 3, walk: 5, jog: 7, run: 10, sprint: 18, cruise: 8, fast: 15 },
  drift: { crawl: 0.5, slow: 1.5, walk: 2.5, jog: 3.5, run: 5, sprint: 8, cruise: 3, fast: 6 },
  prop: { crawl: 0.3, slow: 0.8, walk: 1.4, jog: 2.8, run: 4.6, sprint: 6.6, cruise: 2, fast: 5 },
  cam: { crawl: 0.3, slow: 0.8, walk: 1.4, jog: 2.8, run: 4.6, sprint: 8, cruise: 2, fast: 5 },
};
BR.moverOf = moverOf;

/* ---------- prompt ---------- */
const TIMES = ["day", "golden_hour", "dusk", "night", "overcast", "dawn"];
const WEATHERS = ["clear", "rain", "fog", "snow"];
const ASPECTS = ["16:9", "9:16", "1:1", "4:5", "21:9"];
const ACTIONS = ["move", "follow", "flee", "wander", "orbit", "turn", "pose", "hide", "show"];
const SPEEDS_ENUM = ["crawl", "slow", "walk", "jog", "run", "sprint", "cruise", "fast"];
const POSES = ["auto", "stand", "sit", "crouch", "kneel", "lie", "fall", "wave", "point", "talk", "hands_up", "aim", "fight", "dance", "sing", "phone", "drive"];
const SIZES = ["extreme_close", "close", "medium_close", "medium", "cowboy", "full", "wide", "extreme_wide", "aerial"];
const ANGLES = ["eye", "low", "high", "overhead", "dutch"];
const MOVES = ["static", "pan", "push_in", "pull_out", "track_left", "track_right", "follow", "lead", "side_track", "orbit_left", "orbit_right", "crane_up", "crane_down", "handheld", "pov", "over_shoulder"];
const SIDES = ["front", "back", "left", "right", "front_left", "front_right", "back_left", "back_right"];
BR.ENUMS = { TIMES, WEATHERS, ASPECTS, ACTIONS, SPEEDS_ENUM, POSES, SIZES, ANGLES, MOVES, SIDES };

const KIT_ZONES = {
  city_street: "Road runs along Z through x=0 (lanes at x=-2 and x=+2, traffic along Z). Pavements at |x| 4 to 7.5. Shopfronts face the road at |x| about 7.5 and deeper. Parked cars already at x=±3; leave space if you add vehicles.",
  downtown: "Wide road along Z, |x| under 7 is road, pavements |x| 7 to 11, towers beyond |x| 11.5.",
  suburb: "Road along Z, |x| under 3.5. Front lawns |x| 4 to 11, houses at |x| about 17.",
  village_square: "Open plaza from -17 to 17 on both axes, fountain at the centre (radius 2.5), market stalls at z about 9, church at z=-26.",
  alley: "Narrow alley along Z, walkable |x| under 2. Buildings beyond.",
  beach: "Sea is z below 0 (water surface y=0), shoreline at z=0, sand from z=0 to 80. Umbrellas around z 2 to 9, palms z 14 to 34. Boats only at z below -5.",
  riverside: "River runs along X with water between z=-7 and z=7. A footbridge crosses at x=0. Paths at z=±12. Grass beyond.",
  forest: "Clearing of radius 8 around the origin; trees from radius 9 outward.",
  park: "Paths along both axes through the origin, fountain at centre, pond near x=18 z=-16.",
  harbour: "Quay (concrete) from z=-10 to 50 at y=0. Water for boats at z below -12. Pier from x=-25 z=-37 to z=-7. Containers around x -20 to -8, z 12 to 25.",
  airport: "Runway along Z at x=-60. Apron (concrete) x -30 to 90. Terminal at x=85. Parked airliners at x=40.",
  desert_road: "Road along Z at x=0, sand everywhere else, mountains far at z=-230.",
  highway: "Four lanes along Z, |x| under 8, central barrier at x=0 (northbound lanes x=+2 and +6, southbound x=-2 and -6).",
  mountain_road: "Road along Z, |x| under 3.5, guardrail at x=4.2, drop beyond.",
  farm: "Barn near x=-14 z=-14, crop field x 9 to 39, dirt track along Z at x=0, animals around x -30 to -6 z 16 to 34.",
  snowfield: "Open snow, cabin near x=-10 z=-12, pines from radius 10.",
  rooftop: "Roof from -18 to 18 on both axes at y=0 with knee-high walls at the edges, helipad at x=6 z=-6, skyline far below.",
  living_room: "Room interior from x -4 to 4, z -3 to 3 (open side faces +Z). Sofa at z=-1.6, TV at z=2.6.",
  bedroom: "Room interior x -3 to 3, z -2.5 to 2.5, open side +Z.",
  kitchen: "Room interior x -3 to 3, z -2.5 to 2.5, open side +Z.",
  cafe_interior: "Room interior x -6 to 6, z -4.5 to 4.5, counter at z=-3, tables between.",
  nightclub: "Room interior x -8 to 8, z -6 to 6, bar at x=-5 z=-5, DJ at x=4 z=-5, dance floor around the origin.",
  concert_stage: "Stage top surface at y=1.2 spanning x -6 to 6, z -10 to -2. Audience area z 0 to 20.",
  studio: "White cyc from x -5 to 5, z -6 to 2, floor y=0.",
  warehouse_interior: "Interior x -15 to 15, z -12 to 12, shelving at z=-9.",
  empty_clay: "Plain flat floor.",
};

function catalogText() {
  const rows = [];
  for (const cat of BR.CATEGORIES) {
    const items = BR.CATALOG.filter(c => c.cat === cat);
    rows.push(`# ${cat}`);
    for (const c of items) rows.push(`${c.type} | ${c.name} | ${c.size.join("x")}m`);
  }
  return rows.join("\n");
}
function kitsText() { return Object.entries(BR.KITS).map(([k, v]) => `${k} | ${v.desc} | ${KIT_ZONES[k] || ""}`).join("\n"); }

BR.systemPrompt = function () {
  return `You are the previs director and production designer inside Blockroom, a 3D blocking app for AI filmmakers. You turn a film brief into a precise 3D scene plan: a set, cast, props, timed movement and camera shots. The app builds it from your JSON and the filmmaker records it as a reference video for an AI video model, so spatial accuracy, readable staging and clean camera work matter more than anything.

WORLD CONVENTIONS
- Units are metres and seconds. Y is up, ground is y=0.
- The audience's default view looks from +Z toward -Z. x grows to screen right.
- rot is yaw in degrees around Y. rot 0 means the object's FRONT faces +Z (toward the default viewer). rot 180 faces -Z (away). rot 90 faces +X, rot -90 faces -X.
- Every object's x,z is the centre of its footprint; y is the bottom (0 on the ground; stage top, platform top, deck or roof height if standing on something; flight altitude for aircraft in the air; 0 for boats on water).
- Use each item's real dimensions (W x H x D, D runs front to back) to keep objects from overlapping. Leave at least 0.6 m between people and walls, 1.5 m around vehicles.

SET KITS (whole environments generated for you; place 0 to 2, normally 1 at x=0 z=0 rot=0)
type | what it contains | layout zones you must respect
${kitsText()}
Kits already contain their buildings, trees and props. Only add objects the story needs (characters, hero vehicles, hero props, extra set pieces). Never put story objects inside kit buildings, walls or water unless they are boats.

CATALOGUE (type | name | default size W x H x D)
${catalogText()}

OBJECT RULES
- id: short unique snake_case id you reuse in actions and shots.
- label: SHORT UPPERCASE name shown on the block (e.g. "MAYA", "POLICE CAR 1").
- notes: what this stand-in becomes in the final film (look, wardrobe, material, colour, era), one sentence.
- scale: null for normal size, or a multiplier. color: a hex colour that helps the video model tell subjects apart (hero subjects get distinct saturated colours), or null.
- count: only for type "crowd" (number of extras 3 to 40); the crowd spreads across its footprint. Otherwise null.
- sign: text for the sign of a shop, café, restaurant, bar, bank, hotel or billboard; otherwise null.
- Vehicles sit in road lanes facing their direction of travel. Boats on water. Aircraft start where the story needs them (on the ground at y=0 or flying at altitude).

ACTIONS (times in seconds inside 0..duration; one actor can have many actions in time order)
- move: travel along path waypoints [[x,y,z],...] (y 0 on the ground, altitude for aircraft) or to target (an object id, stops beside it). speed one of ${SPEEDS_ENUM.join(", ")}. If end is set, the move is timed to finish at end.
- follow: chase or tail target from start to end, keeping distance metres behind.
- flee: run away from target for distance metres.
- wander: idle milling around the current spot until end (crowds, extras).
- orbit: circle around target (or path[0] as a centre) until end; helicopters, drones, dancers, cameras.
- turn: face target (or the direction of path[0]) at start.
- pose: change body pose from start (and back to auto at end if end is set): ${POSES.join(", ")}. Walking and running are automatic from speed, so only use pose for still actions.
- hide / show: make an object vanish or appear at start (e.g. someone gets into a car).
Choreograph with intent: people walk around obstacles via waypoints, chases use follow, vehicles turn smoothly with several waypoints, nothing passes through buildings or other subjects. Fill the whole duration with purposeful action; avoid long dead time.

SHOTS (camera coverage)
- If the brief wants one continuous take, give exactly one shot from 0 to duration. Otherwise cut into several shots that cover 0..duration with no gaps, each 1.5 s or longer.
- size: ${SIZES.join(", ")}. angle: ${ANGLES.join(", ")}. side: where the camera stands relative to the subject's facing: ${SIDES.join(", ")}.
- move: ${MOVES.join(", ")}. follow stays behind a moving subject, lead stays ahead of it, side_track runs alongside, pov looks through the subject's eyes, over_shoulder needs secondary (whose shoulder we look over).
- subject: object id the camera frames. lens: millimetres or null for a sensible default.
Think like a cinematographer: establish geography, keep screen direction, motivate moves by action, vary sizes, and choose angles that make the moment read.

VIDEO PROMPT
Also write video_prompt: the prompt the filmmaker will paste into the video model together with the blocking video. Rules: plain flowing description in present tense, rich in movement, expressions, wardrobe, light and camera language; no numbers anywhere except a final line "Aspect ratio ${"{aspect}"}"; no timings or durations; no colon headings, labels, brackets or arrows; for several shots, put each shot on its own plain line in order. Tell the model the coloured blocks in the reference video stand in for the real subjects and that it should follow the reference video's staging, motion and camera exactly.

Return only JSON that matches the schema.`;
};

/* strict JSON schema */
BR.planSchema = function () {
  const n = { type: "number" }, nn = { type: ["number", "null"] }, s = { type: "string" }, sn = { type: ["string", "null"] }, ins = { type: ["integer", "null"] };
  const types = BR.CATALOG.filter(c => !c.camera).map(c => c.type);
  const obj = (props) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });
  return obj({
    title: s, summary: s, duration: n, aspect: { type: "string", enum: ASPECTS },
    look: obj({ time: { type: "string", enum: TIMES }, weather: { type: "string", enum: WEATHERS }, style: { type: "string", enum: ["colour", "clay"] } }),
    kits: { type: "array", items: obj({ kit: { type: "string", enum: Object.keys(BR.KITS) }, x: n, z: n, rot: n, length: nn, seed: { type: "integer" } }) },
    objects: { type: "array", items: obj({ id: s, type: { type: "string", enum: types }, label: s, notes: s, x: n, y: n, z: n, rot: n, scale: nn, color: sn, count: ins, sign: sn }) },
    actions: { type: "array", items: obj({ who: s, kind: { type: "string", enum: ACTIONS }, start: n, end: nn, path: { type: "array", items: { type: "array", items: n } }, target: sn, speed: { type: ["string", "null"], enum: [...SPEEDS_ENUM, null] }, pose: { type: ["string", "null"], enum: [...POSES, null] }, distance: nn }) },
    shots: { type: "array", items: obj({ start: n, end: n, size: { type: "string", enum: SIZES }, angle: { type: "string", enum: ANGLES }, move: { type: "string", enum: MOVES }, subject: sn, secondary: sn, side: { type: "string", enum: SIDES }, lens: nn }) },
    video_prompt: s,
  });
};

BR.buildMessages = function ({ brief, duration, aspect, takes, prevPlan, instruction }) {
  const sys = BR.systemPrompt().replace("{aspect}", aspect);
  const msgs = [{ role: "system", content: sys }];
  if (prevPlan && instruction) {
    msgs.push({ role: "user", content: `Here is the current scene plan as JSON:\n${JSON.stringify(prevPlan)}\n\nChange it as follows, keeping everything I don't mention exactly as it is (same ids, positions and timing):\n${instruction}\n\nReturn the complete updated plan.` });
  } else {
    msgs.push({ role: "user", content: `Brief: ${brief}\n\nLength: ${duration} seconds. Aspect ratio: ${aspect}. Coverage: ${takes === "multi" ? "several shots with cuts" : takes === "single" ? "one continuous shot" : "your choice of one take or several shots"}.\nPlan the full scene.` });
  }
  return msgs;
};

BR.parsePlan = function (text) {
  if (typeof text === "object" && text) return text;
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("The model did not return a scene plan.");
  return JSON.parse(t.slice(a, b + 1));
};

/* ======================================================================
   COMPILE PLAN -> SCENE
   ====================================================================== */
const SIZE_H = { extreme_close: 0.22, close: 0.42, medium_close: 0.75, medium: 1.15, cowboy: 1.6, full: 2.3, wide: 7, extreme_wide: 26, aerial: 45 };
const SIZE_LENS = { extreme_close: 100, close: 85, medium_close: 65, medium: 50, cowboy: 40, full: 35, wide: 28, extreme_wide: 24, aerial: 24 };
const SIZE_AIM = { extreme_close: 0.94, close: 0.92, medium_close: 0.87, medium: 0.8, cowboy: 0.72, full: 0.55, wide: 0.5, extreme_wide: 0.45, aerial: 0.4 };
const SIDE_ANG = { front: 0, back: 180, left: 90, right: -90, front_left: 35, front_right: -35, back_left: 145, back_right: -145 };
const LOOKS = {
  day: { sunEl: 52, sunAz: 215, sunPower: 1.25, bg: "#a9c4dc" },
  golden_hour: { sunEl: 9, sunAz: 245, sunPower: 1.15, bg: "#e6b07a" },
  dusk: { sunEl: 3, sunAz: 260, sunPower: 0.45, bg: "#6c6a8e" },
  night: { sunEl: 40, sunAz: 140, sunPower: 0.18, bg: "#0e1424" },
  overcast: { sunEl: 60, sunAz: 200, sunPower: 0.45, bg: "#b7bcc0" },
  dawn: { sunEl: 7, sunAz: 100, sunPower: 0.75, bg: "#d9a8a4" },
};
BR.LOOKS = LOOKS;

function newBlock(type, o = {}) {
  const c = BR.CAT[type] || BR.CAT.box;
  const b = {
    id: uid(), type: c.type, label: (c.name || type).toUpperCase().slice(0, 24), notes: "", color: c.color,
    size: c.size.slice(), pos: [0, 0, 0], rot: [0, 0, 0], keys: [], poses: [], vis: [],
    showLabel: !["ground", "street", "nature", "water", "building"].includes(c.kind), guide: false, locked: c.kind === "ground", hidden: false, img: null, seed: Math.floor(Math.random() * 9999) + 1,
  };
  if (c.sign) b.sign = c.sign;
  if (c.camera) b.cam = { lens: 35, lookAt: null, aim: 0.85 };
  return Object.assign(b, o);
}
BR.newBlock = newBlock;

function baseScene(o = {}) {
  return Object.assign({ v: 2, id: "s" + uid().slice(1), name: "Untitled scene", duration: 10, fps: 24, aspect: "16:9",
    look: { time: "day", weather: "clear", style: "colour", ...LOOKS.day, shadows: true, haze: true },
    labelsInShot: false, grid: true, thirds: true, camId: null, cuts: [], blocks: [], plan: null, brief: "", videoPrompt: "" }, o);
}
BR.baseScene = baseScene;

function rotXZ(x, z, deg) { const a = deg * D2R, c = Math.cos(a), s = Math.sin(a); return [x * c + z * s, -x * s + z * c]; }

/* rotated rectangle footprint for collision */
function rect(b) { const yaw = (b.rot[1] || 0) * D2R; const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw)); const w = b.size[0], d = b.size[2]; return { x: b.pos[0], z: b.pos[2], hx: (w * c + d * s) / 2, hz: (w * s + d * c) / 2 }; }
function inside(r, x, z, pad = 0) { return Math.abs(x - r.x) < r.hx + pad && Math.abs(z - r.z) < r.hz + pad; }
const SOLID = new Set(["building"]);

BR.compilePlan = function (plan, opts = {}) {
  const P = plan || {};
  const dur = clamp(num(P.duration, opts.duration || 10), 2, 120);
  const S = baseScene({ name: (P.title || "AI scene").slice(0, 60), duration: dur, aspect: ASPECTS.includes(P.aspect) ? P.aspect : (opts.aspect || "16:9"), plan: P, brief: opts.brief || "", videoPrompt: P.video_prompt || "" });
  const time = TIMES.includes(P.look?.time) ? P.look.time : "day";
  S.look = Object.assign(S.look, { time, weather: WEATHERS.includes(P.look?.weather) ? P.look.weather : "clear", style: P.look?.style === "clay" ? "clay" : "colour" }, LOOKS[time]);
  const add = b => { S.blocks.push(b); return b; };

  /* kits */
  let hasGround = false;
  for (const k of (P.kits || []).slice(0, 3)) {
    if (!BR.KITS[k.kit]) continue;
    const specs = BR.buildKit(k.kit, { length: num(k.length, 0) || undefined, seed: k.seed || 11 });
    for (const sp of specs) {
      if (!BR.CAT[sp.type]) continue;
      const cat = BR.CAT[sp.type];
      if (cat.ground) { if (hasGround) continue; hasGround = true; }
      const [x, z] = rotXZ(sp.x || 0, sp.z || 0, num(k.rot));
      const b = newBlock(sp.type, { ai: "kit", kit: k.kit, pos: [r3(x + num(k.x)), sp.y || (cat.ground ? -(sp.size ? sp.size[1] : cat.size[1]) + 0.0 : 0), r3(z + num(k.z))], rot: [0, r1(num(sp.rot) + num(k.rot)), 0] });
      if (cat.ground) b.pos[1] = -b.size[1];
      if (sp.size) b.size = sp.size.map(v => Math.max(0.01, num(v, 1)));
      if (sp.color) b.color = sp.color; if (sp.color2) b.color2 = sp.color2; if (sp.sign) b.sign = sp.sign; if (sp.sidewalk === false) b.sidewalk = false;
      if (sp.label) b.label = sp.label; if (sp.showLabel === false) b.showLabel = false;
      if (cat.ground) { b.pos[1] = -b.size[1]; b.locked = true; }
      add(b);
    }
  }
  if (!hasGround) add(newBlock("ground_clay", { ai: "kit", pos: [0, -0.05, 0], locked: true }));

  /* story objects */
  const idMap = {}, members = {};
  for (const o of (P.objects || []).slice(0, 120)) {
    const type = BR.CAT[o.type] ? o.type : "box";
    const cat = BR.CAT[type];
    const sc = num(o.scale, 1) > 0 ? num(o.scale, 1) : 1;
    const base = { ai: "story", label: String(o.label || cat.name).toUpperCase().slice(0, 24), notes: String(o.notes || ""), pos: [r3(num(o.x)), r3(num(o.y)), r3(num(o.z))], rot: [0, r1(num(o.rot)), 0] };
    if (o.color && /^#[0-9a-f]{6}$/i.test(o.color)) base.color = o.color;
    if (o.sign) base.sign = String(o.sign).slice(0, 18);
    if (cat.crowd) {
      const n = clamp(Math.round(num(o.count, 10)), 2, 40); const ids = [];
      const area = [cat.size[0] * sc, cat.size[2] * sc];
      for (let i = 0; i < n; i++) {
        const t = BR.pick(["man", "woman", "man", "woman", "elder", "child", "traveller"]);
        const dx = (Math.random() - 0.5) * area[0], dz = (Math.random() - 0.5) * area[1];
        const b = add(newBlock(t, { ai: "story", crowdOf: o.id, label: `${base.label} ${i + 1}`, showLabel: false, notes: base.notes, pos: [r3(base.pos[0] + dx), base.pos[1], r3(base.pos[2] + dz)], rot: [0, r1(base.rot[1] + (Math.random() - 0.5) * 70), 0], color: BR.pick(["#7a6a58", "#5a6a7a", "#8a5a4a", "#6a7a5a", "#9a8f80", "#4a4a5a", "#a87a5a"]) }));
        ids.push(b.id);
      }
      members[o.id] = ids; idMap[o.id] = ids[0];
      continue;
    }
    const b = newBlock(type, base);
    if (sc !== 1) b.size = b.size.map(v => r3(v * sc));
    add(b); idMap[o.id] = b.id;
  }

  /* placement solver: push story objects out of solid kit footprints and away from each other */
  const blocks = S.blocks;
  const solids = blocks.filter(b => b.ai === "kit" && SOLID.has(BR.CAT[b.type].kind) && !["room", "stage", "cyclorama", "helipad", "fountain"].includes(b.type)).map(rect);
  const story = blocks.filter(b => b.ai === "story" && b.pos[1] < 0.5);
  for (let iter = 0; iter < 6; iter++) {
    for (const b of story) {
      for (const r of solids) {
        const pad = 0.4 + Math.min(b.size[0], b.size[2]) / 2;
        if (inside(r, b.pos[0], b.pos[2], pad)) {
          const dx = b.pos[0] - r.x, dz = b.pos[2] - r.z;
          const ox = r.hx + pad - Math.abs(dx), oz = r.hz + pad - Math.abs(dz);
          if (ox < oz) b.pos[0] = r3(b.pos[0] + Math.sign(dx || 1) * ox); else b.pos[2] = r3(b.pos[2] + Math.sign(dz || 1) * oz);
        }
      }
    }
    for (let i = 0; i < story.length; i++) for (let j = i + 1; j < story.length; j++) {
      const a = story[i], c = story[j];
      const ra = Math.max(a.size[0], a.size[2]) / 2, rc = Math.max(c.size[0], c.size[2]) / 2;
      const dx = c.pos[0] - a.pos[0], dz = c.pos[2] - a.pos[2], d = Math.hypot(dx, dz), min = (ra + rc) * 0.85 + 0.15;
      if (d < min && d > 1e-4 && Math.abs(a.pos[1] - c.pos[1]) < 1) { const push = (min - d) / 2, ux = dx / d, uz = dz / d; a.pos[0] = r3(a.pos[0] - ux * push); a.pos[2] = r3(a.pos[2] - uz * push); c.pos[0] = r3(c.pos[0] + ux * push); c.pos[2] = r3(c.pos[2] + uz * push); }
    }
  }
  /* remove kit props that collide with story objects */
  const storyR = story.map(b => ({ b, r: rect(b) }));
  S.blocks = blocks.filter(b => {
    if (b.ai !== "kit") return true;
    const k = BR.CAT[b.type].kind;
    if (!["vehicle", "prop", "street", "nature", "furniture", "animal"].includes(k) || ["road", "highway", "sidewalk", "plaza", "path", "crosswalk", "crossroads", "parking", "runway", "rails", "bridge", "pier", "guardrail", "fence", "crops", "brick_wall"].includes(b.type)) return true;
    const r = rect(b);
    return !storyR.some(({ r: q }) => Math.abs(q.x - r.x) < q.hx + r.hx && Math.abs(q.z - r.z) < q.hz + r.hz);
  });

  /* ---- actions ---- */
  const byId = Object.fromEntries(S.blocks.map(b => [b.id, b]));
  const state = {};
  const st = b => state[b.id] || (state[b.id] = { t: 0, p: b.pos.slice(), yaw: b.rot[1] });
  const resolve = (ref) => { if (!ref) return null; const id = idMap[ref] || (byId[ref] ? ref : null); return id ? byId[id] : null; };
  const posOfAt = (b, t) => { const s = state[b.id]; if (b.keys.length) return poseAt(b, t).p; return s ? s.p : b.pos; };
  const holdKey = (b, t) => { const s = st(b); if (!b.keys.length || b.keys[b.keys.length - 1].t < t - 1e-3) b.keys.push({ t: r3(t), p: s.p.map(r3), r: [0, r1(s.yaw), 0], e: 0 }); };
  const ensureStart = b => { if (!b.keys.length) b.keys.push({ t: 0, p: b.pos.map(r3), r: [0, r1(b.rot[1]), 0], e: 0 }); };
  const speedFor = (b, sp) => { const tbl = SPEEDS[moverOf(b.type)] || SPEEDS.prop; return tbl[sp] || tbl.walk || 1.4; };

  function catmull(pts, samples) {
    if (pts.length < 3) return pts;
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let s = 0; s < samples; s++) {
        const t = s / samples, t2 = t * t, t3 = t2 * t;
        out.push([0, 1, 2].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    out.push(pts[pts.length - 1]); return out;
  }
  function travel(b, pts, t0, t1OrNull, speedName) {
    const s = st(b), mv = moverOf(b.type);
    ensureStart(b); holdKey(b, t0);
    const all = [s.p.slice(), ...pts];
    const sm = catmull(all, 8);
    const cum = [0]; for (let i = 1; i < sm.length; i++) cum.push(cum[i - 1] + Math.hypot(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1], sm[i][2] - sm[i - 1][2]));
    const L = cum[cum.length - 1]; if (L < 0.05) return;
    let dur = t1OrNull != null && t1OrNull > t0 + 0.2 ? t1OrNull - t0 : L / speedFor(b, speedName || "walk");
    dur = Math.min(dur, Math.max(0.3, S.duration - t0 + 0.0001)); if (dur <= 0.05) return;
    const ramp = Math.min(mv === "walker" ? 0.5 : 1.2, dur / 3);
    const vmax = L / (dur - ramp); // trapezoid: accel over ramp, cruise, decel over ramp
    const distAt = t => { if (t <= ramp) return 0.5 * vmax / ramp * t * t; if (t >= dur - ramp) { const r = dur - t; return L - 0.5 * vmax / ramp * r * r; } return 0.5 * vmax * ramp + vmax * (t - ramp); };
    const ptAt = d => { let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; const u = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]); return [0, 1, 2].map(k => sm[i - 1][k] + (sm[i][k] - sm[i - 1][k]) * clamp(u, 0, 1)); };
    const step = mv === "plane" ? 0.25 : 0.2; let yaw = s.yaw, prevYaw = s.yaw;
    for (let tt = step; tt <= dur + 1e-6; tt += step) {
      const tcl = Math.min(tt, dur), d = distAt(tcl), p = ptAt(d), q = ptAt(Math.min(L, d + 0.6));
      const dx = q[0] - p[0], dz = q[2] - p[2];
      if (Math.hypot(dx, dz) > 0.05) yaw = Math.atan2(dx, dz) * R2D;
      if (mv === "boat") p[1] = 0;
      let roll = 0, pitch = 0;
      if (mv === "plane" || mv === "heli") { const dy = ((((yaw - prevYaw) % 360) + 540) % 360) - 180; roll = clamp(-dy / step * (mv === "plane" ? 0.5 : 0.25), -35, 35); pitch = mv === "heli" ? clamp(vmax * 0.8, 0, 12) * (tcl > ramp && tcl < dur - ramp ? 1 : 0.4) : clamp(-Math.atan2(q[1] - p[1], 0.6 + 1e-6) * R2D * 0.3, -15, 15); }
      prevYaw = yaw;
      b.keys.push({ t: r3(t0 + tcl), p: p.map(r3), r: [r1(pitch), r1(yaw), r1(roll)], e: 0 });
    }
    s.t = t0 + dur; s.p = ptAt(L); s.yaw = yaw;
  }
  const acts = (P.actions || []).filter(a => a && a.who).map(a => ({ ...a, start: clamp(num(a.start), 0, dur), end: a.end == null ? null : clamp(num(a.end), 0, dur) })).sort((a, c) => a.start - c.start);
  // expand crowd actions to members
  const expanded = [];
  for (const a of acts) {
    if (members[a.who]) { const m = members[a.who]; m.forEach((id, i) => { const b = byId[id]; const off = [b.pos[0] - byId[m[0]].pos[0], 0, b.pos[2] - byId[m[0]].pos[2]]; expanded.push({ ...a, who: id, start: Math.min(dur, a.start + Math.random() * 0.5), path: (a.path || []).map(p => [num(p[0]) + off[0], num(p[1]), num(p[2]) + off[2]]), _direct: true }); }); }
    else expanded.push(a);
  }
  const later = [];
  for (const a of expanded) {
    const b = a._direct ? byId[a.who] : resolve(a.who); if (!b) continue;
    const s = st(b);
    const path = (a.path || []).filter(p => Array.isArray(p) && p.length >= 2).map(p => p.length === 2 ? [num(p[0]), b.pos[1], num(p[1])] : [num(p[0]), num(p[1]), num(p[2])]);
    const tgt = resolve(a.target);
    switch (a.kind) {
      case "move": {
        const pts = path.slice();
        if (tgt) { const tp = posOfAt(tgt, a.start); const dx = tp[0] - (pts.length ? pts[pts.length - 1][0] : s.p[0]), dz = tp[2] - (pts.length ? pts[pts.length - 1][2] : s.p[2]); const dd = Math.hypot(dx, dz) || 1; const stop = Math.max(tgt.size[0], tgt.size[2]) / 2 + Math.max(b.size[0], b.size[2]) / 2 + 0.3; pts.push([tp[0] - dx / dd * stop, b.pos[1] > 0.5 && moverOf(b.type) !== "walker" ? (pts.length ? pts[pts.length - 1][1] : s.p[1]) : s.p[1], tp[2] - dz / dd * stop]); }
        if (pts.length) travel(b, pts, Math.max(a.start, s.t), a.end, a.speed);
        break;
      }
      case "flee": {
        const from = tgt ? posOfAt(tgt, a.start) : [s.p[0], 0, s.p[2] - 1];
        let dx = s.p[0] - from[0], dz = s.p[2] - from[2]; const dd = Math.hypot(dx, dz) || 1; dx /= dd; dz /= dd;
        const D = num(a.distance, 18);
        const pts = path.length ? path : [[s.p[0] + dx * D * 0.5 + dz * 1.5, s.p[1], s.p[2] + dz * D * 0.5 - dx * 1.5], [s.p[0] + dx * D, s.p[1], s.p[2] + dz * D]];
        travel(b, pts, Math.max(a.start, s.t), a.end, a.speed || "run");
        break;
      }
      case "wander": {
        const t0 = Math.max(a.start, s.t), t1 = a.end ?? dur; const c0 = s.p.slice(); let t = t0;
        while (t < t1 - 0.8) { const pt = [c0[0] + (Math.random() - 0.5) * 5, c0[1], c0[2] + (Math.random() - 0.5) * 5]; const before = s.t; travel(b, [pt], t, null, a.speed || "slow"); t = Math.max(s.t, before + 0.5) + 0.6 + Math.random() * 1.5; if (s.t <= before) break; }
        break;
      }
      case "orbit": {
        const c = tgt ? posOfAt(tgt, a.start) : path[0] || [0, 0, 0];
        const t0 = Math.max(a.start, s.t), t1 = a.end ?? dur; ensureStart(b); holdKey(b, t0);
        const R = num(a.distance, Math.hypot(s.p[0] - c[0], s.p[2] - c[2]) || 8), alt = s.p[1];
        let ang = Math.atan2(s.p[0] - c[0], s.p[2] - c[2]); const w = speedFor(b, a.speed || "slow") / Math.max(1, R);
        for (let t = t0 + 0.2; t <= t1 + 1e-6; t += 0.2) { ang += w * 0.2; const p = [c[0] + Math.sin(ang) * R, alt, c[2] + Math.cos(ang) * R]; const yaw = (ang * R2D) + 90; b.keys.push({ t: r3(t), p: p.map(r3), r: [0, r1(yaw), moverOf(b.type) === "heli" ? -10 : 0], e: 0 }); s.p = p; s.yaw = yaw; }
        s.t = t1; break;
      }
      case "turn": {
        ensureStart(b); holdKey(b, Math.max(a.start, s.t));
        const tp = tgt ? posOfAt(tgt, a.start) : path[0]; if (!tp) break;
        const yaw = Math.atan2(tp[0] - s.p[0], tp[2] - s.p[2]) * R2D; const t1 = Math.max(a.start, s.t) + 0.6;
        b.keys.push({ t: r3(t1), p: s.p.map(r3), r: [0, r1(yaw), 0], e: 1 }); s.yaw = yaw; s.t = t1; break;
      }
      case "pose": { if (a.pose && POSES.includes(a.pose)) { b.poses.push({ t: r3(a.start), pose: a.pose }); if (a.end != null) b.poses.push({ t: r3(a.end), pose: "auto" }); } break; }
      case "hide": b.vis.push({ t: r3(a.start), v: false }); break;
      case "show": b.vis.push({ t: r3(a.start), v: true }); break;
      case "follow": later.push({ a, b, tgt }); break;
    }
  }
  for (const { a, b, tgt } of later) {
    if (!tgt) continue;
    const s = st(b), t0 = Math.max(a.start, s.t), t1 = a.end ?? dur; ensureStart(b); holdKey(b, t0);
    const gap = num(a.distance, 3);
    let pTrail = s.p.slice(), yaw = s.yaw;
    const trail = [];
    for (let t = 0; t <= t1 + 1e-6; t += 0.1) trail.push({ t, p: poseAt(tgt, t).p });
    const v = speedFor(b, a.speed || "run");
    for (let t = t0 + 0.2; t <= t1 + 1e-6; t += 0.2) {
      // aim for the point on the target's trail that is `gap` metres behind its current position
      const cur = poseAt(tgt, t).p; let aim = cur, acc = 0;
      for (let i = trail.length - 1; i > 0; i--) { if (trail[i].t > t) continue; const q = trail[i - 1].p, r = trail[i].p; acc += Math.hypot(r[0] - q[0], r[2] - q[2]); if (acc >= gap) { aim = q; break; } }
      const dx = aim[0] - pTrail[0], dz = aim[2] - pTrail[2], dd = Math.hypot(dx, dz); const stepL = Math.min(dd, v * 0.2 * 1.15);
      if (dd > 0.05) { pTrail = [pTrail[0] + dx / dd * stepL, b.pos[1] > 0.5 && moverOf(b.type) !== "walker" ? aim[1] : pTrail[1], pTrail[2] + dz / dd * stepL]; yaw = Math.atan2(dx, dz) * R2D; }
      b.keys.push({ t: r3(t), p: pTrail.map(r3), r: [0, r1(yaw), 0], e: 0 });
    }
    s.p = pTrail; s.yaw = yaw; s.t = t1;
  }
  for (const b of S.blocks) { if (b.keys.length) b.keys.sort((a, c) => a.t - c.t); if (b.keys.length === 1) { b.pos = b.keys[0].p.slice(); b.rot = b.keys[0].r.slice(); b.keys = []; } (b.poses || []).sort((a, c) => a.t - c.t); (b.vis || []).sort((a, c) => a.t - c.t); }

  /* ---- shots ---- */
  let shots = (P.shots || []).filter(s => s && num(s.end) > num(s.start)).map(s => ({ ...s, start: clamp(num(s.start), 0, dur), end: clamp(num(s.end), 0, dur) })).sort((a, c) => a.start - c.start);
  if (!shots.length) { const hero = S.blocks.find(b => b.ai === "story" && BR.CAT[b.type].kind === "actor") || S.blocks.find(b => b.ai === "story"); shots = [{ start: 0, end: dur, size: "full", angle: "eye", move: hero && hero.keys.length ? "follow" : "push_in", subject: hero ? hero.id : null, side: "front_left", lens: null, _direct: true }]; }
  for (let i = 0; i < shots.length; i++) { if (i === 0) shots[i].start = 0; if (i < shots.length - 1) shots[i].end = shots[i + 1].start; else shots[i].end = dur; }
  shots = shots.filter(s => s.end - s.start > 0.15);
  BR.compileShots(S, shots, s => s._direct ? byId[s.subject] : resolve(s.subject), s => resolve(s.secondary));
  return S;
};

/* camera compiler, reusable by the app's "Auto camera" button */
BR.compileShots = function (S, shots, subjOf, secOf) {
  const asp = aspectNum(S.aspect);
  const solids = S.blocks.filter(b => BR.CAT[b.type] && BR.CAT[b.type].kind === "building" && !["room", "stage", "cyclorama", "helipad", "fountain", "tent", "market_stall"].includes(b.type)).map(b => ({ ...rect(b), h: b.size[1] + b.pos[1] }));
  S.blocks = S.blocks.filter(b => !b.autoCam);
  S.cuts = [];
  shots.forEach((sh, i) => {
    const subj = subjOf(sh); const sec = secOf ? secOf(sh) : null;
    const size = SIZES.includes(sh.size) ? sh.size : "medium", angle = ANGLES.includes(sh.angle) ? sh.angle : "eye", move = MOVES.includes(sh.move) ? sh.move : "static", side = SIDES.includes(sh.side) ? sh.side : "front";
    const lens = num(sh.lens, 0) > 8 ? num(sh.lens) : SIZE_LENS[size];
    const cam = newBlock("camera", { autoCam: true, ai: "shot", label: `SHOT ${i + 1} ${size.replace(/_/g, " ").toUpperCase()}`.slice(0, 24), notes: `${size.replace(/_/g, " ")} ${move.replace(/_/g, " ")}`, showLabel: false });
    cam.cam = { lens, lookAt: subj && move !== "pov" ? subj.id : null, aim: SIZE_AIM[size] };
    cam.shot = { size, angle, move, side, start: sh.start, end: sh.end, subject: subj ? subj.id : null };
    const sH = subj ? subj.size[1] : 1.75, sL = subj ? Math.max(subj.size[0], subj.size[2]) : 0.5;
    const scale = Math.max(1, Math.max(sH, sL * 0.55) / 1.75);
    const vf = vfovFor(lens, asp) * D2R, baseDist = SIZE_H[size] * scale / (2 * Math.tan(vf / 2)) + sL * 0.3;
    const t0 = sh.start, t1 = sh.end, T = Math.max(0.2, t1 - t0);
    const ease = u => u * u * (3 - 2 * u);
    const subjAt = t => { if (!subj) return { p: [0, 0, 0], yaw: 0 }; const p = poseAt(subj, t); return { p: p.p, yaw: p.r[1] }; };
    const startS = subjAt(t0);
    const camAt = (t) => {
      const u = ease(clamp((t - t0) / T, 0, 1));
      const anchored = ["static", "pan", "handheld"].includes(move);
      const continuous = ["follow", "lead", "side_track", "pov", "over_shoulder"].includes(move);
      const S0 = anchored ? startS : subjAt(t);
      const f = (continuous ? S0.yaw : startS.yaw);
      let a = SIDE_ANG[side], dist = baseDist, aimY = S0.p[1] + sH * SIZE_AIM[size];
      if (move === "follow") a = 180; if (move === "lead") a = 0; if (move === "side_track" && Math.abs(a) < 45) a = 90;
      if (move === "push_in") dist *= 1.35 - 0.55 * u; if (move === "pull_out") dist *= 0.8 + 0.6 * u;
      if (move === "orbit_left") a += 75 * u; if (move === "orbit_right") a -= 75 * u;
      let h = aimY;
      if (angle === "low") h = Math.max(0.3, S0.p[1] + 0.35); if (angle === "high") h = aimY + dist * 0.55; if (angle === "overhead") { h = aimY + dist * 1.1; dist *= 0.05; }
      if (size === "aerial") h = Math.max(h, S0.p[1] + Math.max(25, dist * 0.6));
      if (move === "crane_up") h += -0.8 + 4.5 * u; if (move === "crane_down") h += 3.7 - 4.5 * u;
      const A = (f + a) * D2R;
      let p = [S0.p[0] + Math.sin(A) * dist, h, S0.p[2] + Math.cos(A) * dist];
      if (move === "track_left" || move === "track_right") { const rx = Math.cos(A), rz = -Math.sin(A), k = (move === "track_right" ? 1 : -1) * (u - 0.5) * dist * 0.9; p[0] += rx * k; p[2] += rz * k; }
      let r = [0, 0, angle === "dutch" ? 12 : 0];
      if (move === "pov" && subj) { const fy = S0.yaw * D2R; p = [S0.p[0] + Math.sin(fy) * 0.2, S0.p[1] + sH * 0.93, S0.p[2] + Math.cos(fy) * 0.2]; r = [0, S0.yaw + 180, 0]; }
      if (move === "over_shoulder" && subj && sec) { const sp = poseAt(sec, t).p; const dx = S0.p[0] - sp[0], dz = S0.p[2] - sp[2], dd = Math.hypot(dx, dz) || 1; const ux = dx / dd, uz = dz / dd; p = [sp[0] - ux * 0.9 + uz * 0.38, sp[1] + sec.size[1] * 0.9, sp[2] - uz * 0.9 - ux * 0.38]; }
      if (move === "handheld") { p[0] += Math.sin(t * 1.7) * 0.05 + Math.sin(t * 4.1) * 0.015; p[1] += Math.sin(t * 2.3) * 0.03; p[2] += Math.cos(t * 1.3) * 0.04; r[2] += Math.sin(t * 1.1) * 1.2; }
      // keep the camera out of buildings: slide toward the subject until clear
      for (const s of solids) { if (p[1] > s.h) continue; let n = 0; while (inside(s, p[0], p[2], 0.4) && n++ < 40) { p[0] += (S0.p[0] - p[0]) * 0.08; p[2] += (S0.p[2] - p[2]) * 0.08; } }
      p[1] = Math.max(0.25, p[1]);
      return { p, r };
    };
    const still = ["static", "pan"].includes(move) && (!subj || !subj.keys.length || move === "static");
    const step = still ? T : 0.2;
    for (let t = t0; t <= t1 + 1e-6; t += step) { const c = camAt(Math.min(t, t1)); cam.keys.push({ t: r3(Math.min(t, t1)), p: c.p.map(r3), r: c.r.map(r1), l: lens, e: 0 }); }
    if (cam.keys.length === 1) { cam.pos = cam.keys[0].p; cam.rot = cam.keys[0].r; cam.keys = []; }
    else { cam.pos = cam.keys[0].p.slice(); }
    S.blocks.push(cam);
    S.cuts.push({ t: r3(t0), cam: cam.id });
  });
  S.camId = S.cuts.length ? S.cuts[0].cam : S.camId;
};

/* local fallback video prompt in the filmmaker's format */
BR.localVideoPrompt = function (S) {
  const cast = S.blocks.filter(b => b.ai === "story" && !b.crowdOf);
  const lines = [];
  lines.push(`Follow the attached blocking video exactly for staging, movement, timing and camera. Each coloured block in it is a stand-in for the real subject described here; render real people, vehicles and places, never the blocks, labels or grey floor.`);
  if (cast.length) lines.push(cast.map(b => `The ${BR.util && colorWord(b.color)} ${(BR.CAT[b.type] || {}).name ? BR.CAT[b.type].name.toLowerCase() : "block"} is ${b.notes || b.label.toLowerCase()}.`).join(" "));
  const shots = S.blocks.filter(b => b.shot);
  shots.forEach(c => { const s = c.shot; const sub = S.blocks.find(b => b.id === s.subject); lines.push(`${cap(s.size.replace(/_/g, " "))} shot from a ${s.angle.replace(/_/g, " ")} angle, the camera ${moveWords(s.move)}${sub ? " on " + (sub.notes || sub.label.toLowerCase()) : ""}.`); });
  lines.push(`Aspect ratio ${S.aspect}`);
  return lines.join("\n");
};
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function moveWords(m) { return ({ static: "locked off", pan: "panning to follow", push_in: "slowly pushing in", pull_out: "pulling back", track_left: "tracking left", track_right: "tracking right", follow: "following from behind", lead: "leading ahead", side_track: "tracking alongside", orbit_left: "orbiting left", orbit_right: "orbiting right", crane_up: "craning up", crane_down: "craning down", handheld: "handheld and alive", pov: "seeing through their eyes", over_shoulder: "looking over the shoulder" })[m] || m; }
const COLORS = [["red", "#d6553a"], ["pink", "#c43f86"], ["blue", "#3a5ec4"], ["teal", "#278a83"], ["green", "#3d7a4c"], ["yellow", "#efbf35"], ["orange", "#e5832a"], ["purple", "#7550c0"], ["white", "#f2f2f0"], ["black", "#1b1b1b"], ["grey", "#9aa3ab"], ["brown", "#8a6a44"]];
function colorWord(hex) { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const c = p(hex || "#888888"); let best = "", bd = 1e9; for (const [n, h] of COLORS) { const d = p(h).reduce((s, v, i) => s + (v - c[i]) ** 2, 0); if (d < bd) { bd = d; best = n; } } return best; }
BR.colorWord = colorWord;
})();
