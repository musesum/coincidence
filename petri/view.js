// Petri dish view: canvas dish, controls, panel and legend mounted into one root.
import { BOUNDARIES, WHEN, JOHNSON, THREATS, COPY, COMMUNITIES } from './data.js';
import {
  makeWorld, withThreat, positionsAt, logsFor, classify, webFor,
  stopOf, passes, rssiAt, radiusOf, repairRadii, defaultT, card,
} from './model.js';

const TAU = Math.PI * 2;
const EPOCH_SEC = 6;
const MAX_SIZE = 720;
const HIT_PX = 18;
const RINGS = [[1, '1 m'], [10, '10 m'], [100, '100 m'], [1000, '1 km']];
const FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif';
const CARD_KEYS = [['who', 'Who'], ['what', 'What'], ['when', 'When'], ['where', 'Where'], ['how', 'How'], ['why', 'Why']];
const THREAT_LINES = [['brings', 'Brings'], ['shows', 'Shows'], ['affects', 'Affects'], ['limit', 'Limit'], ['open', 'Open']];
const SVG_NS = 'http://www.w3.org/2000/svg';

// Token name, light fallback, dark fallback; petri.css resolves --pc-* from the page tokens.
const TOKENS = {
  ink: ['--pc-ink', '#1d1d1f', '#f5f5f7'],
  ink2: ['--pc-ink-2', '#6e6e73', '#a1a1a6'],
  line: ['--pc-line', '#d2d2d7', '#2c2f38'],
  dish: ['--pc-dish', '#f2f2f7', '#171a21'],
  ring: ['--pc-ring', 'rgba(110,110,115,.5)', 'rgba(161,161,166,.45)'],
  cohort: ['--pc-cohort', '#d06afa', '#aa32a4'],
  studio: ['--pc-studio', '#2d6fbe', '#497cfd'],
  seed: ['--pc-seed', '#d27830', '#b07a20'],
  ok: ['--pc-ok', '#62c37a', '#249c74'],
  threat: ['--pc-threat', '#a43a41', '#b93d46'],
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') n.textContent = v;
    else if (k === 'class') n.className = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of [].concat(kids)) if (kid) n.append(kid);
  return n;
}

function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

// Legend swatch: a 16 px inline SVG with the given children.
function swatch(...kids) {
  const s = svgEl('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', class: 'petri-sw' });
  for (const k of kids) s.append(k);
  return s;
}

function shapeSvg(kind, cls) {
  if (kind === 'place') return svgEl('rect', { x: 3.5, y: 3.5, width: 9, height: 9, rx: 2.5, class: cls });
  if (kind === 'thing') return svgEl('path', { d: 'M8 2 L14 8 L8 14 L2 8 Z', class: cls });
  return svgEl('circle', { cx: 8, cy: 8, r: 5, class: cls });
}

function threatSvg(id) {
  const c = 'petri-f-threat';
  if (id === 'keys') return [6, 8, 10].map((x, i) => svgEl('circle', { cx: x, cy: 10 - i * 2, r: 3, class: `${c} petri-s-dish` }));
  if (id === 'relay') return [svgEl('path', { d: 'M3.5 11 Q8 1 12.5 11', class: 'petri-l-threat petri-dashed' }), svgEl('path', { d: 'M3.5 8.5 L6 11 L3.5 13.5 L1 11 Z', class: c }), svgEl('path', { d: 'M12.5 8.5 L15 11 L12.5 13.5 L10 11 Z', class: c })];
  if (id === 'account') return [svgEl('path', { d: 'M8 3 A5 5 0 0 0 8 13 Z', class: 'petri-f-cohort' }), svgEl('path', { d: 'M8 3 A5 5 0 0 1 8 13 Z', class: c })];
  if (id === 'forged') return [svgEl('circle', { cx: 8, cy: 8, r: 5, class: 'petri-l-threat' }), svgEl('path', { d: 'M3 13 L13 3', class: 'petri-l-threat' })];
  return [svgEl('circle', { cx: 8, cy: 8, r: 6.5, class: 'petri-l-threat petri-dashed' }), svgEl('circle', { cx: 8, cy: 8, r: 2.5, class: c })];
}

