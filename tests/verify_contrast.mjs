// WCAG contrast of the colour tokens in style.css, computed from the CSS variables (light and dark).
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "cancer-prediction-website", "style.css"), "utf8");

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Controls: known ratios must come out right, or the pass below means nothing.
if (Math.abs(ratio("#000000", "#ffffff") - 21) > 0.01 || ratio("#777777", "#888888") > 1.5) {
  console.log("FAIL: contrast calculator control failed");
  process.exit(1);
}

const block = (re) => {
  const m = css.match(re);
  if (!m) { console.log("FAIL: could not find theme block " + re); process.exit(1); }
  const vars = {};
  for (const v of m[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[v[1]] = v[2];
  return vars;
};
const themes = {
  light: block(/\n:root\s*\{([^}]*)\}/),
  dark: block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/),
};

// [foreground token, background token, minimum ratio, why]
const PAIRS = [
  ["text", "surface", 4.5, "body text on cards"], ["text", "bg", 4.5, "body text on page"], ["text", "surface-2", 4.5, "text on inset panels"],
  ["text-2", "surface", 4.5, "secondary text on cards"], ["text-2", "bg", 4.5, "secondary text on page"], ["text-2", "surface-2", 4.5, "secondary text on panels"],
  ["text-3", "surface", 4.5, "muted text on cards"], ["text-3", "bg", 4.5, "muted text on page"], ["text-3", "surface-2", 4.5, "muted text on panels"],
  ["accent", "surface", 4.5, "links and active nav text"], ["accent", "accent-soft", 4.5, "active nav on its tint"],
  ["accent-ink", "accent", 4.5, "primary button label"],
  ["class-b", "surface", 3, "benign marks (graphics)"], ["class-m", "surface", 3, "malignant marks (graphics)"],
];
const errors = [];
let worst = 99;
for (const [name, vars] of Object.entries(themes)) {
  for (const [fg, bg, min, why] of PAIRS) {
    if (!vars[fg] || !vars[bg]) { errors.push(`${name}: token --${!vars[fg] ? fg : bg} missing`); continue; }
    const r = ratio(vars[fg], vars[bg]);
    if (r >= min) worst = Math.min(worst, r / min);
    else errors.push(`${name}: ${why}: --${fg} ${vars[fg]} on --${bg} ${vars[bg]} is ${r.toFixed(2)}:1, need ${min}:1`);
  }
}
if (errors.length) {
  console.log("FAIL:\n - " + errors.join("\n - "));
  process.exit(1);
}
console.log(`CONTRAST VERIFIED: ${PAIRS.length} token pairs x 2 themes pass (tightest margin ${(worst * 100 - 100).toFixed(0)}% above its minimum)`);
