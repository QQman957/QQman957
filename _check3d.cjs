// Headless harness for 屎马桶炮 3D.
// Loads the REAL three.js (only WebGLRenderer is stubbed, since there is no GL context),
// so Vector3 math, raycasting, geometry and the scene graph are all genuinely exercised.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = __dirname;
const threeSrc = fs.readFileSync(path.join(dir, 'three.min.js'), 'utf8');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const gameSrc = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

/* ---------- minimal DOM ---------- */
function makeEl(id) {
  const el = {
    id, style: {}, children: [], _cls: new Set(), _listeners: {},
    _html: '', textContent: '',
    get innerHTML() { return el._html; },
    set innerHTML(v) { el._html = v; if (v === '') el.children.length = 0; },
    classList: {
      toggle(c, on) { on ? el._cls.add(c) : el._cls.delete(c); },
      add(c) { el._cls.add(c); }, remove(c) { el._cls.delete(c); },
      contains(c) { return el._cls.has(c); },
    },
    addEventListener(t, fn) { (el._listeners[t] = el._listeners[t] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { el.children.push(c); return c; },
    click() { (el._listeners.click || []).forEach(f => f({ preventDefault() {} })); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 800 }; },
    clientWidth: 1280, clientHeight: 800,
    getContext() { return makeCtx(el); },
    width: 300, height: 150,
    querySelector() { return null; },
    setAttribute() {}, focus() {},
  };
  return el;
}
function makeGrad() { return { addColorStop() {} }; }
function makeCtx(canvas) {
  const base = {
    canvas,
    createLinearGradient: makeGrad, createRadialGradient: makeGrad,
    measureText: t => ({ width: String(t).length * 8 }),
    fillRect() {}, fillText() {}, clearRect() {}, strokeRect() {}, beginPath() {},
    moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, closePath() {}, fill() {}, stroke() {},
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, drawImage() {},
    setTransform() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData() {}, createPattern: () => null, clip() {}, bezierCurveTo() {}, arcTo() {},
  };
  return new Proxy(base, {
    get(t, k) { if (typeof k === 'symbol') return undefined; if (k in t) return t[k]; t[k] = () => {}; return t[k]; },
    set(t, k, v) { t[k] = v; return true; },
  });
}

const els = {};
const IDS = ['gl', 'hud', 'menu', 'select', 'clear', 'fail', 'err',
  'hLv', 'hGoal', 'hGbar', 'hScore', 'hTbar', 'hTval', 'hCombo', 'hWind', 'hPower', 'hPlabel', 'hPbar', 'hCross',
  'grid', 'menuStars', 'cLevel', 'cStars', 'cStat', 'cTotal', 'fLevel', 'fGoal', 'fStat', 'fTip',
  'btnStart', 'btnBack', 'btnNext', 'btnReplay', 'btnSelect', 'btnRetry', 'btnSelect2'];
IDS.forEach(i => els[i] = makeEl(i));

const winListeners = {};
const win = {
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
  removeEventListener() {},
  AudioContext: undefined, webkitAudioContext: undefined,
};
const store = {};
// Virtual clock: the game uses THREE.Clock -> performance.now(), so drive it from our timestep.
let vnow = 0;
const fakePerf = { now: () => vnow };

const sandbox = {
  window: win, self: win, globalThis: undefined,
  document: {
    getElementById: id => els[id] || makeEl(id),
    createElement: () => makeEl('tmp'),
    createElementNS: () => makeEl('tmp'),
    addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
    querySelector: () => null,
    body: makeEl('body'),
  },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  performance: fakePerf, console, navigator: { userAgent: 'node' },
  requestAnimationFrame(cb) { sandbox.__raf = cb; return 1; },
  cancelAnimationFrame() {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  Math, JSON, Date, Object, Array, String, Number, Boolean, Error, isNaN, parseInt, parseFloat,
  Float32Array, Uint16Array, Uint32Array, Int32Array, Uint8Array, Uint8ClampedArray, ArrayBuffer,
  Map, Set, WeakMap, WeakSet, Proxy, Reflect, Symbol, RegExp, Function, Promise, Infinity, NaN,
};
sandbox.globalThis = sandbox;
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);

const errors = [];
try { vm.runInContext(threeSrc, sandbox); }
catch (e) { errors.push('THREE LOAD: ' + e.message); }

const THREE = sandbox.THREE;
const realRenderer = THREE.WebGLRenderer;
// Stub only the GL renderer.
THREE.WebGLRenderer = function (opts) {
  this.domElement = opts && opts.canvas ? opts.canvas : makeEl('gl');
  this.shadowMap = { enabled: false, type: null };
  this.setPixelRatio = () => {};
  this.setSize = () => {};
  this.render = () => {};
  this.dispose = () => {};
  this.outputColorSpace = '';
  this.toneMapping = 0;
  this.toneMappingExposure = 1;
  this.capabilities = { isWebGL2: true };
  this.info = { render: {}, memory: {} };
};

try { vm.runInContext(gameSrc, sandbox, { filename: 'game.js' }); }
catch (e) { errors.push('GAME LOAD: ' + e.stack); }

/* ---------- driver ---------- */
let t = 0;
function step(ms) {
  t += ms;
  vnow = t;
  const cb = sandbox.__raf; sandbox.__raf = null;
  if (!cb) { errors.push('no rAF pending'); return false; }
  try { cb(t); } catch (e) { errors.push('FRAME@' + Math.round(t) + ': ' + e.stack); return false; }
  return true;
}
const PT = () => sandbox.window.__PT;
const report = [];
const check = (n, c, x) => report.push([n, !!c, x === undefined ? '' : x]);

if (!PT()) {
  console.log('game failed to initialise');
  errors.forEach(e => console.log(' !! ' + e.split('\n').slice(0, 6).join('\n    ')));
  process.exit(1);
}

step(16); step(16); step(16);
check('three.js loaded', typeof realRenderer === 'function', 'r' + THREE.REVISION);
check('game booted', PT().scene() === 'menu', PT().scene());

// three.js objects really exist
const room = PT().room();
check('room is 3D volume', room.RX > 0 && room.RY > 0 && room.RZ1 > room.RZ0,
  `x±${room.RX} y0-${room.RY} z${room.RZ0}..${room.RZ1}`);

// menu -> select -> level 1
els.btnStart.click(); step(16);
check('menu -> select', PT().scene() === 'select', PT().scene());
check('8 level cards built', els.grid.children.length === 8, els.grid.children.length);
check('locked card has no handler', (els.grid.children[2]._listeners.click || []).length === 0);
els.grid.children[0].click(); step(16);
check('level 1 started', PT().scene() === 'playing' && PT().level() === 0, PT().scene());

// ---- 3D ballistics: fire along -Z and verify it really moves in 3D and falls ----
PT().start(0);
step(16);
PT().shoot(0, 0, -1, 0.4);
const m = PT().muzzle();
for (let i = 0; i < 8; i++) step(16);
const p1 = PT().projPos()[0];
check('projectile alive in 3D', !!p1, JSON.stringify(p1));
if (p1) {
  check('travels along -Z', p1.z < m.z - 0.3, `z ${m.z} -> ${p1.z.toFixed(3)}`);
  check('falls under gravity', p1.y < m.y, `y ${m.y} -> ${p1.y.toFixed(3)}`);
  check('no lateral drift', Math.abs(p1.x) < 0.02, 'x=' + p1.x);
}

// ---- 3D sphere-sphere collision: sweep launch angles, require at least one hit.
//      (flies are clamped to y>=0.75, so the shot must arc up to reach one)
let hitAngle = null;
for (let deg = 8; deg <= 55 && hitAngle === null; deg += 3) {
  PT().start(0); step(16);
  const before = PT().hits();
  PT().addFly(0, 0.85, 0.7);
  const a = deg * Math.PI / 180;
  PT().shoot(0, Math.sin(a), -Math.cos(a), 0.55);
  for (let i = 0; i < 70; i++) {
    step(16);
    if (PT().hits() > before) { hitAngle = deg; break; }
  }
}
check('3D sphere-sphere hit registered', hitAngle !== null, hitAngle === null ? 'no angle hit' : hitAngle + ' deg');

// ---- a shot aimed well away must NOT register ----
PT().start(0); step(16);
const b2 = PT().hits();
PT().addFly(1.9, 2.3, -1.4);
PT().shoot(0, 0.05, -1, 0.3);
for (let i = 0; i < 120; i++) step(16);
check('off-axis shot misses', PT().hits() === b2, 'hits=' + PT().hits());

// ---- floor splat creates a decal ----
PT().start(0); step(16);
const s0 = PT().splats();
PT().shoot(0, 0.55, -1, 0.9);
for (let i = 0; i < 200 && PT().splats() === s0; i++) step(16);
check('floor splat decal added', PT().splats() > s0, s0 + ' -> ' + PT().splats());

// ---- play level 1 to completion with real mouse aiming ----
PT().start(0); step(16);
const glEl = els.gl;
function mouse(x, y, type) {
  (glEl._listeners[type] || []).forEach(f => f({ clientX: x, clientY: y, preventDefault() {} }));
}
let frames = 0;
while (PT().scene() === 'playing' && frames < 6000) {
  if (frames % 22 === 0) {
    const a = -Math.PI + 0.3 + ((frames / 22) % 40) / 40 * (Math.PI - 0.6);
    mouse(640 + Math.cos(a) * 420, 400 + Math.sin(a) * 320, 'pointermove');
    mouse(640 + Math.cos(a) * 420, 400 + Math.sin(a) * 320, 'pointerdown');
  }
  if (frames % 22 === 13) mouse(640, 400, 'pointerup');
  step(16); frames++;
}
const endScene = PT().scene();
check('level 1 resolves', endScene === 'clear' || endScene === 'fail', endScene);
check('level 1 cleared by mouse aiming', endScene === 'clear',
  `hits=${PT().hits()}/${PT().goal().need} shots=${PT().shots()}`);
check('stars awarded', PT().stars()[0] >= 1, JSON.stringify(PT().stars()));
check('progress saved', !!store['poopToilet3DStars'], store['poopToilet3DStars']);

// next level + Esc
if (endScene === 'clear') {
  els.btnNext.click(); step(16);
  check('next level starts', PT().scene() === 'playing' && PT().level() === 1, PT().scene() + '/' + PT().level());
  (winListeners.keydown || []).forEach(f => f({ code: 'Escape', key: 'Escape', preventDefault() {} }));
  step(16);
  check('Esc -> select', PT().scene() === 'select', PT().scene());
}

// all levels start + hazards
const info = [];
for (let i = 0; i < PT().levelCount; i++) {
  PT().start(i); step(16); step(16);
  info.push({ i: i + 1, sc: PT().scene(), haz: PT().hazards(), t: Math.round(PT().time()) });
}
check('all levels start', info.every(l => l.sc === 'playing'), info.map(l => l.sc).join(','));
check('L6 has 2 hazards', info[5].haz === 2, info[5].haz);
check('L8 has 3 hazards', info[7].haz === 3, info[7].haz);

// fail path
PT().start(7);
let ff = 0;
while (PT().scene() === 'playing' && ff < 7000) { step(16); ff++; }
check('fail path', PT().scene() === 'fail', PT().scene());

/* ---------- report ---------- */
console.log('--- 屎马桶炮 3D (real three.js) headless run ---');
let bad = 0;
for (const [n, ok, x] of report) { if (!ok) bad++; console.log((ok ? ' PASS  ' : ' FAIL  ') + n.padEnd(30) + (x ? '  {' + x + '}' : '')); }
console.log('\nlevels:', JSON.stringify(info));
console.log('frames:', Math.round(t / 16), ' errors:', errors.length);
errors.slice(0, 6).forEach(e => console.log('  !! ' + e.split('\n').slice(0, 5).join('\n     ')));
console.log('\nRESULT:', (bad === 0 && errors.length === 0) ? 'PASS' : `FAIL (${bad} checks, ${errors.length} errors)`);
process.exit((bad === 0 && errors.length === 0) ? 0 : 1);
