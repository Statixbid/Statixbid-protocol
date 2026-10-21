// Pure checks over an in-memory `site` ({ html, css:{name:text}, js:{name:text}, svg:{name:text} }).
// Each returns an array of problems; empty means pass. Mutations in gates.mjs rely on these being
// anchored on data-record attributes and register contents, never on the current state's text.
import { BASE58, HEX40, isStated } from "./register.mjs";

export const textOf = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

export const attrsOf = (html) => {
  const out = [];
  for (const m of html.matchAll(/\s(aria-label|alt|title|content|placeholder|data-idle|data-done)="([^"]*)"/g)) out.push(m[2]);
  return out;
};

export const visibleStrings = (html) => [...textOf(html).split("\n"), ...attrsOf(html)].map((s) => s.trim()).filter(Boolean);

const jsStrings = (src) => [...src.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2]);

export function elementByRecord(html, id) {
  const m = html.match(new RegExp(`<(a|span|div|button)\\b[^>]*data-record="${id}"[^>]*>`));
  return m ? m[0] : null;
}

// ---------- dates ----------
const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}\b/, /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, /\b\d{1,2}\.\d{1,2}\.\d{4}\b/,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?\b/i,
  /\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i,
  /\b(19|20)\d{2}\b/, /\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\b/i,
  /\bas of\b/i, /\bchecked\b/i, /\bupdated\b/i, /\blast (seen|synced|checked|update)/i, /\b\d+\s*(s|sec|secs|seconds|min|mins|minutes|hours?|days?)\s+ago\b/i,
];
const DATE_APIS = [/new\s+Date\b/, /Date\.now\b/, /toLocale(Date|Time)String/, /Intl\.DateTimeFormat/, /getFullYear|getHours|getMinutes|toISOString|toUTCString/];

export function checkNoDates(site) {
  const p = [];
  const scan = (label, s) => { for (const re of DATE_PATTERNS) if (re.test(s)) p.push(`${label}: date-like "${s.slice(0, 60)}" (${re})`); };
  for (const s of visibleStrings(site.html)) scan("html", s);
  for (const [n, src] of Object.entries(site.js)) {
    for (const s of jsStrings(src)) scan(n, s);
    for (const re of DATE_APIS) if (re.test(src)) p.push(`${n}: date api ${re}`);
  }
  for (const [n, css] of Object.entries(site.css)) for (const m of css.matchAll(/content:\s*"([^"]*)"/g)) scan(n, m[1]);
  return p;
}

// ---------- palette ----------
const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g;
export function hexesIn(text) { return [...text.matchAll(HEX)].map((m) => m[0].toLowerCase()); }

