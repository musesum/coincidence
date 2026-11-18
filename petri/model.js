// Petri dish model: a deterministic simulated gathering seen from one phone. Pure, no DOM.
import { COMMUNITIES, BOUNDARIES } from './data.js';

const TAU = Math.PI * 2;

export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer hash of a list of integers, used to seed per-pair and per-beacon streams.
function mix(...xs) {
  let h = 0x9e3779b9;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

export const ANCHORS = [[0.04, 0.10], [1, 0.30], [3, 0.42], [10, 0.56], [30, 0.68], [100, 0.80], [1000, 0.89], [10000, 0.935], [1e7, 0.985]];

export function radiusOf(d) {
  if (d <= 0) return 0;
  if (d < ANCHORS[0][0]) return ANCHORS[0][1] * d / ANCHORS[0][0];
  const last = ANCHORS[ANCHORS.length - 1];
  if (d >= last[0]) return last[1];
  for (let i = 1; i < ANCHORS.length; i++) {
    const [d1, r1] = ANCHORS[i];
    if (d < d1) {
      const [d0, r0] = ANCHORS[i - 1];
      return r0 + (r1 - r0) * (Math.log10(d) - Math.log10(d0)) / (Math.log10(d1) - Math.log10(d0));
    }
  }
  return last[1];
}

export function distanceOf(r) {
  if (r <= 0) return 0;
  if (r < ANCHORS[0][1]) return ANCHORS[0][0] * r / ANCHORS[0][1];
  const last = ANCHORS[ANCHORS.length - 1];
  if (r >= last[1]) return last[0];
  for (let i = 1; i < ANCHORS.length; i++) {
    const [d1, r1] = ANCHORS[i];
    if (r < r1) {
      const [d0, r0] = ANCHORS[i - 1];
      const l0 = Math.log10(d0);
      return 10 ** (l0 + (Math.log10(d1) - l0) * (r - r0) / (r1 - r0));
    }
  }
  return last[0];
}

export function repairRadii(s, t) {
  // clamp keeps s < 2 finite
  const johnsonExact = s - Math.sqrt(Math.max(0, s * (s - t - 1)));
  return { unique: Math.floor(t / 2), johnsonExact, johnson: Math.ceil(johnsonExact) - 1 };
}

// Default repair budget for a room record of s handles: two thirds, as in 15 handles and 10 symbols.
export function defaultT(s) {
  return Math.max(1, Math.min(s - 1, Math.round(2 * s / 3)));
}

// The app's Where thresholds (docs/poc/app-v3-where-gps.md).
export const ROOM_DBM = -80;
export const CITY_M = 25000;

export function rssiAt(d, noiseDb) {
  return -51.3 - 28.7 * Math.log10(Math.max(d, 0.1)) + noiseDb;
}

export function hearProb(d) {
  if (d <= 10) return 1;
  if (d >= 40) return 0;
  return (40 - d) / 30;
}

const MET_DAYS = [0.05, 0.3, 1, 2, 5, 9, 20];

function gaussian(r) {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(TAU * r());
}

function logUniform(r, lo, hi) {
  return lo * (hi / lo) ** r();
}

function communityDraw(r) {
  const u = r();
  if (u < 0.34) return 'cohort';
  if (u < 0.56) return 'studio';
  if (u < 0.72) return 'market';
  return null;
}

// Bearing of each community's cluster in the room, radians; the rest stand anywhere.
const BEARING = { cohort: 2.5, studio: -0.64, market: 1.05 };

function bearingDraw(r, community) {
  const mid = BEARING[community];
  return mid === undefined ? TAU * r() : mid + 0.42 * gaussian(r);
}

function handleOf(r) {
  return Math.floor(r() * 0x10000).toString(16).padStart(4, '0');
}

function metFor(r, community) {
  if (community === 'cohort' || community === 'studio') {
    const n = Math.floor(r() * 6);
    const met = [];
    for (let i = 0; i < n; i++) {
      const u = r();
      const how = u < 0.7 ? 'exchange' : u < 0.85 ? 'touch' : 'measured';
      // touch entries skip the most recent slot: only the two seeded taps are this hour
      const pool = how === 'touch' ? MET_DAYS.slice(1) : MET_DAYS;
      met.push({ daysAgo: pool[Math.floor(r() * pool.length)], how });
    }
    return met;
  }
  if (r() < 0.1) return [{ daysAgo: MET_DAYS[Math.floor(r() * MET_DAYS.length)], how: 'hop' }];
  return [];
}

export function makeWorld(seed = 7) {
  const r = prng(mix(seed, 1));
  const beacons = [];
  const add = (kind, zone, d, angle, community) => {
    const handle = handleOf(r);
    const noiseDb = Math.max(-16.5, Math.min(16.5, 8 * gaussian(r)));
    // the retired ranging draw: keeps every seeded world unchanged
    if (zone === 'room') r();
    const b = {
      id: beacons.length + 1, kind, zone,
      ax: d * Math.cos(angle), ay: d * Math.sin(angle),
      community, handle, noiseDb,
      met: metFor(r, community),
      traveller: null,
    };
    beacons.push(b);
    return b;
  };
  const near = (d) => d * (0.9 + 0.2 * r());

  const person = (lo, hi) => {
    const community = communityDraw(r);
    return add('person', 'room', logUniform(r, lo, hi), bearingDraw(r, community), community);
  };
  for (let i = 0; i < 30; i++) person(0.8, 10);
  for (let i = 0; i < 14; i++) person(10, 38);
  add('place', 'room', near(4), TAU * r(), 'cohort');
  add('place', 'room', near(18), TAU * r(), 'cohort');
  add('thing', 'room', near(2), TAU * r(), 'studio');
  add('thing', 'room', near(35), TAU * r(), null);

  const GX = 95, GY = -70;
  for (let i = 0; i < 6; i++) {
    const rr = 12 * Math.sqrt(r()), a = TAU * r();
    const x = GX + rr * Math.cos(a), y = GY + rr * Math.sin(a);
    add('person', 'venue', Math.hypot(x, y), Math.atan2(y, x), 'studio');
  }
  for (let i = 0; i < 8; i++) add('person', 'venue', logUniform(r, 40, 600), TAU * r(), communityDraw(r));
  for (let i = 0; i < 6; i++) add('person', 'city', logUniform(r, 1500, 8000), TAU * r(), communityDraw(r));

  // travellers: two studio and two unaffiliated room people commute to the second gathering
  const roomPeople = beacons.filter((b) => b.zone === 'room' && b.kind === 'person');
  const pick = (community) => {
    const found = roomPeople.filter((b) => b.community === community && !b.traveller).slice(0, 2);
    for (const b of roomPeople) {
      if (found.length >= 2) break;
      if (b.community === 'market' && !b.traveller && !found.includes(b)) {
        b.community = community;
        found.push(b);
      }
    }
    return found;
  };
  [...pick('studio'), ...pick(null)].forEach((b, i) => {
    const rr = 8 * Math.sqrt(r()), a = TAU * r();
    b.traveller = { bx: GX + rr * Math.cos(a), by: GY + rr * Math.sin(a), period: 48, phase: i * TAU / 4 };
  });

  // you tapped phones this hour with the two nearest members who stay in the room
  beacons.filter((b) => b.kind === 'person' && !b.traveller && (b.community === 'cohort' || b.community === 'studio'))
    .sort((a, b) => Math.hypot(a.ax, a.ay) - Math.hypot(b.ax, b.ay)).slice(0, 2)
    .forEach((b) => b.met.push({ daysAgo: 0.02, how: 'touch' }));

  // people elsewhere on Earth, past the 25 km city limit; drawn last so the room stays as seeded
  for (let i = 0; i < 6; i++) add('person', 'earth', logUniform(r, 30000, 9000000), TAU * r(), communityDraw(r));

  return { seed, you: { id: 0, kind: 'person', ax: 0, ay: 0 }, beacons, communities: COMMUNITIES };
}

// Drift phase key: colocated threat groups move together.
function driftKey(b) {
  const t = b.threat;
  if (t && (t.id === 'keys' || t.id === 'insiders' || t.id === 'history')) return 100000 + t.id.length;
  return b.id;
}

function drift(seed, key, ax, ay, cap, tSec) {
  const r = prng(mix(seed, 2, key));
  const p1 = TAU * r(), p2 = TAU * r(), p3 = TAU * r(), p4 = TAU * r();
  const w1 = TAU / (20 + 20 * r()), w2 = TAU / (7 + 9 * r());
  const amp = Math.min(0.06 * Math.hypot(ax, ay), cap);
  return {
    x: ax + amp * (0.6 * Math.sin(w1 * tSec + p1) + 0.4 * Math.sin(w2 * tSec + p2)),
    y: ay + amp * (0.6 * Math.sin(w1 * tSec + p3) + 0.4 * Math.sin(w2 * tSec + p4)),
  };
}

export function positionsAt(world, tSec) {
  const pos = new Map([[0, { x: 0, y: 0 }]]);
  for (const b of world.beacons) {
    const cap = b.zone === 'room' ? 1.5 : 15;
    if (b.traveller) {
      const { bx, by, period, phase } = b.traveller;
      const u = 0.5 + 0.5 * Math.sin(TAU * tSec / period + phase);
      const k = u * u * (3 - 2 * u);
      pos.set(b.id, { x: b.ax + (bx - b.ax) * k, y: b.ay + (by - b.ay) * k });
      continue;
    }
    const p = drift(world.seed, driftKey(b), b.ax, b.ay, cap, tSec);
    if (b.apparent) p.apparent = drift(world.seed, driftKey(b), b.apparent.ax, b.apparent.ay, 1.5, tSec);
    pos.set(b.id, p);
  }
  return pos;
}

function heardAt(p) {
  return p.apparent || p;
}

export function logsFor(world, pos, epoch) {
  // a forger has no radio: nobody hears it, its log is the forged list
  const bodies = [world.you, ...world.beacons.filter((b) => !b.forgedLog)];
  const logs = new Map(bodies.map((b) => [b.id, new Set()]));
  // beacons that share one device share one radio
  const radio = new Map();
  let deviceRadio = null;
  for (const b of bodies) {
    if (b.sameDevice) deviceRadio = deviceRadio ?? b.id;
    radio.set(b.id, b.sameDevice ? deviceRadio : b.id);
  }
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i], pa = heardAt(pos.get(a.id));
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j], pb = heardAt(pos.get(b.id));
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      const p = hearProb(d);
      if (p <= 0) continue;
      const ra = radio.get(a.id), rb = radio.get(b.id);
      const heard = ra === rb || prng(mix(world.seed, 3, epoch, Math.min(ra, rb), Math.max(ra, rb)))() < p;
      if (heard) {
        logs.get(a.id).add(b.id);
        logs.get(b.id).add(a.id);
      }
    }
  }
  for (const b of world.beacons) if (b.forgedLog) logs.set(b.id, new Set(b.forgedLog));
  return logs;
}

