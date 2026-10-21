import { rmSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegister, validateRegister } from "./lib/register.mjs";
import { renderPage } from "./lib/render.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Builds the site for a given register object into outDir. Used by `npm run build` and by the gates.
export function buildSite(reg, outDir, { root = ROOT } = {}) {
  const problems = validateRegister(reg);
  if (problems.length) throw new Error("register invalid:\n  " + problems.join("\n  "));
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const src = join(root, "src");
  const tokens = readFileSync(join(src, "tokens.css"), "utf8");
  const html = renderPage(readFileSync(join(src, "index.template.html"), "utf8"), reg, tokens);
  writeFileSync(join(outDir, "index.html"), html);
  writeFileSync(join(outDir, "tokens.css"), tokens);
  cpSync(join(src, "styles.css"), join(outDir, "styles.css"));
  cpSync(join(src, "js"), join(outDir, "js"), { recursive: true });
  cpSync(join(src, "assets"), join(outDir, "assets"), { recursive: true });
  cpSync(join(src, "assets", "favicon.svg"), join(outDir, "favicon.svg"));
  writeFileSync(join(outDir, "_headers"), "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n");
  return outDir;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reg = loadRegister(join(ROOT, "register.json"));
  buildSite(reg, join(ROOT, "dist"));
  console.log("built dist/");
}