export function checkHexConfined(site) {
  const p = [];
  const html = site.html.replace(/href="#[^"]*"/g, "");
  for (const h of hexesIn(html)) p.push(`index.html: hex ${h}`);
  for (const [n, src] of Object.entries(site.js)) for (const h of hexesIn(src)) p.push(`${n}: hex ${h}`);
  for (const [n, css] of Object.entries(site.css)) {
    if (n === "tokens.css") continue;
    for (const h of hexesIn(css)) p.push(`${n}: hex ${h}`);
    if (/\b(rgba?|hsla?)\(\s*\d/.test(css)) p.push(`${n}: numeric colour function`);
  }
  return p;
}

export function checkTokensInPalette(tokensCss, paletteHexes) {
  const p = [];
  const hexes = new Set(hexesIn(tokensCss.replace(/\/\*[\s\S]*?\*\//g, "")));
  const allowed = new Set(paletteHexes);
  for (const h of hexes) if (!allowed.has(h)) p.push(`tokens.css: ${h} not in sampled palette`);
  const header = tokensCss.match(/\/\*[\s\S]*?\*\//)?.[0] || "";
  for (const h of hexes) if (!header.includes(h) || !new RegExp(h + "[^\\n]*\\(\\d+,\\d+\\)").test(header)) p.push(`tokens.css: ${h} lacks provenance coordinate`);
  // decimal triplets must equal a palette hex
  for (const m of tokensCss.matchAll(/--[\w-]+-rgb:\s*(\d+)\s+(\d+)\s+(\d+)/g)) {
    const hex = "#" + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, "0")).join("");
    if (!allowed.has(hex)) p.push(`tokens.css: rgb triplet ${m[1]} ${m[2]} ${m[3]} (${hex}) not in palette`);
  }
  return p;
}

export function checkFavicon(svg, paletteHexes) {
  const p = [];
  if (!/viewBox="0 0 32 32"/.test(svg)) p.push("favicon: viewBox is not 0 0 32 32");
  if (!/width="32"/.test(svg) || !/height="32"/.test(svg)) p.push("favicon: not 32x32");
  if (svg.includes("--")) p.push("favicon: double hyphen present");
  if (/<!--/.test(svg)) p.push("favicon: xml comment present");
  for (const h of hexesIn(svg)) if (!paletteHexes.includes(h)) p.push(`favicon: ${h} not in palette`);
  if (!/<path[^>]*d="M[^"]{200,}"/.test(svg)) p.push("favicon: traced path missing");
  return p;
}

// ---------- addresses (rule 3) ----------
export function statedAddressValues(reg) {
  return Object.values(reg.records).filter((r) => r.kind === "address" && isStated(r)).map((r) => r.value);
}

export function stripCaSlot(html) {
  return html.replace(/<div class="ca[^"]*"[^>]*data-ca-slot[\s\S]*?<\/div>/, "");
}

export function scanAddresses(text, registryValues) {
  const p = [];
  const ok = new Set(registryValues);
  // 0x hex is matched as one unit first so its tail is not re-read as base58
  const rest = text.replace(new RegExp(HEX40.source, "g"), (h) => {
    if (!ok.has(h)) p.push(`address-shaped string not in stated registry: ${h.slice(0, 20)}...`);
    return " ";
  });
  for (const m of rest.matchAll(new RegExp(BASE58.source, "g"))) {
    if (!ok.has(m[0])) p.push(`address-shaped string not in stated registry: ${m[0].slice(0, 20)}...`);
  }
  return p;
}

export function checkAddresses(site, reg) {
  const all = [stripCaSlot(site.html), ...Object.values(site.js), ...Object.values(site.css)].join("\n");
  return scanAddresses(all, statedAddressValues(reg));
}

// ---------- social + CA slots ----------
export function checkSocials(site, reg) {
  const p = [];
  for (const id of Object.keys(reg.records).filter((k) => reg.records[k].kind === "social")) {
    const rec = reg.records[id];
    const tag = elementByRecord(site.html, id);
    if (!tag) { p.push(`${id}: element missing`); continue; }
    const block = site.html.slice(site.html.indexOf(tag), site.html.indexOf(tag) + 4000);
    if (!/<svg[\s\S]*?<path/.test(block.split(/<\/(a|span)>/)[0])) p.push(`${id}: icon missing`);
    const href = tag.match(/href="([^"]*)"/);
    if (isStated(rec)) {
      if (!href || href[1] !== rec.url) p.push(`${id}: stated but href != stored url`);
      let handle = null; try { handle = new URL(rec.url).pathname.split("/").filter(Boolean)[0]; } catch {}
      if (handle && !tag.includes(handle)) p.push(`${id}: handle not derived into label`);
      if (!/data-state="stated"/.test(tag)) p.push(`${id}: state attr mismatch`);
    } else {
      if (href) p.push(`${id}: inert record has href`);
      if (!/aria-disabled="true"/.test(tag)) p.push(`${id}: inert record not aria-disabled`);
      if (/data-state="stated"/.test(tag)) p.push(`${id}: inert record marked stated`);
    }
  }
  return p;
}

export function checkSocialsVisible(site) {
  const p = [];
  for (const [n, css] of Object.entries(site.css)) {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/\.soc\b|\.socials\b|\.topbar\b|\[data-record/.test(m[1]) && /display:\s*none|visibility:\s*hidden|opacity:\s*0\b/.test(m[2])) p.push(`${n}: hides ${m[1].trim()}`);
    }
  }
  return p;
}

export function checkCa(site, reg) {
  const p = [];
  const rec = reg.records.ca;
  const header = site.html.match(/<header class="topbar"[\s\S]*?<\/header>/)?.[0] || "";
  if (!header.includes("data-ca-slot")) p.push("ca: slot not inside the top header");
  if (site.html.indexOf("<header") > site.html.indexOf("<main")) p.push("ca: header after main");
  const slot = header.match(/<div class="ca[^"]*"[^>]*data-ca-slot[\s\S]*?<\/div>/)?.[0] || "";
  if (isStated(rec)) {
    if (!slot.includes(`>${rec.value}</code>`)) p.push("ca: stated but full address not rendered");
    if (!slot.includes(`data-copy="${rec.value}"`)) p.push("ca: stated but copy payload missing");
    if (!/<button/.test(slot)) p.push("ca: stated but no copy button");
    if (/is-inert/.test(slot)) p.push("ca: stated but marked inert");
  } else {
    if (/<button|data-copy|<code/.test(slot)) p.push("ca: inert slot carries live controls");
    if (!/is-inert/.test(slot) || !/aria-disabled="true"/.test(slot)) p.push("ca: inert slot not marked inert");
    if (!/>pending</.test(slot)) p.push("ca: inert slot must read pending");
  }
  return p;
}

export function checkNoUnstatedLinks(site, reg) {
  const p = [];
  for (const m of site.html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>/g)) {
    const href = m[1];
    if (href.startsWith("#") || href.startsWith("/")) continue;
    const ok = Object.values(reg.records).some((r) => isStated(r) && r.url === href);
    if (!ok) p.push(`link ${href} not backed by a stated record`);
  }
  for (const id of Object.keys(reg.records)) {
    const rec = reg.records[id];
    if (!isStated(rec)) {
      const tag = elementByRecord(site.html, id);
      if (tag && /href=/.test(tag)) p.push(`${id}: inert record rendered with href`);
    }
  }
  return p;
}