function convexHull(pts) {
  if (pts.length < 3) return pts.slice();
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// Padded hull: hull of a small circle around each point.
function paddedHull(pts, pad) {
  const ring = [];
  for (const [x, y] of pts) for (let k = 0; k < 12; k++) ring.push([x + pad * Math.cos(k * TAU / 12), y + pad * Math.sin(k * TAU / 12)]);
  return convexHull(ring);
}

// Closed path through edge midpoints with vertices as control points.
function smoothPath(g, hull) {
  const n = hull.length;
  if (n < 3) return;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(hull[n - 1], hull[0]);
  g.beginPath();
  g.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const m = mid(hull[i], hull[(i + 1) % n]);
    g.quadraticCurveTo(hull[i][0], hull[i][1], m[0], m[1]);
  }
  g.closePath();
}

function markPath(g, kind, x, y, r) {
  g.beginPath();
  if (kind === 'place') {
    const s = r * 0.9, k = Math.min(2.5, s / 2);
    g.moveTo(x - s + k, y - s);
    g.arcTo(x + s, y - s, x + s, y + s, k);
    g.arcTo(x + s, y + s, x - s, y + s, k);
    g.arcTo(x - s, y + s, x - s, y - s, k);
    g.arcTo(x - s, y - s, x + s, y - s, k);
    g.closePath();
  } else if (kind === 'thing') {
    const s = r * 1.25;
    g.moveTo(x, y - s);
    g.lineTo(x + s, y);
    g.lineTo(x, y + s);
    g.lineTo(x - s, y);
    g.closePath();
  } else {
    g.arc(x, y, r, 0, TAU);
  }
}

