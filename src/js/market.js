import { record } from "./register.js";
import { reduced } from "./spring.js";
import { copyText, announce, flashDone } from "./copy.js";
import { POLL_MS, endpointsFrom, loadTop, formatPrice, formatUsd, formatPct, dirOf, shortAddr } from "./market-core.js";

const DASH = "—";
const COPY_ICON = '<svg class="cp" viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.5v-.2a1.8 1.8 0 0 0-1.8-1.8H3.8A1.8 1.8 0 0 0 2 3.3v4.9a1.8 1.8 0 0 0 1.8 1.8h.2"/></svg><svg class="ok" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>';

const rowsEl = document.getElementById("rows");
const trackEl = document.getElementById("track");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("status-text");
const errEl = document.getElementById("errline");

const model = { tokens: [], rows: new Map(), have: false };
let timer = 0, inflight = null, failed = false;

function setStatus(s, text) {
  statusEl.dataset.s = s;
  statusText.textContent = text;
}

function tile(sym, i) {
  const box = document.createElement("span");
  box.className = "logo-box";
  const l = document.createElement("span");
  l.className = "ltr lt" + (i % 5);
  l.textContent = (sym || "?").trim().charAt(0).toUpperCase() || "?";
  box.appendChild(l);
  return box;
}

function withImage(box, url) {
  if (!url) return;
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("load", () => box.appendChild(img));
  img.addEventListener("error", () => img.remove());
  img.src = url;
}

function countTo(el, from, to, fmt) {
  if (reduced() || from == null || to == null || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 700;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(to);
  };
  requestAnimationFrame(step);
}

function flash(el, up) {
  if (reduced()) return;
  el.classList.remove("flash-up", "flash-dn");
  void el.offsetWidth;
  el.classList.add(up ? "flash-up" : "flash-dn");
}

function makeRow(t, idx) {
  const row = document.createElement("div");
  row.className = "mrow spot";
  row.setAttribute("role", "row");
  row.dataset.addr = t.address;
  const rk = Object.assign(document.createElement("span"), { className: "rk" });
  const tok = document.createElement("div");
  tok.className = "tok";
  const box = tile(t.symbol, idx);
  withImage(box, t.image);
  const nm = document.createElement("div");
  nm.className = "tok-name";
  const b = document.createElement("b"); b.textContent = t.symbol || shortAddr(t.address);
  const s = document.createElement("span"); s.textContent = t.name || shortAddr(t.address);
  nm.append(b, s);
  tok.append(box, nm);
  const m = document.createElement("div");
  m.className = "m";
  const mk = (label, cls) => { const c = document.createElement("span"); c.className = "r"; c.dataset.l = label; const n = document.createElement("span"); n.className = cls; c.appendChild(n); m.appendChild(c); return n; };
  const price = mk("Price", "num"), chg = mk("Change", "num chg"), vol = mk("Volume", "num"), liq = mk("Depth", "num");
  const cp = document.createElement("span");
  cp.className = "cpcell";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copybtn";
  btn.setAttribute("aria-label", `Copy address for ${t.symbol || "token"}`);
  btn.innerHTML = COPY_ICON;
  btn.addEventListener("click", async () => {
    if (await copyText(t.address)) { flashDone(btn); announce(`Copied address for ${t.symbol || "token"}`); }
  });
  cp.appendChild(btn);
  row.append(rk, tok, m, cp);
  return { el: row, rk, b, s, price, chg, vol, liq, prev: { price: null, change: null, volume: null, liquidity: null }, box, addr: t.address, image: t.image };
}

function paint(r, t, idx, first) {
  r.rk.textContent = String(idx + 1);
  r.b.textContent = t.symbol || shortAddr(t.address);
  r.s.textContent = t.name || shortAddr(t.address);
  const cells = [
    ["price", r.price, formatPrice],
    ["volume", r.vol, formatUsd],
    ["liquidity", r.liq, formatUsd],
  ];
  for (const [k, el, fmt] of cells) {
    const to = t[k], from = r.prev[k];
    if (first) { countTo(el, 0, to, fmt); }
    else if (from !== to) { countTo(el, from, to, fmt); if (from != null && to != null) flash(el, to > from); }
    else el.textContent = fmt(to);
    r.prev[k] = to;
  }
  const dir = dirOf(t.change);
  r.chg.className = "num chg " + (dir === "up" ? "up" : dir === "dn" ? "dn" : "");
  const arrow = dir === "up" ? "▲ " : dir === "dn" ? "▼ " : "";
  const fmtC = (v) => (v == null ? DASH : arrow + formatPct(v));
  const fromC = r.prev.change;
  if (first) countTo(r.chg, 0, t.change, fmtC);
  else if (fromC !== t.change) { countTo(r.chg, fromC, t.change, fmtC); if (fromC != null && t.change != null) flash(r.chg, t.change > fromC); }
  else r.chg.textContent = fmtC(t.change);
  r.prev.change = t.change;
}

