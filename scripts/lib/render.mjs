import { readFileSync } from "node:fs";
import { isStated, publicView, handleFromUrl } from "./register.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const ICONS = {
  // official X mark
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  // official GitHub Octicon mark-github-16
  github: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>',
};

export function renderCa(rec) {
  if (isStated(rec)) {
    const v = esc(rec.value);
    return `<div class="ca" data-record="ca" data-state="stated" data-ca-slot>
    <span class="ca-label">${esc(rec.label)}</span>
    <button type="button" class="ca-copy" id="ca-copy" data-copy="${v}" aria-label="Copy contract address"><code class="ca-value">${v}</code><span class="ca-hint" data-idle="Copy" data-done="Copied"></span></button>
  </div>`;
  }
  return `<div class="ca is-inert" data-record="ca" data-state="${esc(rec.state)}" data-ca-slot aria-disabled="true">
    <span class="ca-label">${esc(rec.label)}</span><span class="ca-value">pending</span>
  </div>`;
}

export function renderSocial(id, rec) {
  const icon = ICONS[id];
  if (isStated(rec)) {
    const handle = handleFromUrl(rec.url);
    const name = id === "x" ? "X" : "GitHub";
    const label = handle ? `Statix on ${name}, ${handle}` : `Statix on ${name}`;
    return `<a class="soc" data-record="${id}" data-state="stated" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)}">${icon}</a>`;
  }
  return `<span class="soc is-inert" data-record="${id}" data-state="${esc(rec.state)}" role="img" aria-disabled="true" aria-label="${esc(rec.label)}, pending">${icon}</span>`;
}

export function renderSocials(reg) {
  return `<div class="socials">${renderSocial("x", reg.records.x)}${renderSocial("github", reg.records.github)}</div>`;
}

export function renderSkeletonRows(n = 10) {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += `<div class="mrow skeleton" role="row" data-row="${i}"><span class="rk">${i + 1}</span><div class="tok"><span class="sk circle"></span><span class="sk" style="width:55%"></span></div><div class="m"><span class="r" data-l="Price"><span class="sk"></span></span><span class="r" data-l="Change"><span class="sk"></span></span><span class="r" data-l="Volume"><span class="sk"></span></span><span class="r" data-l="Depth"><span class="sk"></span></span></div><span class="cpcell"></span></div>`;
  }
  return out;
}

export function renderTickerSkeleton() {
  let out = "";
  for (let i = 0; i < 12; i++) out += `<span class="tk"><span class="sk circle" style="width:20px;height:20px"></span><span class="sk"></span></span>`;
  return out;
}

export function themeColor(tokensCss) {
  const m = tokensCss.match(/--black:\s*(#[0-9a-fA-F]{6})/);
  return m ? m[1] : "";
}

export function renderPage(template, reg, tokensCss) {
  const rpcHost = isStated(reg.records.rpc) ? new URL(reg.records.rpc.url).hostname : "pending";
  const chain = isStated(reg.records.chain) ? reg.records.chain.value : "pending";
  const pub = JSON.stringify({ records: publicView(reg) }).replace(/</g, "\\u003c");
  return template
    .replace("{{theme_color}}", themeColor(tokensCss))
    .replace("{{ca}}", renderCa(reg.records.ca))
    .replace("{{socials}}", renderSocials(reg))
    .replace("{{chain}}", esc(chain))
    .replace("{{rpc_host}}", esc(rpcHost))
    .replace("{{skeleton_rows}}", renderSkeletonRows(10))
    .replace("{{ticker_skeleton}}", renderTickerSkeleton())
    .replace("{{register_json}}", pub);
}

export const readText = (p) => readFileSync(p, "utf8");
