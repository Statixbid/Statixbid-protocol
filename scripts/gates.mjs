import { readFileSync, readdirSync, statSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, buildSite } from "./build.mjs";
import { loadRegister, validateRegister, isStated, BASE58, HEX40 } from "./lib/register.mjs";
import * as C from "./lib/checks.mjs";
import { readPng } from "./lib/png.mjs";

const TMP = join(ROOT, ".gate-tmp");
const results = [];
const gate = (name, fn) => {
  let problems;
  try { problems = fn(); } catch (e) { problems = ["threw: " + (e && e.stack || e)]; }
  if (problems && typeof problems.then === "function") throw new Error("use gateAsync for " + name);
  record(name, problems);
};
const gateAsync = async (name, fn) => {
  let problems;
  try { problems = await fn(); } catch (e) { problems = ["threw: " + (e && e.stack || e)]; }
  record(name, problems);
};
function record(name, problems) {
  const ok = !problems || problems.length === 0;
  results.push({ name, ok, problems });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) for (const p of problems.slice(0, 6)) console.log("        " + p);
}
// A mutation gate passes only when the check CATCHES the injected fault.
const mutation = (name, site, mutate, check) => gate("mutation: " + name, () => {
  const m = structuredClone(site);
  mutate(m);
  const caught = check(m);
  return caught.length ? [] : ["mutation survived: check did not fail"];
});

const walk = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};

function loadSite(dir) {
  const site = { html: readFileSync(join(dir, "index.html"), "utf8"), css: {}, js: {}, svg: {}, files: walk(dir).map((f) => relative(dir, f).replace(/\\/g, "/")) };
  for (const f of site.files) {
    if (f.endsWith(".css")) site.css[f] = readFileSync(join(dir, f), "utf8");
    else if (f.endsWith(".js")) site.js[f] = readFileSync(join(dir, f), "utf8");
    else if (f.endsWith(".svg")) site.svg[f] = readFileSync(join(dir, f), "utf8");
  }
  return site;
}

// ---- register variants, derived from whatever the register says right now ----
const FIXTURE_ADDRESS = "So11111111111111111111111111111111111111112";
const HOSTS = { x: "x.com", github: "github.com" };
function variant(reg, want) {
  const r = structuredClone(reg);
  for (const [id, rec] of Object.entries(r.records)) {
    if (rec.kind !== "address" && rec.kind !== "social") continue;
    delete rec.value; delete rec.url; delete rec.urls;
    if (want === "stated") {
      rec.state = "stated";
      if (rec.kind === "address") rec.value = FIXTURE_ADDRESS;
      else rec.url = `https://${HOSTS[id] || "example.invalid"}/statix_fixture`;
    } else rec.state = "absent";
  }
  return r;
}

const reg = loadRegister(join(ROOT, "register.json"));
const report = JSON.parse(readFileSync(join(ROOT, "scripts", "asset-report.json"), "utf8"));
const palette = [...new Set(Object.values(report).flatMap((f) => f.kmeans_snapped.map((c) => c.hex.toLowerCase())))];
const refLines = readFileSync(join(ROOT, "scripts", "ref-copy.txt"), "utf8").split("\n");

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// ================= build =================
let buildOk = true;
try { buildSite(reg, join(ROOT, "dist")); } catch (e) { buildOk = false; console.log(e.message); }
gate("build: dist/ produced from register.json", () => buildOk ? [] : ["build threw"]);
const dist = loadSite(join(ROOT, "dist"));
buildSite(variant(reg, "absent"), join(TMP, "absent"));
buildSite(variant(reg, "stated"), join(TMP, "stated"));
const absent = loadSite(join(TMP, "absent"));
const stated = loadSite(join(TMP, "stated"));
const absentReg = variant(reg, "absent"), statedReg = variant(reg, "stated");