// Sightings in one log and not the other, counted on the larger side: swaps once, a short or padded log in full.
export function wrongPoints(a, b) {
  let onlyA = 0, onlyB = 0;
  for (const x of a) if (!b.has(x)) onlyA++;
  for (const x of b) if (!a.has(x)) onlyB++;
  return Math.max(onlyA, onlyB);
}

export function classify(world, logs, t) {
  const yours = new Set(logs.get(0));
  yours.add(0);
  const s = yours.size;
  const tt = Math.max(1, Math.min(s - 1, t ?? defaultT(s)));
  const { unique, johnson } = repairRadii(s, tt);
  const out = new Map();
  for (const b of world.beacons) {
    const log = logs.get(b.id);
    if (!log || log.size === 0) continue;
    const mine = new Set(log);
    mine.add(b.id);
    const wrong = wrongPoints(mine, yours);
    out.set(b.id, { wrong, state: wrong <= unique ? 'same' : wrong <= johnson ? 'list' : 'apart' });
  }
  return out;
}

// Hops for a beacon you did not hear directly: a neighbour relays it, so at least 2.
export function hopsOf(b, d) {
  const h = Math.max(2, Math.ceil(d / 30));
  return h <= 7 ? h : 0;
}

export const STOPS = BOUNDARIES.map((x) => x.id);

