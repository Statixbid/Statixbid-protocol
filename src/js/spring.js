// Damped harmonic oscillator, fixed-step semi-implicit Euler.
// stiffness 60 / damping 12 / mass 1: natural frequency 7.7 rad/s, damping ratio 0.77,
// settles inside ~0.7s with a small overshoot, close to the 0.8s ease the reference uses.
export const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function spring({ from = 0, to = 1, stiffness = 60, damping = 12, mass = 1, delay = 0, onUpdate, onDone }) {
  if (reduced()) {
    onUpdate(to);
    if (onDone) onDone();
    return () => {};
  }
  let x = from, v = 0, raf = 0, timer = 0, last = 0, dead = false;
  const STEP = 1 / 240;
  const frame = (t) => {
    if (dead) return;
    let dt = Math.min(0.064, (t - last) / 1000 || STEP);
    last = t;
    while (dt > 0) {
      const h = Math.min(STEP, dt);
      const a = (-stiffness * (x - to) - damping * v) / mass;
      v += a * h;
      x += v * h;
      dt -= h;
    }
    if (Math.abs(x - to) < 0.0008 && Math.abs(v) < 0.0008) {
      onUpdate(to);
      if (onDone) onDone();
      return;
    }
    onUpdate(x);
    raf = requestAnimationFrame(frame);
  };
  timer = setTimeout(() => { last = performance.now(); raf = requestAnimationFrame(frame); }, delay);
  return () => { dead = true; clearTimeout(timer); cancelAnimationFrame(raf); };
}
