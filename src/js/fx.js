import { spring, reduced } from "./spring.js";

const BASE_DELAY = 80;
const STAGGER = 120;

function springIn(el, delay) {
  spring({
    delay,
    onUpdate: (p) => {
      el.style.opacity = String(Math.max(0, Math.min(1, p * 1.4)));
      el.style.transform = `translateY(${((1 - p) * 26).toFixed(2)}px)`;
    },
    onDone: () => {
      el.style.opacity = "";
      el.style.transform = "";
      el.classList.add("in");
    },
  });
}

export function initReveal() {
  const items = [...document.querySelectorAll(".rv")];
  if (reduced() || !("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("in"));
    document.body.classList.add("is-ready");
    return;
  }
  const seen = new WeakSet();
  const run = (el) => {
    if (seen.has(el)) return;
    seen.add(el);
    springIn(el, BASE_DELAY + Number(el.dataset.i || 0) * STAGGER);
  };
  items.filter((el) => "now" in el.dataset).forEach(run);
  requestAnimationFrame(() => document.body.classList.add("is-ready"));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { run(e.target); io.unobserve(e.target); }
    }
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  items.filter((el) => !("now" in el.dataset)).forEach((el) => io.observe(el));

  // bars fill once their card has entered
  document.querySelectorAll(".bar i").forEach((bar) => {
    const card = bar.closest(".fig");
    const bio = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      bio.disconnect();
      const delay = 500 + Number(card.dataset.i || 0) * STAGGER;
      bar.style.transform = "scaleX(0)";
      spring({ from: 0, to: 0.06, stiffness: 40, damping: 10, delay, onUpdate: (p) => { bar.style.transform = `scaleX(${Math.max(0, p).toFixed(4)})`; } });
    }, { threshold: 0.3 });
    bio.observe(card);
  });
}

export function initProgress() {
  const bar = document.getElementById("progress");
  let queued = false;
  const update = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.setProperty("--p", max > 0 ? Math.min(1, Math.max(0, scrollY / max)).toFixed(4) : "0");
  };
  addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener("resize", update);
  update();
}

export function initSpotlight() {
  document.addEventListener("pointermove", (e) => {
    const t = e.target.closest && e.target.closest(".spot");
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty("--mx", `${e.clientX - r.left}px`);
    t.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, { passive: true });
}

export function initParallax() {
  if (reduced()) return;
  const hero = document.getElementById("hero");
  const layers = [...hero.querySelectorAll(".px")];
  const target = { x: 0, y: 0 };
  const cur = { x: 0, y: 0, s: 0 };
  let visible = true, raf = 0;
  hero.addEventListener("pointermove", (e) => {
    const r = hero.getBoundingClientRect();
    target.x = (e.clientX - r.left) / r.width * 2 - 1;
    target.y = (e.clientY - r.top) / r.height * 2 - 1;
  }, { passive: true });
  hero.addEventListener("pointerleave", () => { target.x = 0; target.y = 0; });
  const tick = () => {
    raf = 0;
    cur.x += (target.x - cur.x) * 0.08;
    cur.y += (target.y - cur.y) * 0.08;
    const s = Math.min(1, scrollY / Math.max(1, hero.offsetHeight));
    cur.s += (s - cur.s) * 0.12;
    for (const el of layers) {
      const d = Number(el.dataset.depth || 0);
      el.style.transform = `translate3d(${(cur.x * d).toFixed(2)}px, ${(cur.y * d + cur.s * d * 6).toFixed(2)}px, 0)`;
    }
    if (visible) raf = requestAnimationFrame(tick);
  };
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !raf) raf = requestAnimationFrame(tick);
  }).observe(hero);
  raf = requestAnimationFrame(tick);
}

export function initScrollSpy() {
  const links = [...document.querySelectorAll("[data-nav]")];
  const secs = [...document.querySelectorAll("[data-section]")];
  const set = (id) => links.forEach((a) => a.setAttribute("aria-current", String(a.dataset.nav === id)));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) set(e.target.dataset.section);
  }, { rootMargin: "-35% 0px -55% 0px" });
  secs.forEach((s) => io.observe(s));
}