gate("dist: required files present", () => ["index.html", "favicon.svg", "tokens.css", "styles.css", "js/main.js", "js/market.js", "js/market-core.js", "assets/logo-640.png", "assets/logo-1280.png", "assets/og.jpg", "assets/apple-touch-icon.png"].filter((f) => !dist.files.includes(f)).map((f) => "missing " + f));
gate("dist: repo files stay out (README, docs, LICENSE, register, scripts, brand)", () => dist.files.filter((f) => /^(README|LICENSE|docs\/|register\.json|scripts\/|brand\/|reference\/|package)/i.test(f)).map((f) => "leaked " + f));

// ================= register rules =================
gate("rule 1: register valid, inert records carry no value or url", () => validateRegister(reg));
gate("rule 1: every record has a known state and a label", () => Object.entries(reg.records).filter(([, r]) => !r.label || !r.state).map(([id]) => id + " incomplete"));
gate("register: dates live in register.json only (never in dist)", () => {
  const p = [];
  if (!Object.values(reg.records).every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.checked))) p.push("register records lack checked data");
  const blob = [dist.html, ...Object.values(dist.js), ...Object.values(dist.css)].join("\n");
  if (/"checked"/.test(blob)) p.push("checked key leaked to dist");
  return p;
});
for (const id of Object.keys(reg.records)) {
  gate(`rule 1 (${id}): forced-inert + payload is rejected`, () => {
    const r = structuredClone(reg); const rec = r.records[id];
    rec.state = "absent"; delete rec.value; delete rec.url; delete rec.urls;
    rec.value = "x"; rec.url = "https://example.invalid/";
    return validateRegister(r).length ? [] : ["validator accepted inert record with payload"];
  });
  gate(`rule 1 (${id}): forced-stated without payload is rejected`, () => {
    const r = structuredClone(reg); const rec = r.records[id];
    delete rec.value; delete rec.url; delete rec.urls; rec.state = "stated";
    return validateRegister(r).length ? [] : ["validator accepted stated record with no payload"];
  });
}

