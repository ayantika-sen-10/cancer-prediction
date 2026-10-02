// The dashboard has every section/container/table/theme hook, and script.js fills each one.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "cancer-prediction-website");
const html = readFileSync(resolve(dir, "index.html"), "utf8");
const js = readFileSync(resolve(dir, "script.js"), "utf8");
const errors = [];

const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
if (title.trim() !== "Cancer Cell Detection") errors.push(`title is "${title}"`);
if (!/class="brand"[\s\S]{0,900}Cancer Cell Detection/.test(html)) errors.push("brand bar does not say Cancer Cell Detection");

// Sections and the sidebar links that point at them.
const sections = ["overview", "detect", "dataset", "models", "about"];
for (const s of sections) {
  if (!new RegExp(`<section id="${s}"`).test(html)) errors.push(`missing <section id="${s}">`);
  if (!new RegExp(`<a href="#${s}"`).test(html)) errors.push(`sidebar has no link to #${s}`);
}

// Elements that script.js must fill: each has to exist in the page AND be referenced by the script.
const filled = [
  "hero-accuracy", "hero-label", "balance-bar", "balance-b", "balance-m",
  "kpi-rows", "kpi-malignant", "kpi-benign", "kpi-auc", "kpi-test",
  "model-select", "result-card", "diagnosis-result", "confidence-value", "prob-bar", "reading",
  "consensus-body", "consensus-summary", "neighbors-body",
  "scatter-chart", "map-canvas", "map-title",
  "hist-radius", "hist-texture", "stats-body", "hist-table-body", "corr-note",
  "accuracy-chart", "metrics-body", "model-cards", "steps-rows", "steps-models",
  "api-dot", "api-text", "theme-toggle",
];
for (const id of filled) {
  if (!new RegExp(`id="${id}"`).test(html)) errors.push(`index.html has no #${id}`);
  if (!new RegExp(`['"]${id}['"]`).test(js)) errors.push(`script.js never uses #${id}`);
}

// Accessibility/structure: tables named, charts described, a table alternative to the histograms.
const tables = (html.match(/<table[^>]*aria-label="[^"]+"/g) ?? []).length;
if (tables < 5) errors.push(`only ${tables} labelled tables, expected at least 5`);
if (!js.includes("role: 'table', 'aria-label': 'Confusion matrix'")) errors.push("confusion matrices are not exposed as labelled tables");
const described = (html.match(/role="img"[^>]*aria-label="[^"]+"/g) ?? []).length;
if (described < 5) errors.push(`only ${described} described charts, expected at least 5`);
if (!/<details>[\s\S]*histogram data as a table/i.test(html)) errors.push("no table alternative for the histograms");

// Dark mode hook and the two class colours.
const css = readFileSync(resolve(dir, "style.css"), "utf8");
if (!/\[data-theme="dark"\]/.test(css) || !/prefers-color-scheme:\s*dark/.test(css)) errors.push("style.css lacks dark mode");
if (!/--class-b:\s*#2a78d6/i.test(css) || !/--class-m:\s*#eb6834/i.test(css)) errors.push("light class colours are not the validated #2a78d6 / #eb6834");
if (!/--class-b:\s*#3987e5/i.test(css) || !/--class-m:\s*#d95926/i.test(css)) errors.push("dark class colours are not the validated #3987e5 / #d95926");
if (!/setAttribute\('data-theme'/.test(js)) errors.push("script.js does not switch the theme");

if (errors.length) {
  console.log("FAIL:\n - " + errors.join("\n - "));
  process.exit(1);
}
console.log(`UI VERIFIED: ${sections.length} sections, ${filled.length} script-filled elements, ${tables} tables, ${described} described charts, dark mode`);
