// Deck navigation, hash sync and Petri mounting.
const slides = Array.from(document.querySelectorAll('section.slide'));
const currentEl = document.querySelector('[data-deck-current]');
const totalEl = document.querySelector('[data-deck-total]');
const prevBtn = document.querySelector('[data-deck="prev"]');
const nextBtn = document.querySelector('[data-deck="next"]');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// Portrait windows turn each column of a split slide into its own page: 3a, 3b.
const portrait = window.matchMedia('screen and (max-aspect-ratio: 799/1000)');

let pages = [];
function buildPages() {
  pages = [];
  slides.forEach((s, i) => {
    const cols = s.classList.contains('split') && portrait.matches ? Array.from(s.querySelectorAll('.pair-col')) : [];
    if (cols.length < 2) { pages.push({ el: s, label: String(i + 1), hash: '#' + s.id }); return; }
    cols.forEach((c, k) => {
      const letter = String.fromCharCode(97 + k);
      pages.push({ el: c, label: (i + 1) + letter, hash: '#' + s.id + (k ? '-' + letter : '') });
    });
  });
}
buildPages();

const pageOfHash = (h) => {
  let i = pages.findIndex((p) => p.hash === h);
  // #today-b in a landscape window lands on #today
  if (i < 0 && h) i = pages.findIndex((p) => h.startsWith(p.hash + '-'));
  return i;
};

let current = Math.max(0, pageOfHash(location.hash));

function show(index) {
  current = index;
  if (currentEl) currentEl.textContent = pages[index].label;
  if (prevBtn) prevBtn.disabled = index === 0;
  if (nextBtn) nextBtn.disabled = index === pages.length - 1;
  const hash = pages[index].hash;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function go(index) {
  const target = Math.min(pages.length - 1, Math.max(0, index));
  pages[target].el.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
  show(target);
}

// Page crossing the middle of the viewport is the current one.
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const i = pages.findIndex((p) => p.el === entry.target);
    if (i >= 0) show(i);
  }
}, { rootMargin: '-50% 0px -50% 0px', threshold: 0 });
function observePages() {
  observer.disconnect();
  pages.forEach((p) => observer.observe(p.el));
}
observePages();

portrait.addEventListener('change', () => {
  const slide = slides.find((s) => s === pages[current].el || s.contains(pages[current].el));
  buildPages();
  observePages();
  show(Math.max(0, pages.findIndex((p) => p.el === slide || slide.contains(p.el))));
});

if (totalEl) totalEl.textContent = String(slides.length);
if (pages.length) show(current);

prevBtn?.addEventListener('click', () => go(current - 1));
nextBtn?.addEventListener('click', () => go(current + 1));

const FORWARD = new Set(['ArrowDown', 'PageDown', ' ', 'ArrowRight']);
const BACK = new Set(['ArrowUp', 'PageUp', 'ArrowLeft']);
const SKIP = '.petri, [data-petri], input, select, textarea, [contenteditable]';
// Space activates these natively; arrows still turn slides.
const ACTIVATE = 'button, summary';

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target instanceof Element ? e.target : null;
  if (t && t.closest(SKIP)) return;
  if (t && e.key === ' ' && t.closest(ACTIVATE)) return;
  const back = BACK.has(e.key) || (e.key === ' ' && e.shiftKey);
  if (!back && !FORWARD.has(e.key)) return;
  e.preventDefault();
  go(current + (back ? -1 : 1));
});

function parseInitial(el) {
  try {
    return JSON.parse(el.dataset.initial || '{}');
  } catch {
    return {};
  }
}

function parseControls(el) {
  return (el.dataset.controls || '').split(',').map((c) => c.trim()).filter(Boolean);
}

function fallback(el) {
  if (el.childElementCount) return;
  const p = document.createElement('p');
  p.className = 'petri-fallback';
  p.textContent = 'The interactive dish could not load in this browser.';
  el.append(p);
}

async function mountAll() {
  const hosts = Array.from(document.querySelectorAll('[data-petri]'));
  if (!hosts.length) return;
  let mountPetri;
  try {
    ({ mountPetri } = await import('./petri/view.js'));
  } catch (err) {
    console.warn('petri: import failed', err);
    hosts.forEach(fallback);
    return;
  }
  for (const el of hosts) {
    try {
      mountPetri(el, { initial: parseInitial(el), controls: parseControls(el) });
    } catch (err) {
      console.warn('petri: mount failed', err);
      fallback(el);
    }
  }
}

// Hash link: re-land once dishes, load and fonts have set slide heights.
const landing = location.hash && pageOfHash(location.hash) >= 0 ? current : -1;

async function start() {
  await mountAll();
  if (landing < 0) return;
  if (document.readyState !== 'complete') await new Promise((r) => addEventListener('load', r, { once: true }));
  await document.fonts.ready;
  const land = () => pages[landing].el.scrollIntoView({ behavior: 'instant', block: 'start' });
  requestAnimationFrame(land);
  // Lazy images load once the slide is in view; land again after them.
  await Promise.all(Array.from(pages[landing].el.querySelectorAll('img'), (i) => i.decode().catch(() => {})));
  if (current === landing) requestAnimationFrame(land);
}

// Introducing HereCaster: the test-data demo loads behind the capture and shows once its graph draws; Web Bluetooth stays allowed in the frame.
for (const box of document.querySelectorAll('[data-demo]')) {
  const frame = document.createElement('iframe');
  frame.className = 'demo-frame';
  frame.title = 'HereCaster demo with test data';
  frame.allow = 'bluetooth; fullscreen';
  const show = () => { box.classList.add('live'); box.removeAttribute('aria-busy'); };
  frame.addEventListener('load', () => {
    let tries = 0;
    const poll = () => {
      let drawn = false;
      try { drawn = !!frame.contentDocument?.querySelector('svg circle, canvas'); } catch { drawn = true; }
      if (drawn || ++tries > 75) show(); else setTimeout(poll, 200);
    };
    poll();
  }, { once: true });
  frame.src = box.dataset.demo;
  box.append(frame);
  frame.addEventListener('load', () => watchTouches(frame));
}

// Portrait page 6: the title card shows on arrival, then fades once the demo is live.
const here = document.getElementById('here');
if (here) {
  let reveal = 0;
  new IntersectionObserver(([e]) => {
    clearTimeout(reveal);
    if (!e.isIntersecting) { here.classList.remove('revealed'); return; }
    const box = here.querySelector('.demo-box');
    const wait = () => { reveal = setTimeout(() => (box && !box.classList.contains('live') ? wait() : here.classList.add('revealed')), 1500); };
    wait();
  }, { threshold: 0.6 }).observe(here);
}

// Portrait full-page demo: touches inside it fade the navigator out; it returns 2 s after the last touch ends.
const nav = document.querySelector('.deck-nav');
let navBack = 0;
function watchTouches(frame) {
  let doc;
  try { doc = frame.contentDocument; } catch { return; }
  if (!doc || !nav) return;
  const away = () => {
    if (!portrait.matches) return;
    clearTimeout(navBack);
    nav.classList.add('away');
  };
  const back = (e) => {
    if (e.touches && e.touches.length) return;
    clearTimeout(navBack);
    navBack = setTimeout(() => nav.classList.remove('away'), 2000);
  };
  const opts = { capture: true, passive: true };
  doc.addEventListener('touchstart', away, opts);
  doc.addEventListener('touchend', back, opts);
  doc.addEventListener('touchcancel', back, opts);
  doc.addEventListener('mousedown', away, opts);
  doc.addEventListener('mouseup', back, opts);
}

start();
