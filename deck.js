// Deck navigation, hash sync and Petri mounting.
const slides = Array.from(document.querySelectorAll('section.slide'));
const currentEl = document.querySelector('[data-deck-current]');
const totalEl = document.querySelector('[data-deck-total]');
const prevBtn = document.querySelector('[data-deck="prev"]');
const nextBtn = document.querySelector('[data-deck="next"]');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let current = Math.max(0, slides.findIndex((s) => '#' + s.id === location.hash));

function show(index) {
  current = index;
  if (currentEl) currentEl.textContent = String(index + 1);
  if (prevBtn) prevBtn.disabled = index === 0;
  if (nextBtn) nextBtn.disabled = index === slides.length - 1;
  const hash = '#' + slides[index].id;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function go(index) {
  const target = Math.min(slides.length - 1, Math.max(0, index));
  slides[target].scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
  show(target);
}

// Slide crossing the middle of the viewport is the current one.
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) show(slides.indexOf(entry.target));
  }
}, { rootMargin: '-50% 0px -50% 0px', threshold: 0 });
slides.forEach((s) => observer.observe(s));

if (totalEl) totalEl.textContent = String(slides.length);
if (slides.length) show(current);

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
const landing = location.hash && slides.some((s) => '#' + s.id === location.hash) ? current : -1;

async function start() {
  await mountAll();
  if (landing < 0) return;
  if (document.readyState !== 'complete') await new Promise((r) => addEventListener('load', r, { once: true }));
  await document.fonts.ready;
  const land = () => slides[landing].scrollIntoView({ behavior: 'instant', block: 'start' });
  requestAnimationFrame(land);
  // Lazy images load once the slide is in view; land again after them.
  await Promise.all(Array.from(slides[landing].querySelectorAll('img'), (i) => i.decode().catch(() => {})));
  if (current === landing) requestAnimationFrame(land);
}

// Introducing HereCaster: the Demo button swaps in the test-data demo; Web Bluetooth stays allowed in the frame.
for (const box of document.querySelectorAll('[data-demo]')) {
  box.querySelector('.demo-btn')?.addEventListener('click', () => {
    const frame = document.createElement('iframe');
    frame.className = 'demo-frame';
    frame.src = box.dataset.demo;
    frame.title = 'HereCaster demo with test data';
    frame.allow = 'bluetooth; fullscreen';
    box.replaceChildren(frame);
    frame.focus();
  });
}

start();