// ================= both branches proven =================
gate("branch ABSENT: CA slot inert, reads pending, no copy control", () => C.checkCa(absent, absentReg));
gate("branch STATED: CA slot shows full address with copy control", () => C.checkCa(stated, statedReg));
gate("branch ABSENT: X and GitHub icons rendered, inert, no href", () => C.checkSocials(absent, absentReg));
gate("branch STATED: X and GitHub links use stored URL, handle derived", () => C.checkSocials(stated, statedReg));
gate("branch ABSENT: no link without a stated record", () => C.checkNoUnstatedLinks(absent, absentReg));
gate("branch STATED: every external link backed by a stated record", () => C.checkNoUnstatedLinks(stated, statedReg));
gate("branch ABSENT: no x.com / github.com string anywhere", () => /x\.com|github\.com|twitter\.com/i.test(absent.html) ? ["found a social url"] : []);
gate("dist (real register): CA slot and socials consistent with register", () => [...C.checkCa(dist, reg), ...C.checkSocials(dist, reg)]);
gate("social icons in the DOM for both branches at every breakpoint (no hiding rules)", () => [...C.checkSocialsVisible(absent), ...C.checkSocialsVisible(stated)]);
gate("icons are the official X mark and Octicon mark-github", () => {
  const p = [];
  if (!absent.html.includes("M18.244 2.25h3.308l-7.227 8.26")) p.push("X mark path missing");
  if (!absent.html.includes("M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59")) p.push("Octicon path missing");
  if (/<svg[^>]*>[^<]*<text/.test(absent.html)) p.push("text label inside icon");
  return p;
});
gate("social controls carry no visible text label", () => {
  const p = [];
  for (const id of ["x", "github"]) for (const site of [absent, stated]) {
    const m = site.html.match(new RegExp(`<(a|span)\\b[^>]*data-record="${id}"[^>]*>([\\s\\S]*?)</\\1>`));
    if (!m) { p.push(id + " missing"); continue; }
    if (m[2].replace(/<svg[\s\S]*?<\/svg>/g, "").trim()) p.push(id + " has visible text");
  }
  return p;
});
gate("CA slot sits in the top header, before main content", () => [...C.checkCa(absent, absentReg)].filter((x) => /header|slot not/.test(x)));
gate("market markup identical in both branches (CA state has zero effect)", () => {
  const strip = (h) => h.replace(/<header class="topbar"[\s\S]*?<\/header>/, "").replace(/<script type="application\/json" id="register">[\s\S]*?<\/script>/, "");
  return strip(absent.html) === strip(stated.html) ? [] : ["page body differs outside the header"];
});
gate("market code never reads the contract record", () => {
  const src = [dist.js["js/market.js"], dist.js["js/market-core.js"]].join("\n");
  return /record\(\s*["']ca["']\s*\)|isStated\(\s*["']ca["']|main\.js|copy-ca/.test(src) ? ["market code touches CA state"] : [];
});
gate("market endpoints come from the market-source record only", () => {
  const src = dist.js["js/market.js"];
  const p = [];
  if (!/record\(\s*["']market-source["']\s*\)/.test(src)) p.push("market.js does not read market-source");
  if (/https?:\/\//.test(src) || /https?:\/\//.test(dist.js["js/market-core.js"].replace(/^\s*\/\/.*$/gm, ""))) p.push("endpoint hard-coded in js");
  return p;
});

// ================= gate warning (rule 3) =================
gate("rule 3: absent branch holds zero address-shaped strings", () => C.checkAddresses(absent, absentReg));
gate("rule 3: stated branch holds only the stated CA, CA slot exempt", () => C.checkAddresses(stated, statedReg));
gate("rule 3: scanner matches against the registry, never blanket-rejects 0x", () => {
  const p = [];
  const hex = "0x" + "ab12".repeat(10);
  if (C.scanAddresses(`pay ${hex}`, [hex]).length) p.push("rejected a stated 0x address");
  if (!C.scanAddresses(`pay ${hex}`, []).length) p.push("accepted an unstated 0x address");
  if (C.scanAddresses("plain 0x prefix text and 0xZZ", []).length) p.push("flagged non-address 0x text");
  if (C.scanAddresses(`mint ${FIXTURE_ADDRESS}`, [FIXTURE_ADDRESS]).length) p.push("rejected stated base58");
  if (!C.scanAddresses(`mint ${FIXTURE_ADDRESS}`, []).length) p.push("accepted unstated base58");
  return p;
});
gate("rule 3: dist (real register) address scan clean", () => C.checkAddresses(dist, reg));

// ================= dates =================
gate("no dates, clocks or 'as of' wording in dist (text, attributes, tooltips, aria, js, css content)", () => C.checkNoDates(dist));
gate("no dates in either branch variant", () => [...C.checkNoDates(absent), ...C.checkNoDates(stated)]);

// ================= palette (rule 4) =================
gate("rule 4: colour literals confined to tokens.css", () => C.checkHexConfined(dist));
gate("rule 4: every token hex is a sampled palette value with provenance coordinates", () => C.checkTokensInPalette(dist.css["tokens.css"], palette));
gate("rule 4: favicon is 32x32, traced path, palette colours, no double hyphen, no comment", () => C.checkFavicon(dist.svg["favicon.svg"], palette));
gate("rule 4: favicon colours equal the snapped logo pixels", () => {
  const fc = JSON.parse(readFileSync(join(ROOT, "scripts", "favicon-colors.json"), "utf8"));
  const svg = dist.svg["favicon.svg"];
  return [fc.white, fc.blue].filter((h) => !svg.includes(h)).map((h) => "missing " + h);
});

// ================= assets =================
gate("assets: every file in brand/ and reference/ was read (IHDR, alpha histogram, k-means)", () => {
  const p = [];
  const files = [...readdirSync(join(ROOT, "brand")), ...readdirSync(join(ROOT, "reference"))];
  if (Object.keys(report).length !== files.length) p.push(`report has ${Object.keys(report).length} entries for ${files.length} files`);
  for (const [k, v] of Object.entries(report)) {
    if (!v.alpha || !v.kmeans_snapped?.length || !v.format) p.push(k + " incomplete");
    if (v.format === "PNG" && (v.IHDR?.colortype === undefined)) p.push(k + " no IHDR colourtype");
    for (const c of v.kmeans_snapped) if (!Array.isArray(c.at)) p.push(k + " centroid not snapped to a pixel");
  }
  return p;
});
gate("assets: transparent logo holds pure-black transparent RGB, resize was premultiplied", () => {
  const p = [];
  const k = Object.keys(report).find((n) => n.endsWith("PNG...png"));
  if (!(report[k].pure_black_in_transparent > 1_000_000)) p.push("expected pure-black transparent region");
  for (const f of ["logo-640.png", "logo-1280.png"]) {
    const png = readPng(readFileSync(join(ROOT, "dist/assets", f)));
    if (png.ct !== 6) { p.push(f + " lost alpha"); continue; }
    let dark = 0, edge = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const a = png.data[i + 3];
      if (a > 0 && a < 255) { edge++; if ((png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3 < 60) dark++; }
    }
    if (edge === 0) p.push(f + " has no antialiased edge");
    else if (dark / edge > 0.12) p.push(`${f}: ${(100 * dark / edge).toFixed(1)}% of edge pixels are dark, black fringe`);
  }
  return p;
});

// ================= copy =================
gate("copy: zero shared 2-grams and zero shared content words with the reference", () => C.checkCopy(dist, refLines));

// ================= hygiene =================
const P = (...a) => new RegExp(a.join(""), "i");
gate("rule 5: no agent config, no attribution anywhere in the project", () => {
  const p = [];
  for (const n of ["CLA" + "UDE.md", ".cla" + "ude", "AGENTS.md", ".cursor"]) if (existsSync(join(ROOT, n))) p.push("exists: " + n);
  const bad = [P("cla", "ude"), P("anthro", "pic"), /\bA\.?I\b/, P("co-auth", "ored"), P("generated (with|by)"), P("chat", "gpt"), P("open", "ai\\b"), P("copi", "lot"), /\bLLM\b/];
  for (const f of walk(ROOT)) {
    const rel = relative(ROOT, f).replace(/\\/g, "/");
    if (/^(brand|reference|node_modules|\.gate-tmp)\//.test(rel)) continue;
    if (![".md", ".json", ".mjs", ".js", ".css", ".html", ".txt", ".py", ".svg"].includes(extname(f)) && !/LICENSE|\.gitignore/.test(rel)) continue;
    if (/^scripts\/ref-copy\.txt$/.test(rel)) continue;
    const t = readFileSync(f, "utf8");
    for (const re of bad) if (re.test(t)) p.push(`${rel}: matches ${re}`);
  }
  return p;
});
gate("repo content: README, whitepaper, LICENSE present and shaped as specified", () => {
  const p = [];
  const rd = join(ROOT, "README.md"), wp = join(ROOT, "docs/whitepaper.md"), lc = join(ROOT, "LICENSE");
  for (const f of [rd, wp, lc]) if (!existsSync(f)) p.push("missing " + relative(ROOT, f));
  if (p.length) return p;
  const r = readFileSync(rd, "utf8"), w = readFileSync(wp, "utf8"), l = readFileSync(lc, "utf8");
  if (!/\[!\[[^\]]*\]\(https:\/\/img\.shields\.io[^)]*\)\]\(https:\/\/statix\.bid\)/.test(r)) p.push("README: live site badge missing");
  for (const h of ["## Overview", "## Features", "## Links"]) if (!r.includes(h)) p.push("README: " + h);
  if (!/Solana/.test(r) || !/contract address/i.test(r)) p.push("README: chain / CA placeholder");
  for (const h of [/vision/i, /mission/i, /tokenomics/i, /roadmap/i, /phase 1/i, /phase 2/i, /phase 3/i, /team/i]) if (!h.test(w)) p.push("whitepaper: " + h);
  if (!/MIT License/.test(l) || !/Copyright \(c\) 2026 Statix/.test(l)) p.push("LICENSE: MIT / copyright line");
  return p;
});

// ================= mobile + motion statics =================
gate("mobile: no ch units anywhere", () => C.checkNoCh(dist));
gate("mobile: 44px tap-target floors declared for every interactive class", () => C.checkTapTargets(dist));
gate("motion: reduced-motion block zeroes animation/transition, every script checks it", () => C.checkMotionSources(dist));
gate("motion: spring solver is damped (zeta between 0.5 and 1) and settles", () => {
  const src = dist.js["js/spring.js"];
  const k = +src.match(/stiffness = (\d+)/)[1], c = +src.match(/damping = (\d+)/)[1];
  const z = c / (2 * Math.sqrt(k));
  return z > 0.5 && z <= 1 ? [] : ["zeta " + z.toFixed(2)];
});
gate("motion: reference easing and timings carried over (.2,.7,.2,1 / .34,1.56,.64,1)", () => {
  const t = dist.css["tokens.css"];
  return ["cubic-bezier(.2, .7, .2, 1)", "cubic-bezier(.34, 1.56, .64, 1)"].filter((s) => !t.includes(s)).map((s) => "missing " + s);
});
gate("visuals present: progress bar, live dot, spotlight, parallax, mesh, count-up, skeleton, ticker", () => {
  const all = dist.html + Object.values(dist.css).join("") + Object.values(dist.js).join("");
  return ["id=\"progress\"", "class=\"dot\"", ".spot::after", "initParallax", "class=\"mesh\"", "countTo", "skeleton", "id=\"ticker\"", "flash-up", "prefers-reduced-motion"].filter((s) => !all.includes(s)).map((s) => "missing " + s);
});

// ================= market behaviour (fixtures, real source modules) =================
const M = await import(pathToFileURL(join(ROOT, "dist/js/market-core.js")).href);
const addr = (i) => "T" + String(i).padStart(2, "0") + "x".repeat(40);
const boostsFx = [
  ...Array.from({ length: 13 }, (_, i) => ({ chainId: "solana", tokenAddress: addr(i), icon: i % 2 ? "https://img.example/" + i + ".png" : undefined })),
  { chainId: "ethereum", tokenAddress: "0x" + "ab".repeat(20) }, { chainId: "base", tokenAddress: "0x" + "cd".repeat(20) },
  { chainId: "solana", tokenAddress: addr(0) },
];
const pairsFx = (addrs) => addrs.flatMap((a, i) => {
  const n = +a.slice(1, 3);
  return [
    { chainId: "solana", baseToken: { address: a, symbol: "S" + n, name: "Name" + n }, priceUsd: String(0.5 + n), priceChange: { h24: n % 2 ? 12.5 : -3.2 }, volume: { h24: 1000 * (n + 1) }, liquidity: { usd: 500 }, info: n === 3 ? { imageUrl: "http://insecure.example/x.png" } : n === 4 ? {} : { imageUrl: "https://img.example/t" + n + ".png" } },
    { chainId: "solana", baseToken: { address: a, symbol: "S" + n, name: "Name" + n }, priceUsd: String(9 + n), priceChange: { h24: 1 }, volume: { h24: 10 }, liquidity: { usd: 9000 + n } },
  ];
});
gate("market: boosts filtered to Solana, deduplicated", () => {
  const a = M.solanaAddresses(boostsFx);
  const p = [];
  if (a.length !== 13) p.push("expected 13 solana addresses, got " + a.length);
  if (a.some((x) => x.startsWith("0x"))) p.push("non-solana leaked");
  return p;
});
gate("market: pairs chunked at 30, aggregate sums volume, price from deepest pool", () => {
  const p = [];
  if (M.chunk(Array.from({ length: 65 }, (_, i) => i), 30).map((c) => c.length).join() !== "30,30,5") p.push("chunking");
  const agg = M.aggregate(pairsFx(M.solanaAddresses(boostsFx)), new Set(M.solanaAddresses(boostsFx)));
  const t5 = agg.find((x) => x.symbol === "S5");
  if (t5.volume !== 6000 + 10) p.push("volume not summed: " + t5.volume);
  if (t5.price !== 14) p.push("price not from deepest pool: " + t5.price);
  if (t5.liquidity !== 500 + 9005) p.push("liquidity not summed");
  return p;
});
gate("market: top 10 by 24h volume, logo fallback null on missing or insecure imageUrl", () => {
  const addrs = M.solanaAddresses(boostsFx);
  const agg = M.aggregate(pairsFx(addrs), new Set(addrs), M.boostIcons(boostsFx));
  const top = M.topByVolume(agg);
  const p = [];
  if (top.length !== 10) p.push("not 10 rows");
  if (top.some((t, i) => i && top[i - 1].volume < t.volume)) p.push("not sorted by volume");
  if (top[0].symbol !== "S12") p.push("wrong leader " + top[0].symbol);
  const t3 = agg.find((x) => x.symbol === "S3");
  if (t3.image !== null && !t3.image?.startsWith("https://")) p.push("insecure image kept");
  if (agg.find((x) => x.symbol === "S4").image !== null) p.push("expected null image for tile fallback (no icon on even boost)");
  return p;
});
gate("market: formatters (subscript zeros, compact usd, pct, dash on null)", () => {
  const p = [];
  const eq = (a, b, n) => { if (a !== b) p.push(`${n}: got ${a} want ${b}`); };
  eq(M.formatPrice(null), "—", "price null");
  eq(M.formatPrice(1234.5), "$1,235", "price big");
  eq(M.formatPrice(1.5), "$1.50", "price one");
  eq(M.formatPrice(0.00000123), "$0.0₅123", "price tiny");
  eq(M.formatUsd(9_850_000), "$9.85M", "usd M");
  eq(M.formatUsd(37_000), "$37K", "usd K");
  eq(M.formatUsd(null), "—", "usd null");
  eq(M.formatPct(-99.411), "99.41%", "pct");
  eq(M.formatPct(null), "—", "pct null");
  eq(M.dirOf(-1), "dn", "dir"); eq(M.dirOf(2), "up", "dir"); eq(M.dirOf(null), "flat", "dir");
  return p;
});
await gateAsync("market: exponential backoff 1s,2s,4s,8s then rejects (caller keeps last good data)", async () => {
  const waits = [];
  let calls = 0;
  const ep = { boosts: "b", pairs: "p{addresses}" };
  let err = null;
  try { await M.loadTop(ep, async () => { calls++; throw new Error("down"); }, { sleep: async (ms) => { waits.push(ms); } }); } catch (e) { err = e; }
  const p = [];
  if (!err) p.push("did not reject");
  if (waits.join() !== "1000,2000,4000,8000") p.push("delays " + waits.join());
  if (calls !== 5) p.push("attempts " + calls);
  for (let i = 1; i < M.BACKOFF_MS.length; i++) if (M.BACKOFF_MS[i] !== M.BACKOFF_MS[i - 1] * 2) p.push("not doubling");
  return p;
});
await gateAsync("market: recovers after transient failures and returns ten rows", async () => {
  let n = 0;
  const waits = [];
  const getJson = async (u) => { if (n++ < 2) throw new Error("flaky"); return u === "b" ? boostsFx : pairsFx(decodeURIComponent(u.slice(1)).split(",")); };
  const top = await M.loadTop({ boosts: "b", pairs: "p{addresses}" }, getJson, { sleep: async (ms) => waits.push(ms) });
  return top.length === 10 && waits.join() === "1000,2000" ? [] : ["rows " + top.length + " waits " + waits];
});
gate("market: source resolved from register record only; absent record yields no endpoints", () => {
  const p = [];
  const rec = reg.records["market-source"];
  const ep = M.endpointsFrom(isStated(rec) ? { state: "stated", urls: rec.urls } : rec);
  if (isStated(rec) && (!ep || ep.boosts !== "https://api.dexscreener.com/token-boosts/top/v1" || ep.pairs !== "https://api.dexscreener.com/tokens/v1/solana/{addresses}")) p.push("endpoints differ from the brief");
  if (M.endpointsFrom({ state: "absent" }) !== null || M.endpointsFrom({ state: "unconfirmed" }) !== null) p.push("inert source produced endpoints");
  return p;
});
gate("market: poll every 60s, pause on hidden, fetch immediately when visible", () => {
  const src = dist.js["js/market.js"];
  const p = [];
  if (M.POLL_MS !== 60000) p.push("POLL_MS");
  if (!/visibilitychange/.test(src) || !/document\.hidden/.test(src)) p.push("no visibility handling");
  if (!/clearTimeout\(timer\);\s*cycle\(\)/.test(src)) p.push("no immediate fetch on visible");
  if (!/Showing last good data/.test(src)) p.push("no last-good-data path");
  if (!/DASH/.test(src) || !/errEl\.classList\.add\("show"\)/.test(src)) p.push("no dash + error path");
  return p;
});
gate("market: copy-per-address button on every row, letter tile fallback", () => {
  const src = dist.js["js/market.js"];
  return [/copybtn/, /copyText\(t\.address\)/, /ltr lt/, /img\.addEventListener\("error"/].filter((re) => !re.test(src)).map((re) => "missing " + re);
});

// ================= mutation harness: anchors read the current register, never fixed state =================
const siteForMutation = absent; // any branch works; anchors below never depend on state
for (const id of Object.keys(reg.records).filter((k) => reg.records[k].kind === "social")) {
  mutation(`social ${id}: strip icon`, siteForMutation, (s) => { s.html = s.html.replace(new RegExp(`(<(?:a|span)\\b[^>]*data-record="${id}"[^>]*>)<svg[\\s\\S]*?</svg>`), "$1"); }, (s) => C.checkSocials(s, absentReg));
  mutation(`social ${id}: flip link/inert contract`, siteForMutation, (s) => { s.html = s.html.replace(new RegExp(`(<(?:a|span)\\b[^>]*data-record="${id}")`), '$1 href="https://example.invalid/x"'); }, (s) => C.checkSocials(s, absentReg));
  mutation(`social ${id}: strip icon (stated render)`, stated, (s) => { s.html = s.html.replace(new RegExp(`(<(?:a|span)\\b[^>]*data-record="${id}"[^>]*>)<svg[\\s\\S]*?</svg>`), "$1"); }, (s) => C.checkSocials(s, statedReg));
  mutation(`social ${id}: wrong href (stated render)`, stated, (s) => { s.html = s.html.replace(new RegExp(`(data-record="${id}"[^>]*href=")[^"]*`), "$1https://example.invalid/other"); }, (s) => C.checkSocials(s, statedReg));
}
mutation("ca: live control injected into inert slot", absent, (s) => { s.html = s.html.replace(/(data-ca-slot[^>]*>)/, '$1<button type="button">x</button>'); }, (s) => C.checkCa(s, absentReg));
mutation("ca: payload removed from stated slot", stated, (s) => { s.html = s.html.replace(/ data-copy="[^"]*"/, ""); }, (s) => C.checkCa(s, statedReg));
mutation("ca: slot moved below main", absent, (s) => { const h = s.html.match(/<header class="topbar"[\s\S]*?<\/header>/)[0]; s.html = s.html.replace(h, "").replace("</main>", "</main>" + h); }, (s) => C.checkCa(s, absentReg));
for (const [label, snippet] of [["iso date", "<p>2026-01-01</p>"], ["clock", "<p>12:30</p>"], ["as of", "<p>as of today</p>"], ["year", "<p>since 2025</p>"], ["aria date", '<p aria-label="Oct 4">x</p>']]) {
  mutation(`date injected (${label})`, siteForMutation, (s) => { s.html = s.html.replace("</footer>", snippet + "</footer>"); }, (s) => C.checkNoDates(s));
}
mutation("date api in js", siteForMutation, (s) => { s.js["js/main.js"] += "\nconst t = Date.now();"; }, (s) => C.checkNoDates(s));
mutation("invented hex in css", siteForMutation, (s) => { s.css["styles.css"] += "\n.x{color:#123456}"; }, (s) => C.checkHexConfined(s));
mutation("invented hex in js", siteForMutation, (s) => { s.js["js/fx.js"] += '\nconst c = "#abcdef";'; }, (s) => C.checkHexConfined(s));
mutation("invented hex in token file", siteForMutation, (s) => { s.css["tokens.css"] = s.css["tokens.css"].replace("--blue: #2430fa;", "--blue: #2431fa;"); }, (s) => C.checkTokensInPalette(s.css["tokens.css"], palette));
mutation("rgb() literal in css", siteForMutation, (s) => { s.css["styles.css"] += "\n.x{color:rgb(1 2 3)}"; }, (s) => C.checkHexConfined(s));
mutation("unregistered base58 address in html", siteForMutation, (s) => { s.html = s.html.replace("</footer>", "<p>9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM</p></footer>"); }, (s) => C.checkAddresses(s, absentReg));
mutation("unregistered 0x address in html", siteForMutation, (s) => { s.html = s.html.replace("</footer>", "<p>0x" + "1f".repeat(20) + "</p></footer>"); }, (s) => C.checkAddresses(s, absentReg));
mutation("second address next to a stated CA", stated, (s) => { s.html = s.html.replace("</footer>", "<p>9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM</p></footer>"); }, (s) => C.checkAddresses(s, statedReg));
mutation("reference phrase pasted in", siteForMutation, (s) => { s.html = s.html.replace("</footer>", "<p>launch a token</p></footer>"); }, (s) => C.checkCopy(s, refLines));
mutation("reference word pasted in", siteForMutation, (s) => { s.html = s.html.replace("</footer>", "<p>quants</p></footer>"); }, (s) => C.checkCopy(s, refLines));
mutation("ch unit in css", siteForMutation, (s) => { s.css["styles.css"] += "\n.x{width:3ch}"; }, (s) => C.checkNoCh(s));
mutation("social hidden by css", siteForMutation, (s) => { s.css["styles.css"] += "\n@media (max-width: 720px){ .socials { display: none; } }"; }, (s) => C.checkSocialsVisible(s));
mutation("tap target shrunk", siteForMutation, (s) => { s.css["styles.css"] = s.css["styles.css"].replace(/(\.soc \{[^}]*?)width: 44px; height: 44px/, "$1width: 30px; height: 30px"); }, (s) => C.checkTapTargets(s));
mutation("reduced-motion block removed", siteForMutation, (s) => { s.css["styles.css"] = s.css["styles.css"].replace(/@media \(prefers-reduced-motion: reduce\)/, "@media (min-width: 99999px)"); }, (s) => C.checkMotionSources(s));
mutation("favicon double hyphen", siteForMutation, (s) => { s.svg["favicon.svg"] = s.svg["favicon.svg"].replace("<rect", "<!-- a -- b --><rect"); }, (s) => C.checkFavicon(s.svg["favicon.svg"], palette));
mutation("favicon off-palette colour", siteForMutation, (s) => { s.svg["favicon.svg"] = s.svg["favicon.svg"].replace("#2430fa", "#2431fa"); }, (s) => C.checkFavicon(s.svg["favicon.svg"], palette));
mutation("unstated outbound link", siteForMutation, (s) => { s.html = s.html.replace("</footer>", '<a href="https://example.invalid/">x</a></footer>'); }, (s) => C.checkNoUnstatedLinks(s, absentReg));

// ================= summary =================
rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length} gates, ${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