export function checkNoCh(site) {
  const p = [];
  const src = { "index.html": site.html, ...site.css };
  for (const [n, t] of Object.entries(src)) if (/(^|[^\w.-])\d*\.?\d+ch\b/.test(t.replace(/\/\*[\s\S]*?\*\//g, ""))) p.push(`${n}: ch unit`);
  return p;
}

// ---------- copy ----------
const STOP = new Set(("a an and are as at be been but by can for from had has have he her his how i if in into is it its just like more most no not of on one or our out so some such than that the their them then there these they this those to too up us was we were what when where which who why will with you your yours it's that's can't don't isn't aren't each every any all both either same other own only very").split(" "));
export const ALLOWED_SHARED = new Set(["nft", "nfts", "token", "tokens", "solana"]);

const words = (line) => line.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
const grams = (lines) => { const s = new Set(); for (const l of lines) { const w = words(l); for (let i = 0; i < w.length - 1; i++) s.add(w[i] + " " + w[i + 1]); } return s; };
const vocab = (lines) => { const s = new Set(); for (const l of lines) for (const w of words(l)) if (!STOP.has(w) && !/^\d+$/.test(w) && w.length > 1) s.add(w); return s; };

export function checkCopy(site, refLines) {
  const mine = visibleStrings(site.html);
  const g1 = grams(mine), g2 = grams(refLines);
  const p = [];
  for (const g of g1) if (g2.has(g)) p.push(`shared 2-gram: "${g}"`);
  const v1 = vocab(mine), v2 = vocab(refLines);
  for (const w of v1) if (v2.has(w) && !ALLOWED_SHARED.has(w)) p.push(`shared word: "${w}"`);
  return p;
}

// ---------- misc ----------
export function checkMotionSources(site) {
  const p = [];
  const css = Object.values(site.css).join("\n");
  if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css)) p.push("css: no reduced-motion block");
  const block = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)$/)?.[1] || "";
  if (!/animation:\s*none\s*!important/.test(block) || !/transition:\s*none\s*!important/.test(block)) p.push("css: reduced block does not zero animation and transition");
  for (const f of ["spring.js", "fx.js", "market.js"]) {
    const src = site.js["js/" + f];
    if (!src || !/reduced/.test(src)) p.push(`${f}: no reduced-motion handling`);
  }
  return p;
}

export function checkTapTargets(site) {
  const p = [];
  const css = site.css["styles.css"];
  const need = [[".soc", /\.soc \{[^}]*width: 44px; height: 44px/], [".copybtn", /\.copybtn \{[^}]*width: 44px; height: 44px/], [".dock a", /\.dock a \{[^}]*min-height: 44px/], [".btn", /\.btn \{[^}]*min-height: 48px/], [".ca-copy", /\.ca-copy \{[^}]*min-height: 44px/], [".totop", /\.totop \{[^}]*width: 48px; height: 48px/]];
  for (const [n, re] of need) if (!re.test(css)) p.push(`${n}: no 44px floor`);
  return p;
}