function render(tokens) {
  const nextRows = new Map();
  const ordered = [];
  tokens.forEach((t, i) => {
    let r = model.rows.get(t.address);
    const first = !r;
    if (!r) r = makeRow(t, i);
    paint(r, t, i, first || !model.have);
    nextRows.set(t.address, r);
    ordered.push(r);
  });
  const wasSkeleton = !model.have;
  if (wasSkeleton) rowsEl.replaceChildren();
  rowsEl.replaceChildren(...ordered.map((r) => r.el));
  ordered.forEach((r, i) => {
    r.el.style.setProperty("--i", String(i));
    if (!r.el.classList.contains("ready")) r.el.classList.add("ready");
  });
  model.rows = nextRows;
  model.have = true;
  renderTicker(tokens);
}

function renderTicker(tokens) {
  const make = (t, i) => {
    const s = document.createElement("span");
    s.className = "tk";
    s.style.setProperty("--i", String(i));
    const d = dirOf(t.change);
    const sym = document.createElement("b"); sym.textContent = t.symbol || shortAddr(t.address);
    const pv = document.createElement("span"); pv.className = "pv"; pv.textContent = formatPrice(t.price);
    const c = document.createElement("span");
    c.className = "chg " + (d === "up" ? "up" : d === "dn" ? "dn" : "");
    c.textContent = t.change == null ? DASH : (d === "up" ? "▲ " : d === "dn" ? "▼ " : "") + formatPct(t.change);
    s.append(sym, pv, c);
    return s;
  };
  const one = tokens.map(make);
  const two = tokens.map((t, i) => make(t, i));
  two.forEach((n) => n.setAttribute("aria-hidden", "true"));
  trackEl.replaceChildren(...one, ...two);
}

function showDashes() {
  rowsEl.querySelectorAll(".mrow.skeleton").forEach((row) => {
    row.classList.remove("skeleton");
    row.querySelectorAll(".sk").forEach((sk) => { sk.className = ""; sk.textContent = DASH; sk.style.width = ""; });
  });
  if (!trackEl.dataset.dashed) {
    trackEl.dataset.dashed = "1";
    trackEl.replaceChildren(...[...Array(8)].map(() => Object.assign(document.createElement("span"), { className: "tk", textContent: DASH })));
  }
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function getJson(url, signal) {
  const ctl = new AbortController();
  const kill = setTimeout(() => ctl.abort(), 12000);
  const onAbort = () => ctl.abort();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("http " + res.status);
    return await res.json();
  } finally {
    clearTimeout(kill);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

async function cycle() {
  const ep = endpointsFrom(record("market-source"));
  if (!ep) { setStatus("down", "Source pending"); showDashes(); return; }
  if (inflight) inflight.abort();
  const ctl = (inflight = new AbortController());
  setStatus(model.have ? "live" : "load", model.have ? "Live" : "Syncing");
  try {
    const top = await loadTop(ep, (u) => getJson(u, ctl.signal), {
      sleep,
      signal: ctl.signal,
      onRetry: () => setStatus("retry", "Retrying"),
    });
    if (ctl.signal.aborted) return;
    failed = false;
    errEl.classList.remove("show");
    render(top);
    setStatus("live", "Live");
  } catch (e) {
    if (ctl.signal.aborted) return;
    failed = true;
    if (model.have) {
      setStatus("retry", "Showing last good data");
    } else {
      setStatus("down", "Feed unreachable");
      errEl.classList.add("show");
      showDashes();
    }
  } finally {
    if (inflight === ctl) inflight = null;
    schedule();
  }
}

function schedule() {
  clearTimeout(timer);
  if (document.hidden) return;
  timer = setTimeout(cycle, POLL_MS);
}

export function startMarket() {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(timer);
      if (inflight) { inflight.abort(); inflight = null; }
    } else {
      clearTimeout(timer);
      cycle();
    }
  });
  cycle();
}
