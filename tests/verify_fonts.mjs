// Inter must ship with the project as a real WOFF2 file, be wired up correctly, and cover the characters the page uses.
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "cancer-prediction-website");
const read = (f) => readFileSync(resolve(dir, f), "utf8");
const css = read("style.css"), html = read("index.html"), js = read("script.js"), charts = read("charts.js");
const errors = [];

const isWoff2 = (buf) => buf.length > 4 && buf.subarray(0, 4).toString("latin1") === "wOF2";
// Controls: the detector must reject non-fonts, or a pass proves nothing.
if (isWoff2(Buffer.from("<html>not a font</html>")) || !isWoff2(Buffer.from("wOF2\0\0\0\0"))) {
  console.log("FAIL: WOFF2 detector control failed");
  process.exit(1);
}

const face = css.match(/@font-face\s*\{[^}]*\}/)?.[0] ?? "";
if (!/font-family:\s*["']?Inter["']?/i.test(face)) errors.push("no @font-face for Inter");
const srcPath = face.match(/url\(\s*["']?([^"')]+)["']?\s*\)/)?.[1];
if (!srcPath) errors.push("@font-face has no url()");
else if (/^(https?:)?\/\//.test(srcPath)) errors.push(`font is loaded from the internet: ${srcPath}`);
else if (!/format\(\s*["']woff2["']\s*\)/.test(face)) errors.push("@font-face src is not declared as woff2");
if (!/font-display:\s*swap/.test(face)) errors.push("@font-face lacks font-display: swap");
if (!/font-weight:\s*100\s+900/.test(face)) errors.push("@font-face is not the variable 100-900 weight range");

if (srcPath && !/^(https?:)?\/\//.test(srcPath)) {
  const file = resolve(dir, srcPath);
  if (!existsSync(file)) errors.push(`font file ${srcPath} does not exist`);
  else {
    const buf = readFileSync(file);
    if (!isWoff2(buf)) errors.push(`${srcPath} is not a WOFF2 file`);
    if (statSync(file).size < 20000) errors.push(`${srcPath} is only ${statSync(file).size} bytes - too small to be Inter`);
  }
}
const lic = existsSync(resolve(dir, "fonts/Inter-LICENSE.txt")) ? read("fonts/Inter-LICENSE.txt") : "";
if (!/SIL OPEN FONT LICENSE/i.test(lic)) errors.push("fonts/Inter-LICENSE.txt missing or not the SIL Open Font License");

// Font stack: Inter first, then a system UI fallback, ending in a generic family.
const stack = css.match(/--font:\s*([^;]+);/)?.[1] ?? "";
if (!/^\s*["']?Inter/i.test(stack) || !/system-ui/.test(stack) || !/sans-serif\s*$/.test(stack.trim())) errors.push(`--font stack is "${stack.trim()}"`);
if (!/font-family:\s*var\(--font\)/.test(css)) errors.push("body does not use var(--font)");

// Nothing may pull a font from a CDN.
for (const [name, text] of [["style.css", css], ["index.html", html], ["script.js", js], ["charts.js", charts]]) {
  if (/fonts\.googleapis|fonts\.gstatic|use\.typekit|cdnjs[^"']*font/i.test(text)) errors.push(`${name} references an online font service`);
}

// Glyph coverage: every non-ASCII character in the page must be inside the font's declared unicode-range.
const range = face.match(/unicode-range:\s*([^;]+);/)?.[1] ?? "";
const spans = [...range.matchAll(/U\+([0-9A-F]+)(?:-([0-9A-F]+))?/gi)].map((m) => [parseInt(m[1], 16), parseInt(m[2] ?? m[1], 16)]);
if (!spans.length) errors.push("@font-face has no unicode-range, so missing glyphs cannot be detected");
const covered = (cp) => cp < 128 || spans.some(([a, b]) => cp >= a && cp <= b);
const missing = new Set();
for (const text of [html, js, charts]) for (const ch of text) if (!covered(ch.codePointAt(0))) missing.add(`${ch} (U+${ch.codePointAt(0).toString(16).toUpperCase()})`);
if (missing.size) errors.push(`characters outside Inter's unicode-range: ${[...missing].join(", ")}`);

if (errors.length) {
  console.log("FAIL:\n - " + errors.join("\n - "));
  process.exit(1);
}
console.log(`FONTS VERIFIED: local WOFF2 (${Math.round(statSync(resolve(dir, srcPath)).size / 1024)} KB) + licence, stack "${stack.trim().slice(0, 40)}...", no online fonts, glyph coverage OK`);
