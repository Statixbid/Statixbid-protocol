// Pure market logic: no DOM, no clock. Everything here is covered by scripts/gates.mjs with fixtures.

export const POLL_MS = 60000;
export const BACKOFF_MS = [1000, 2000, 4000, 8000];
export const TOP_N = 10;
export const PAIRS_CHUNK = 30;

export function solanaAddresses(boosts) {
  const seen = new Set();
  const out = [];
  if (!Array.isArray(boosts)) return out;
  for (const b of boosts) {
    if (!b || b.chainId !== "solana" || typeof b.tokenAddress !== "string") continue;
    if (seen.has(b.tokenAddress)) continue;
    seen.add(b.tokenAddress);
    out.push(b.tokenAddress);
  }
  return out;
}

export function boostIcons(boosts) {
  const m = new Map();
  if (!Array.isArray(boosts)) return m;
  for (const b of boosts) if (b && b.chainId === "solana" && b.icon) m.set(b.tokenAddress, b.icon);
  return m;
}

export function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(+v) ? +v : null);
const httpsOnly = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);

// Collapse pairs into one record per token: price/change from the deepest pool, volume and depth summed.
export function aggregate(pairs, wanted, icons = new Map()) {
  const by = new Map();
  if (!Array.isArray(pairs)) return [];
  for (const p of pairs) {
    if (!p || p.chainId !== "solana" || !p.baseToken) continue;
    const addr = p.baseToken.address;
    if (!wanted.has(addr)) continue;
    const liq = num(p.liquidity && p.liquidity.usd) ?? 0;
    const vol = num(p.volume && p.volume.h24) ?? 0;
    let t = by.get(addr);
    if (!t) {
      t = { address: addr, symbol: p.baseToken.symbol || "", name: p.baseToken.name || "", price: null, change: null, volume: 0, liquidity: 0, image: null, bestLiq: -1 };
      by.set(addr, t);
    }
    t.volume += vol;
    t.liquidity += liq;
    const img = httpsOnly(p.info && p.info.imageUrl);
    if (img && !t.image) t.image = img;
    if (liq > t.bestLiq) {
      t.bestLiq = liq;
      t.price = num(p.priceUsd);
      t.change = num(p.priceChange && p.priceChange.h24);
      if (p.baseToken.symbol) t.symbol = p.baseToken.symbol;
      if (p.baseToken.name) t.name = p.baseToken.name;
    }
  }
  for (const t of by.values()) {
    if (!t.image) t.image = httpsOnly(icons.get(t.address));
    delete t.bestLiq;
  }
  return [...by.values()];
}

export function topByVolume(tokens, n = TOP_N) {
  return [...tokens].sort((a, b) => b.volume - a.volume || b.liquidity - a.liquidity).slice(0, n);
}

const SUB = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
const toSub = (n) => String(n).split("").map((d) => SUB[+d]).join("");

export function formatPrice(v) {
  if (v == null) return "—";
  if (v >= 1000) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 1) return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 0.01) return "$" + v.toFixed(4);
  if (v <= 0) return "$0";
  const exp = Math.floor(Math.log10(v));
  const zeros = -exp - 1;
  if (zeros >= 4) {
    const digits = Math.round(v / Math.pow(10, exp - 3)).toString().slice(0, 4).replace(/0+$/, "") || "0";
    return `$0.0${toSub(zeros)}${digits}`;
  }
  return "$" + v.toPrecision(4);
}

export function formatUsd(v) {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const f = (d, s) => "$" + (v / d).toFixed(abs / d >= 100 ? 0 : abs / d >= 10 ? 1 : 2).replace(/\.?0+$/, "") + s;
  if (abs >= 1e9) return f(1e9, "B");
  if (abs >= 1e6) return f(1e6, "M");
  if (abs >= 1e3) return f(1e3, "K");
  return "$" + v.toFixed(0);
}

export function formatPct(v) {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const s = abs >= 1000 ? abs.toLocaleString("en-US", { maximumFractionDigits: 0 }) : abs.toFixed(abs >= 100 ? 0 : 2);
  return s + "%";
}

export const dirOf = (v) => (v == null ? "flat" : v > 0 ? "up" : v < 0 ? "dn" : "flat");

export function shortAddr(a) {
  return a.length > 10 ? a.slice(0, 4) + "…" + a.slice(-4) : a;
}

export function backoffDelay(attempt) {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
}

// Resolve the two endpoints from the market-source register record only.
export function endpointsFrom(record) {
  if (!record || record.state !== "stated" || !record.urls) return null;
  const { boosts, pairs } = record.urls;
  if (typeof boosts !== "string" || typeof pairs !== "string" || !pairs.includes("{addresses}")) return null;
  return { boosts, pairs };
}

// One full cycle: boosts -> solana filter -> pairs (chunked) -> aggregate -> top N.
// `getJson(url)` must reject on failure; retry/backoff is applied around every request.
export async function loadTop(endpoints, getJson, { sleep, onRetry, signal } = {}) {
  const withRetry = async (url) => {
    let last;
    for (let i = 0; i <= BACKOFF_MS.length; i++) {
      if (signal && signal.aborted) throw new Error("aborted");
      try { return await getJson(url); } catch (e) {
        last = e;
        if (signal && signal.aborted) throw e;
        if (i === BACKOFF_MS.length) break;
        if (onRetry) onRetry(i + 1);
        await sleep(backoffDelay(i));
      }
    }
    throw last;
  };
  const boosts = await withRetry(endpoints.boosts);
  const addrs = solanaAddresses(boosts);
  if (!addrs.length) throw new Error("no solana entries");
  const icons = boostIcons(boosts);
  const wanted = new Set(addrs);
  const all = [];
  for (const group of chunk(addrs, PAIRS_CHUNK)) {
    const url = endpoints.pairs.replace("{addresses}", group.map(encodeURIComponent).join(","));
    const pairs = await withRetry(url);
    all.push(...aggregate(pairs, wanted, icons));
  }
  const top = topByVolume(all);
  if (!top.length) throw new Error("no pairs");
  return top;
}