// As in the app at When now: a live record carries your own phone's position, so only the radio counts.
// A relay ghost is heard at the spot it appears at (ctx.d is the apparent distance).
export function stopOf(ctx, b) {
  const { d, heard, rssi } = ctx;
  if (heard) return rssi >= ROOM_DBM ? 'room' : 'building';
  if (hopsOf(b, d)) return 'building';
  // no live record: a cast posted within 25 km counts at city
  return d <= CITY_M ? 'city' : 'earth';
}

export function passes(stop, selected) {
  return STOPS.indexOf(stop) <= STOPS.indexOf(selected);
}

const WINDOW_DAYS = { now: 0.007, hours: 0.3, days: 3, weeks: 30 };

export function webFor(world, when) {
  const limit = WINDOW_DAYS[when];
  const out = [];
  for (const b of world.beacons) {
    const inside = b.met.filter((m) => m.daysAgo <= limit);
    if (inside.length) out.push({ id: b.id, n: inside.length, last: Math.min(...inside.map((m) => m.daysAgo)) });
  }
  return out;
}

function cloneWorld(world) {
  return {
    ...world,
    you: { ...world.you },
    beacons: world.beacons.map((b) => ({
      ...b,
      met: b.met.map((m) => ({ ...m })),
      traveller: b.traveller && { ...b.traveller },
      ...(b.apparent && { apparent: { ...b.apparent } }),
      ...(b.threat && { threat: { ...b.threat } }),
      ...(b.forgedLog && { forgedLog: new Set(b.forgedLog) }),
    })),
  };
}

