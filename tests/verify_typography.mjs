// Typography rules for the stylesheet and the chart code.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "cancer-prediction-website");
const read = (f) => readFileSync(resolve(dir, f), "utf8");

const MIN_PX = 12, MAX_WEIGHT = 700, MIN_LINE_HEIGHT = 1.5;

// Each scanner returns a list of problems for one text.
const smallSizes = (text) => [...text.matchAll(/font-size:\s*([\d.]+)px/g)].filter((m) => +m[1] < MIN_PX).map((m) => `font-size ${m[1]}px`)
    .concat([...text.matchAll(/['"`](?:[a-z ]*\s)?([\d.]+)px\s+['"` ]?/g)].filter((m) => +m[1] < MIN_PX && /ctx\.font|font\s*=/.test(text.slice(Math.max(0, m.index - 14), m.index))).map((m) => `canvas font ${m[1]}px`));
const heavyWeights = (text) => [...text.matchAll(/font-weight:\s*(\d+)/g)].filter((m) => +m[1] > MAX_WEIGHT).map((m) => `font-weight ${m[1]}`);
const emoji = (text) => [...text.matchAll(/\p{Extended_Pictographic}/gu)].map((m) => `emoji ${m[0]}`);
const smallEm = (text) => [...text.matchAll(/font-size:\s*(0?\.\d+)r?em/g)].filter((m) => +m[1] < 0.75).map((m) => `font-size ${m[1]}em`);

// Controls: each scanner must catch a known-bad sample.
const controls = [
  [smallSizes("a{font-size:11px}"), "11px"], [heavyWeights("a{font-weight:800}"), "800"],
  [emoji("Warning ⚠️ ok"), "emoji"], [smallEm("a{font-size:.6em}"), "0.6em"],
];
for (const [found, what] of controls) {
  if (found.length === 0) { console.log(`FAIL: scanner control did not flag ${what}`); process.exit(1); }
}

const css = read("style.css");
const errors = [];
for (const f of ["style.css", "charts.js", "script.js", "index.html"]) {
  const text = read(f);
  for (const p of [...smallSizes(text), ...smallEm(text), ...heavyWeights(text)]) errors.push(`${f}: ${p}`);
  if (f !== "style.css") for (const p of emoji(text)) errors.push(`${f}: ${p}`);
}
const body = css.match(/\nbody\s*\{[^}]*\}/)?.[0] ?? "";
const lh = +(body.match(/line-height:\s*([\d.]+)/)?.[1] ?? 0);
if (lh < MIN_LINE_HEIGHT) errors.push(`body line-height is ${lh}, need >= ${MIN_LINE_HEIGHT}`);
const bodyPx = +(body.match(/font-size:\s*([\d.]+)px/)?.[1] ?? 0);
if (bodyPx < 15) errors.push(`body font-size is ${bodyPx}px, need >= 15`);
if (!/td\.r[^{]*\{[^}]*tabular-nums|th\.r,\s*td\.r[^{]*\{[^}]*tabular-nums|\.num\s*\{[^}]*tabular-nums/.test(css)) errors.push("no tabular-nums rule for numeric table cells / .num");
if (!/text-wrap:\s*balance/.test(css)) errors.push("headings do not use text-wrap: balance");

if (errors.length) {
  console.log("FAIL:\n - " + errors.join("\n - "));
  process.exit(1);
}
console.log(`TYPOGRAPHY VERIFIED: sizes >= ${MIN_PX}px, weights <= ${MAX_WEIGHT}, body ${bodyPx}px/${lh}, tabular figures, no emoji (4 scanner controls passed)`);