export function mountPetri(root, options = {}) {
  const seed = options.seed ?? 7;
  const init = { where: 'earth', when: 'now', johnson: false, t: null, threat: null, ...(options.initial || {}) };
  const controls = options.controls || ['where', 'when', 'johnson', 'threat'];
  const state = { where: init.where, when: init.when, johnson: !!init.johnson, t: init.t, threat: init.threat };

  const probe = document.createElement('canvas').getContext('2d');
  const reduceMq = matchMedia('(prefers-reduced-motion: reduce)');
  const darkMq = matchMedia('(prefers-color-scheme: dark)');
  let colors = {};
  // true between beforeprint and afterprint: the printed page is light
  let printing = false;

  // Resolve any CSS colour to rgba with a scaled alpha.
  function rgba(color, a) {
    probe.fillStyle = '#000';
    probe.fillStyle = color;
    const s = probe.fillStyle;
    if (s[0] === '#') {
      const v = parseInt(s.slice(1), 16);
      return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
    }
    const m = s.match(/[\d.]+/g) || [0, 0, 0];
    return `rgba(${m[0]},${m[1]},${m[2]},${(m[3] === undefined ? 1 : +m[3]) * a})`;
  }

  function readColors() {
    const cs = getComputedStyle(root);
    const dark = darkMq.matches;
    colors = Object.fromEntries(Object.entries(TOKENS).map(([k, [name, light, darkFb]]) => [k, printing ? light : cs.getPropertyValue(name).trim() || (dark ? darkFb : light)]));
  }

  // DOM
  root.classList.add('petri');
  root.textContent = '';
  const canvas = el('canvas', { tabindex: 0, role: 'img' });
  const cardBox = el('div', { class: 'petri-card', hidden: true, 'aria-live': 'polite' });
  const stage = el('div', { class: 'petri-stage' }, [canvas, cardBox]);
  const controlsBox = el('div', { class: 'petri-controls' });
  const panel = el('div', { class: 'petri-panel' });
  const legend = el('ul', { class: 'petri-legend', 'aria-label': 'Legend' });
  root.append(stage, controlsBox, panel, legend);
  const g = canvas.getContext('2d');

  const ui = {};

  function segmented(label, items, current, onPick) {
    const group = el('div', { class: 'petri-seg', role: 'group', 'aria-label': label });
    const buttons = items.map((it) => {
      const b = el('button', { type: 'button', class: 'petri-btn', 'aria-pressed': String(it.id === current), 'data-id': it.id, text: it.label });
      b.addEventListener('click', () => onPick(it.id));
      return b;
    });
    group.append(...buttons);
    group.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      const i = buttons.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const j = clamp(i + step, 0, buttons.length - 1);
      buttons[j].focus();
      onPick(items[j].id);
    });
    return { group, buttons };
  }

  function switchBtn(label, onToggle) {
    const b = el('button', { type: 'button', role: 'switch', class: 'petri-switch', 'aria-checked': 'false' }, [
      el('span', { class: 'petri-track', 'aria-hidden': 'true' }), el('span', { text: label }),
    ]);
    b.addEventListener('click', () => onToggle(b.getAttribute('aria-checked') !== 'true'));
    return b;
  }

  function field(label, body) {
    return el('div', { class: 'petri-field' }, [el('div', { class: 'petri-field-label', text: label }), body]);
  }

  if (controls.includes('where')) {
    ui.where = segmented('Where', BOUNDARIES, state.where, (id) => set({ where: id }));
    ui.where.group.classList.add('petri-ladder');
    controlsBox.append(field('Where', ui.where.group));
  }
  if (controls.includes('when')) {
    ui.when = segmented('When', WHEN, state.when, (id) => set({ when: id }));
    controlsBox.append(field('When', ui.when.group));
  }
  if (controls.includes('johnson')) {
    ui.johnson = switchBtn(JOHNSON.title, (on) => set({ johnson: on }));
    ui.range = el('input', { type: 'range', min: 1, max: 2, step: 1, value: 1, 'aria-label': 'Repair symbols t' });
    ui.rangeOut = el('output', { class: 'petri-num' });
    ui.rangeBox = el('label', { class: 'petri-range', hidden: true }, [el('span', { text: 'Repair symbols t' }), ui.range, ui.rangeOut]);
    ui.range.addEventListener('input', () => set({ t: +ui.range.value }));
    controlsBox.append(el('div', { class: 'petri-field' }, [ui.johnson, ui.rangeBox]));
  }
  if (controls.includes('threat')) {
    ui.threat = switchBtn('Threat mode', (on) => set({ threat: on ? THREATS[0].id : null }));
    ui.threats = segmented('Threat', THREATS, state.threat, (id) => set({ threat: id }));
    ui.threats.group.hidden = true;
    controlsBox.append(el('div', { class: 'petri-field' }, [ui.threat, ui.threats.group]));
  }
  if (!controlsBox.children.length) controlsBox.hidden = true;

  // Panel: each section stacks its variants in one grid cell, so its height is the tallest variant.
  const variantStack = (items, render) => {
    const box = el('div', { class: 'petri-stack' });
    const map = new Map(items.map((it) => {
      const v = el('div', { class: 'petri-variant', 'data-id': it.id }, render(it));
      box.append(v);
      return [it.id, v];
    }));
    return { box, map };
  };
  const wherePanel = variantStack(BOUNDARIES, (b) => [
    el('h3', { class: 'petri-h', text: cap(b.label) }),
    el('p', { class: 'petri-tech' }, [el('span', { text: cap(b.tech) }), el('span', { class: 'petri-tag', text: b.built ? 'built' : 'studied' })]),
    el('p', { text: b.says }),
    el('p', { class: 'petri-not', text: b.not }),
  ]);
  ui.whereSection = el('section', { class: 'petri-sec' }, [
    wherePanel.box,
    el('p', { class: 'petri-not', text: 'The rings at 1 m, 10 m, 100 m and 1 km show true distance: the phone cannot read this.' }),
  ]);
  // the Where section only beside the Where control
  if (controls.includes('where')) panel.append(ui.whereSection);

  ui.liveLine = el('p', { class: 'petri-live petri-num' });
  // the slide text explains the limit; the panel shows its numbers
  ui.johnsonSection = el('section', { class: 'petri-sec', hidden: true }, [
    el('h3', { class: 'petri-h', text: JOHNSON.title }),
    ui.liveLine,
  ]);
  panel.append(ui.johnsonSection);

  const threatPanel = variantStack(THREATS, (t) => [
    el('h3', { class: 'petri-h', text: t.label }),
    el('dl', { class: 'petri-dl' }, THREAT_LINES.flatMap(([k, label]) => [el('dt', { text: label }), el('dd', { text: t[k] })])),
  ]);
  ui.threatSection = el('section', { class: 'petri-sec', hidden: true }, [threatPanel.box]);
  panel.append(ui.threatSection, el('p', { class: 'petri-note', text: COPY.simulated }));

  // Legend
  const legendItem = (svg, text) => el('li', {}, [svg, el('span', { text })]);
  legend.append(
    legendItem(swatch(shapeSvg('person', 'petri-f-ink2')), 'Person'),
    legendItem(swatch(shapeSvg('place', 'petri-f-ink2')), 'Place'),
    legendItem(swatch(shapeSvg('thing', 'petri-f-ink2')), 'Thing'),
    ...COMMUNITIES.filter((c) => c.yours).map((c) => legendItem(swatch(shapeSvg('person', `petri-f-${c.id}`)), cap(c.name))),
    legendItem(swatch(shapeSvg('person', 'petri-f-ink2 petri-faded')), 'Blinded: no shared community'),
    legendItem(swatch(svgEl('circle', { cx: 8, cy: 8, r: 6, class: 'petri-l-ink2 petri-dashed' })), cap(COMMUNITIES.find((c) => !c.yours).name)),
  );
  ui.legendWeb = legendItem(swatch(svgEl('path', { d: 'M2 13 Q4 3 14 4', class: 'petri-l-seed' }), svgEl('circle', { cx: 14, cy: 4, r: 1.6, class: 'petri-f-ink2' })), 'Prior interaction: brighter is more recent, wider is more often');
  ui.legendSame = legendItem(swatch(svgEl('circle', { cx: 8, cy: 8, r: 6, class: 'petri-l-ok' })), cap(JOHNSON.states.same));
  ui.legendList = legendItem(swatch(svgEl('circle', { cx: 8, cy: 8, r: 6, class: 'petri-l-ok petri-dashed' })), cap(JOHNSON.states.list));
  ui.legendApart = legendItem(swatch(shapeSvg('person', 'petri-f-ink2 petri-faint')), cap(JOHNSON.states.apart));
  ui.legendThreat = el('li', {});
  legend.append(ui.legendWeb, ui.legendSame, ui.legendList, ui.legendApart, ui.legendThreat);

  // Model state
  let world, epoch = -1, tSec = 0, epochPos, logs, heard = new Set(), ctxs = new Map(), stops = new Map();
  let cls = new Map(), web = new Map(), order = [], hullSets = {}, sizeRoom = 2;
  let size = 0, dpr = 1, R = 0, cx = 0, cy = 0;
  let screen = new Map();
  let hover = null, tapped = null, keyIndex = -1;
  let raf = 0, last = 0, onScreen = false;
  // true while the made-up log threat, not the switch, turned the Johnson limit on
  let autoJohnson = state.threat === 'forged' && !state.johnson;
  if (autoJohnson) state.johnson = true;

  const unit = (p) => {
    const d = Math.hypot(p.x, p.y);
    if (d === 0) return [0, 0];
    const k = radiusOf(d) / d;
    return [p.x * k, p.y * k];
  };
  const toScreen = (u) => [cx + u[0] * R, cy + u[1] * R];

  function buildWorld() {
    const base = makeWorld(seed);
    world = state.threat ? withThreat(base, state.threat) : base;
    epoch = -1;
    runEpoch(Math.floor(tSec / EPOCH_SEC));
  }

  function runEpoch(e) {
    epoch = e;
    epochPos = positionsAt(world, tSec);
    logs = logsFor(world, epochPos, e);
    heard = logs.get(0) || new Set();
    sizeRoom = heard.size + 1;
    for (const b of world.beacons) {
      const p = epochPos.get(b.id), h = p.apparent || p;
      const d = Math.hypot(h.x, h.y);
      const ctx = { d, heard: heard.has(b.id), rssi: rssiAt(d, b.noiseDb) };
      ctxs.set(b.id, ctx);
      stops.set(b.id, stopOf(ctx, b));
    }
    order = world.beacons.map((b) => b.id).sort((a, b) => ctxs.get(a).d - ctxs.get(b).d);
    keyIndex = tapped === null ? -1 : order.indexOf(tapped);
    derive();
    renderCard();
  }

  // Everything that depends on the epoch plus When, t and Johnson.
  function derive() {
    cls = classify(world, logs, tNow());
    web = new Map(webFor(world, state.when).map((w) => [w.id, w]));
    const shown = (b) => { const p = epochPos.get(b.id); return unit(p.apparent || p); };
    const near = (b) => { const p = epochPos.get(b.id); return Math.hypot(p.x, p.y) <= 40; };
    hullSets = {
      communities: COMMUNITIES.map((c) => ({ c, pts: [...(c.yours ? [[0, 0]] : []), ...world.beacons.filter((b) => b.community === c.id && near(b)).map(shown)] })),
      same: [[0, 0], ...world.beacons.filter((b) => cls.get(b.id)?.state === 'same').map(shown)],
      list: [[0, 0], ...world.beacons.filter((b) => ['same', 'list'].includes(cls.get(b.id)?.state)).map(shown)],
      group: world.beacons.filter((b) => b.threat && (b.threat.id === 'insiders' || b.threat.id === 'history')).map(shown),
    };
    syncUi();
  }

  // from three handles up t stops at s - 2: at s - 1 the room record is one symbol and every log is on the list
  const tMax = () => Math.max(1, sizeRoom - 2);
  function tNow() {
    return clamp(state.t ?? defaultT(sizeRoom), 1, tMax());
  }

  function syncUi() {
    const press = (seg, id) => seg && seg.buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    press(ui.where, state.where);
    press(ui.when, state.when);
    press(ui.threats, state.threat);
    if (ui.johnson) {
      ui.johnson.setAttribute('aria-checked', String(state.johnson));
      ui.rangeBox.hidden = !state.johnson;
      ui.range.max = String(tMax());
      ui.range.value = String(tNow());
      ui.rangeOut.textContent = String(tNow());
    }
    if (ui.threat) {
      ui.threat.setAttribute('aria-checked', String(!!state.threat));
      ui.threats.group.hidden = !state.threat;
    }
    for (const [id, v] of wherePanel.map) v.classList.toggle('is-on', id === state.where);
    for (const [id, v] of threatPanel.map) v.classList.toggle('is-on', id === state.threat);
    ui.johnsonSection.hidden = !state.johnson;
    ui.threatSection.hidden = !state.threat;
    const t = tNow();
    const { unique, johnson } = repairRadii(sizeRoom, t);
    ui.liveLine.textContent = `${sizeRoom} ${sizeRoom === 1 ? 'handle' : 'handles'}, ${t} repair ${t === 1 ? 'symbol' : 'symbols'}: one room up to ${unique} wrong ${unique === 1 ? 'sighting' : 'sightings'}, a short list up to ${johnson}`;

    ui.legendWeb.hidden = state.when === 'now';
    ui.legendSame.hidden = ui.legendList.hidden = ui.legendApart.hidden = !state.johnson;
    ui.legendThreat.hidden = !state.threat;
    if (state.threat) {
      const th = THREATS.find((x) => x.id === state.threat);
      ui.legendThreat.replaceChildren(swatch(...threatSvg(th.id)), el('span', { text: `Threat actor: ${th.label.toLowerCase()}` }));
    }

    const boundary = BOUNDARIES.find((b) => b.id === state.where);
    const passing = world.beacons.filter((b) => passes(stops.get(b.id), state.where)).length;
    const same = [...cls.values()].filter((c) => c.state === 'same').length;
    const th = THREATS.find((x) => x.id === state.threat);
    canvas.setAttribute('aria-label', [
      `Simulated dish around you with ${world.beacons.length} beacons`,
      state.where === 'earth' ? `all ${passing} shown, no Where filter` : `${passing} pass the ${boundary.label} boundary`,
      state.when === 'now' ? 'no prior interactions shown' : `prior interactions within ${state.when}: ${web.size}`,
      state.johnson ? `Johnson limit on, ${same} repair to one room` : 'Johnson limit off',
      th ? `threat: ${th.label.toLowerCase()}` : 'no threat',
    ].join('; ') + '. Arrow keys step through beacons by distance.');
  }

  function set(patch = {}) {
    const threatChanged = 'threat' in patch && patch.threat !== state.threat;
    for (const k of ['where', 'when', 'johnson', 't', 'threat']) if (k in patch) state[k] = patch[k];
    // an explicit johnson in the patch wins over the made-up log rule
    if ('johnson' in patch) autoJohnson = false;
    else if (threatChanged) {
      if (state.threat === 'forged' && !state.johnson) state.johnson = autoJohnson = true;
      else if (state.threat !== 'forged' && autoJohnson) state.johnson = autoJohnson = false;
    }
    if (threatChanged) {
      hover = tapped = null;
      keyIndex = -1;
      buildWorld();
    } else {
      derive();
      renderCard();
    }
    requestDraw();
  }

  // Card
  function renderCard() {
    const id = hover ?? tapped;
    const b = id && world.beacons.find((x) => x.id === id);
    if (!b) {
      cardBox.hidden = true;
      return;
    }
    const a = card(world, b, ctxs.get(b.id));
    cardBox.replaceChildren(el('dl', { class: 'petri-dl' }, CARD_KEYS.flatMap(([k, label]) => [el('dt', { text: label }), el('dd', { text: a[k] })])));
    cardBox.hidden = false;
  }

  function hit(x, y) {
    let best = null, bestD = HIT_PX;
    for (const [id, [sx, sy]] of screen) {
      const d = Math.hypot(sx - x, sy - y);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    // CSS max-width can shrink the canvas below its drawing size
    const k = r.width ? size / r.width : 1;
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
  };
  function onMove(e) {
    if (e.pointerType !== 'mouse') return;
    const id = hit(...local(e));
    if (id !== hover) { hover = id; renderCard(); requestDraw(); }
  }
  function onLeave() {
    if (hover !== null) { hover = null; renderCard(); requestDraw(); }
  }
  function onDown(e) {
    // a tap or a key outranks the beacon the pointer last rested on
    hover = null;
    tapped = hit(...local(e));
    keyIndex = tapped === null ? -1 : order.indexOf(tapped);
    renderCard();
    requestDraw();
  }
  function onKey(e) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (e.key === 'Escape' || step) hover = null;
    if (e.key === 'Escape') { tapped = null; keyIndex = -1; }
    else if (step) {
      e.preventDefault();
      keyIndex = keyIndex < 0 ? (step > 0 ? 0 : order.length - 1) : (keyIndex + step + order.length) % order.length;
      tapped = order[keyIndex];
    } else return;
    renderCard();
    requestDraw();
  }

  // Drawing
  function resize() {
    const w = stage.clientWidth;
    if (!w) return;
    const next = Math.min(MAX_SIZE, Math.floor(w));
    dpr = window.devicePixelRatio || 1;
    if (next === size && canvas.width === Math.round(next * dpr)) return;
    size = next;
    canvas.style.width = canvas.style.height = `${size}px`;
    canvas.width = canvas.height = Math.round(size * dpr);
    cx = cy = size / 2;
    R = size / 2 - 8;
    readColors();
    requestDraw();
  }

  function circle(r) {
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
  }

  function drawBoundaries() {
    for (const b of BOUNDARIES) {
      const on = b.id === state.where;
      // only the current Where line; the Earth rim stays
      if (!on && b.kind !== 'graph') continue;
      const a = on ? 0.75 : 0.16;
      const r = radiusOf(b.d) * R;
      g.save();
      g.strokeStyle = rgba(colors.ink, a);
      g.fillStyle = rgba(colors.ink, a);
      if (b.kind === 'signal') {
        const r0 = radiusOf(b.d / b.fuzz) * R, r1 = radiusOf(b.d * b.fuzz) * R;
        const grad = g.createRadialGradient(cx, cy, r0, cx, cy, r1);
        const peak = (r - r0) / (r1 - r0);
        grad.addColorStop(0, rgba(colors.ink, 0));
        grad.addColorStop(peak, rgba(colors.ink, on ? 0.14 : 0.04));
        grad.addColorStop(1, rgba(colors.ink, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(cx, cy, r1, 0, TAU);
        g.arc(cx, cy, r0, 0, TAU, true);
        g.fill('evenodd');
        g.setLineDash([4, 4]);
        g.lineWidth = on ? 1.5 : 1;
        circle(r);
        g.stroke();
      } else if (b.kind === 'route' || b.kind === 'place') {
        // route: the reach of seven relay hops; place: the 25 km limit on a cast's position
        g.lineWidth = on ? 1.5 : 1;
        circle(r);
        g.stroke();
      } else if (b.kind === 'graph') {
        g.lineWidth = on ? 2 : 1;
        circle(R);
        g.stroke();
      }
      g.restore();
    }
  }

  function drawRings() {
    g.save();
    g.strokeStyle = colors.ring;
    g.lineWidth = 1.5;
    for (const [d] of RINGS) {
      circle(radiusOf(d) * R);
      g.stroke();
    }
    g.restore();
  }

  function drawRingLabels() {
    g.save();
    g.font = `11px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [d, label] of RINGS) {
      const y = cy - radiusOf(d) * R;
      const w = g.measureText(label).width + 8;
      g.fillStyle = colors.dish;
      g.fillRect(cx - w / 2, y - 7, w, 14);
      g.fillStyle = colors.ink2;
      g.fillText(label, cx, y);
    }
    g.restore();
  }

  function hullScreen(pts) {
    return paddedHull(pts.map(toScreen), 9);
  }

  function drawMembranes() {
    // communities step back while the Johnson membranes are shown
    const k = state.johnson ? 0.4 : 1;
    for (const { c, pts } of hullSets.communities) {
      if (!pts.length) continue;
      const h = hullScreen(pts);
      smoothPath(g, h);
      g.save();
      g.lineWidth = 1.5;
      if (c.yours) {
        g.fillStyle = rgba(colors[c.id], 0.1 * k);
        g.fill();
        g.strokeStyle = rgba(colors[c.id], 0.7 * k);
      } else {
        g.setLineDash([5, 4]);
        g.strokeStyle = rgba(colors.ink2, 0.8 * k);
      }
      g.stroke();
      g.restore();
    }
  }

  function drawJohnson() {
    g.save();
    g.lineWidth = 1.5;
    g.strokeStyle = colors.ok;
    smoothPath(g, paddedHull(hullSets.list.map(toScreen), 16));
    g.setLineDash([6, 4]);
    g.stroke();
    smoothPath(g, paddedHull(hullSets.same.map(toScreen), 11));
    g.setLineDash([]);
    g.fillStyle = rgba(colors.ok, 0.08);
    g.fill();
    g.stroke();
    g.restore();
  }

  function curve(x0, y0, x1, y1, bend) {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo(mx - (y1 - y0) * bend, my + (x1 - x0) * bend, x1, y1);
  }

  function beaconAlpha(b) {
    // threat actors stay in full view at every stop
    if (b.threat) return 1;
    const community = COMMUNITIES.find((c) => c.id === b.community);
    let a = community && community.yours ? 1 : 0.45;
    if (b.zone === 'city' || b.zone === 'earth') a = 0.2;
    if (!passes(stops.get(b.id), state.where)) a = Math.min(a, 0.15);
    if (state.johnson && !['same', 'list'].includes(cls.get(b.id)?.state)) a *= 0.4;
    return a;
  }

  function draw() {
    if (!size || !world) return;
    const pos = reduceMq.matches ? epochPos : positionsAt(world, tSec);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);

    // dish and rim
    g.fillStyle = colors.dish;
    circle(R);
    g.fill();
    g.strokeStyle = colors.line;
    g.lineWidth = 1;
    g.stroke();

    drawBoundaries();
    drawRings();
    drawMembranes();
    if (state.johnson) drawJohnson();

    // screen positions; keys on one device are drawn as a stack
    screen = new Map();
    for (const b of world.beacons) {
      const p = pos.get(b.id);
      screen.set(b.id, toScreen(unit(p.apparent || p)));
    }
    const keys = world.beacons.filter((b) => b.threat && b.threat.id === 'keys');
    if (keys.length) {
      const [kx, ky] = keys.map((b) => screen.get(b.id)).reduce((s, q) => [s[0] + q[0] / keys.length, s[1] + q[1] / keys.length], [0, 0]);
      keys.forEach((b, i) => screen.set(b.id, [kx + (i - 2.5) * 3, ky - (i - 2.5) * 3]));
    }

    // prior-interaction web
    if (state.when !== 'now') {
      g.save();
      g.lineCap = 'round';
      for (const [id, w] of web) {
        const b = world.beacons.find((x) => x.id === id);
        const [x, y] = screen.get(id);
        const recency = 1 - Math.log10(1 + w.last) / Math.log10(31);
        g.strokeStyle = rgba(colors.seed, (0.2 + 0.6 * recency) * Math.min(1, beaconAlpha(b) * 2));
        g.lineWidth = 1 + 2 * Math.min(1, (w.n - 1) / 4);
        curve(cx, cy, x, y, 0.18);
        g.stroke();
      }
      g.restore();
    }

    // threat overlays under the marks
    g.save();
    g.strokeStyle = rgba(colors.threat, 0.75);
    g.lineWidth = 1.25;
    for (const b of world.beacons) {
      if (!b.threat || b.threat.role !== 'ghost') continue;
      const p = pos.get(b.id), [tx, ty] = toScreen(unit(p)), [ax, ay] = screen.get(b.id);
      g.setLineDash([4, 4]);
      curve(tx, ty, ax, ay, 0.12);
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.arc(tx, ty, 3, 0, TAU);
      g.stroke();
    }
    if (hullSets.group.length) {
      const members = world.beacons.filter((b) => b.threat && (b.threat.id === 'insiders' || b.threat.id === 'history'));
      if (state.threat === 'history') {
        g.strokeStyle = rgba(colors.threat, 0.5);
        for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
          const [x0, y0] = screen.get(members[i].id), [x1, y1] = screen.get(members[j].id);
          curve(x0, y0, x1, y1, 0.25);
          g.stroke();
        }
      }
      g.strokeStyle = rgba(colors.threat, 0.85);
      g.setLineDash([4, 3]);
      smoothPath(g, paddedHull(members.map((b) => screen.get(b.id)), 14));
      g.stroke();
    }
    g.restore();

    // beacons: blinded first, then yours, then threat actors
    const rank = (b) => (b.threat ? 2 : COMMUNITIES.find((c) => c.id === b.community)?.yours ? 1 : 0);
    const sorted = world.beacons.slice().sort((a, b) => rank(a) - rank(b));
    for (const b of sorted) {
      const [x, y] = screen.get(b.id);
      const community = COMMUNITIES.find((c) => c.id === b.community);
      const yours = community && community.yours;
      const a = beaconAlpha(b);
      const r = b.threat && b.threat.id === 'keys' ? 4 : 5;
      g.save();
      g.globalAlpha = a;
      if (web.has(b.id) && state.when !== 'now') {
        g.strokeStyle = colors.ink2;
        g.lineWidth = 1;
        markPath(g, b.kind, x, y, r + 4);
        g.stroke();
      }
      if (b.threat || yours) {
        g.fillStyle = colors.dish;
        markPath(g, b.kind, x, y, r + 2);
        g.fill();
      }
      const role = b.threat && b.threat.role;
      if (role === 'forger') {
        g.strokeStyle = colors.threat;
        g.lineWidth = 1.75;
        markPath(g, 'person', x, y, r);
        g.stroke();
        g.beginPath();
        g.moveTo(x - r - 2, y + r + 2);
        g.lineTo(x + r + 2, y - r - 2);
        g.stroke();
      } else if (role === 'taken') {
        g.fillStyle = colors[b.community] || colors.ink2;
        g.beginPath();
        g.arc(x, y, r, Math.PI / 2, Math.PI * 1.5);
        g.fill();
        g.fillStyle = colors.threat;
        g.beginPath();
        g.arc(x, y, r, -Math.PI / 2, Math.PI / 2);
        g.fill();
        g.strokeStyle = colors.threat;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, y, r + 4, 0, TAU);
        g.stroke();
      } else {
        g.fillStyle = b.threat ? colors.threat : yours ? colors[b.community] : colors.ink2;
        markPath(g, b.kind, x, y, r);
        g.fill();
      }
      g.restore();
    }

    // focus ring on the selected beacon
    const sel = hover ?? tapped;
    if (sel !== null && screen.has(sel)) {
      const [x, y] = screen.get(sel);
      g.save();
      g.strokeStyle = colors.ink;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, 10, 0, TAU);
      g.stroke();
      g.restore();
    }

    drawRingLabels();

    // you
    g.save();
    g.fillStyle = colors.dish;
    g.beginPath();
    g.arc(cx, cy, 9, 0, TAU);
    g.fill();
    g.fillStyle = colors.ink;
    g.beginPath();
    g.arc(cx, cy, 7, 0, TAU);
    g.fill();
    g.font = `12px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText(COPY.you, cx, cy + 12);
    g.restore();
  }

  // Animation
  const running = () => !reduceMq.matches && onScreen && document.visibilityState === 'visible';

  function frame(now) {
    // moving between screens changes DPR without a resize; runs while raf is set so no second loop starts
    if ((window.devicePixelRatio || 1) !== dpr) resize();
    raf = 0;
    if (!running()) return;
    tSec += Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    const e = Math.floor(tSec / EPOCH_SEC);
    if (e !== epoch) runEpoch(e);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function requestDraw() {
    if (running()) {
      if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
    } else {
      draw();
    }
  }

  function onMotionChange() {
    if (reduceMq.matches) {
      tSec = 0;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      runEpoch(0);
    }
    requestDraw();
  }
  function onSchemeChange() {
    readColors();
    requestDraw();
  }
  function onVisibility() {
    requestDraw();
  }
  // the canvas is a bitmap: redraw it in the light tokens before the page is printed
  function onBeforePrint() {
    printing = true;
    readColors();
    draw();
  }
  function onAfterPrint() {
    printing = false;
    readColors();
    requestDraw();
  }

  const io = new IntersectionObserver((entries) => {
    onScreen = entries.some((x) => x.isIntersecting);
    requestDraw();
  });
  const ro = new ResizeObserver(resize);

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('keydown', onKey);
  reduceMq.addEventListener('change', onMotionChange);
  darkMq.addEventListener('change', onSchemeChange);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('beforeprint', onBeforePrint);
  window.addEventListener('afterprint', onAfterPrint);

  readColors();
  buildWorld();
  io.observe(canvas);
  ro.observe(stage);
  resize();

  return {
    set,
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      io.disconnect();
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('keydown', onKey);
      reduceMq.removeEventListener('change', onMotionChange);
      darkMq.removeEventListener('change', onSchemeChange);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
      root.textContent = '';
      root.classList.remove('petri');
    },
  };
}