export function withThreat(world, id) {
  const w = cloneWorld(world);
  const r = prng(mix(world.seed, 4, id.length, id.charCodeAt(0)));
  let next = Math.max(0, ...w.beacons.map((b) => b.id)) + 1;
  const polar = (d, a) => [d * Math.cos(a), d * Math.sin(a)];
  const around = (x, y, radius) => {
    const rr = radius * Math.sqrt(r()), a = TAU * r();
    return [x + rr * Math.cos(a), y + rr * Math.sin(a)];
  };
  const add = (kind, zone, [ax, ay], role, extra = {}) => {
    const b = {
      id: next++, kind, zone, ax, ay, community: null, handle: handleOf(r),
      noiseDb: Math.max(-16.5, Math.min(16.5, 8 * gaussian(r))),
      met: [], traveller: null, threat: { id, role }, ...extra,
    };
    w.beacons.push(b);
    return b;
  };

  if (id === 'keys') {
    const [cx, cy] = polar(5.5, TAU * r());
    for (let i = 0; i < 6; i++) add('person', 'room', around(cx, cy, 0.1), 'key', { sameDevice: true });
  } else if (id === 'relay') {
    const near = polar(5 * (0.9 + 0.2 * r()), TAU * r());
    const far = polar(3000 * (0.9 + 0.2 * r()), TAU * r());
    add('thing', 'room', near, 'endpoint');
    add('thing', 'city', far, 'endpoint-far');
    for (let i = 0; i < 3; i++) {
      const [px, py] = around(near[0], near[1], 2);
      add('person', 'city', around(far[0], far[1], 30), 'ghost', { apparent: { ax: px, ay: py } });
    }
  } else if (id === 'account') {
    const members = w.beacons.filter((b) => b.community === 'cohort' && !b.threat);
    const target = members.find((b) => b.met.length >= 3)
      || members.reduce((best, b) => (b.met.length > best.met.length ? b : best), members[0]);
    if (target) target.threat = { id: 'account', role: 'taken' };
  } else if (id === 'insiders' || id === 'history') {
    const [cx, cy] = polar(7, TAU * r());
    for (let i = 0; i < 4; i++) {
      const met = id === 'history'
        ? Array.from({ length: 6 }, (_, k) => ({ daysAgo: 0.5 + k * 3.9, how: 'exchange' }))
        : [];
      add('person', 'room', around(cx, cy, 0.75), id === 'history' ? 'history' : 'insider', { met });
    }
  } else if (id === 'forged') {
    const yours = [...(logsFor(world, positionsAt(world, 0), 0).get(0) || [])];
    const outside = world.beacons.filter((b) => (b.zone === 'venue' || b.zone === 'city') && !yours.includes(b.id));
    const take = (list, n) => {
      const pool = [...list], got = [];
      while (got.length < n && pool.length) got.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
      return got;
    };
    const forgedLog = new Set([...take(yours, 5), ...take(outside, 9).map((b) => b.id)]);
    add('person', 'venue', polar(400, TAU * r()), 'forger', { forgedLog });
  }
  return w;
}

function agoText(daysAgo) {
  if (daysAgo < 1) {
    const h = Math.max(1, Math.round(daysAgo * 24));
    return `last met ${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  }
  const n = Math.round(daysAgo);
  return `last met ${n} ${n === 1 ? 'day' : 'days'} ago`;
}

function howOf(stop, ctx, b) {
  if (ctx.heard) return stop === 'room' ? 'a direct signal of −80 dBm or more' : 'a weaker direct signal';
  const h = hopsOf(b, ctx.d);
  if (h) return `relayed by other phones, ${h} hops`;
  if (stop === 'city') return 'a cast posted within 25 km; its position is a claim';
  return 'the social graph only';
}

export function card(world, b, ctx) {
  const stop = stopOf(ctx, b);
  const community = world.communities.find((c) => c.id === b.community);
  const member = community && community.yours;
  const last = b.met.length ? Math.min(...b.met.map((m) => m.daysAgo)) : null;
  return {
    who: member ? `a member of ${community.name}` : `handle ${b.handle}, changes every 600 s`,
    what: `a ${b.kind}`,
    when: ctx.heard ? 'this epoch' : last === null ? 'not met' : agoText(last),
    where: BOUNDARIES.find((x) => x.id === stop).label,
    how: howOf(stop, ctx, b),
    why: member ? `you share ${community.name}` : 'no shared community',
  };
}
