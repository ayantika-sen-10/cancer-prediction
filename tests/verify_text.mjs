// Banned wording must not appear anywhere user-facing or in the README/tests.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BANNED = /breast|patient|tumou?r|wisconsin/i;
const scan = (text) => (text.match(new RegExp(BANNED, "gi")) ?? []).map((s) => s.toLowerCase());

// Positive control: the scanner must flag known-bad text, or an empty result proves nothing.
const control = scan("Breast Cancer Patient tumor Wisconsin");
if (control.length !== 4) {
  console.log(`FAIL: scanner control found ${control.length} of 4 banned words`);
  process.exit(1);
}

// This file lists the banned words itself, so it is the only file excluded.
const files = [
  "cancer-prediction-website/index.html",
  "cancer-prediction-website/script.js",
  "cancer-prediction-website/charts.js",
  "cancer-prediction-website/style.css",
  "README.md",
  "tests/verify_live.py",
  "tests/verify_frontend.mjs",
  "tests/verify_ui.mjs",
  "tests/verify_api.py",
  "tests/verify_training.py",
  "backend/app.py",
  "backend/data.py",
  "backend/evaluate.py",
  "tests/verify_source.py",
  "backend/train_model.py",
];
const hits = [];
for (const f of files) {
  const lines = readFileSync(resolve(root, f), "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const w of scan(line)) hits.push(`${f}:${i + 1} "${w}"`);
  });
}
if (hits.length) {
  console.log("FAIL: banned wording found:\n - " + hits.join("\n - "));
  process.exit(1);
}
console.log(`TEXT VERIFIED: scanner control flagged 4/4, ${files.length} files clean`);
