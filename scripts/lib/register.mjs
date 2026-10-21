import { readFileSync } from "node:fs";

export const STATES = ["stated", "absent", "unconfirmed"];
export const isStated = (rec) => rec && rec.state === "stated";

export function loadRegister(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Rule 1: an inert record (absent / unconfirmed) never carries a value or a url.
export function validateRegister(reg) {
  const problems = [];
  for (const [id, rec] of Object.entries(reg.records)) {
    if (!STATES.includes(rec.state)) problems.push(`${id}: bad state ${rec.state}`);
    if (!isStated(rec)) {
      for (const k of ["value", "url", "urls"]) {
        if (k in rec) problems.push(`${id}: inert record carries ${k}`);
      }
    } else {
      const payload = rec.value ?? rec.url ?? rec.urls;
      if (payload == null || payload === "") problems.push(`${id}: stated record has no payload`);
    }
  }
  return problems;
}

// The page only ever sees the public view: no dates, no provenance internals.
export function publicView(reg) {
  const out = {};
  for (const [id, rec] of Object.entries(reg.records)) {
    const { checked, source, scope, ...rest } = rec;
    out[id] = rest;
  }
  return out;
}

// Rule 2: store the URL, derive the handle.
export function handleFromUrl(url) {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean)[0];
    return seg || null;
  } catch {
    return null;
  }
}

export const BASE58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
export const HEX40 = /0x[0-9a-fA-F]{40}/g;
