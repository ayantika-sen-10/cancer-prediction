// Static checks on the website files.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "cancer-prediction-website");
const html = readFileSync(resolve(dir, "index.html"), "utf8");
const js = readFileSync(resolve(dir, "script.js"), "utf8");
const charts = readFileSync(resolve(dir, "charts.js"), "utf8");
const css = readFileSync(resolve(dir, "style.css"), "utf8");
const errors = [];

// Every referenced stylesheet/script must be local and exist (no CDN: works offline and in Colab).
const refs = [...html.matchAll(/<(?:link[^>]*href|script[^>]*src)="([^"]+)"/g)].map((m) => m[1]);
for (const need of ["style.css", "charts.js", "script.js"]) if (!refs.includes(need)) errors.push(`index.html does not reference ${need}`);
for (const r of refs) {
  if (/^(https?:)?\/\//.test(r)) errors.push(`index.html loads external resource ${r}`);
  else if (!existsSync(resolve(dir, r))) errors.push(`index.html references missing file ${r}`);
}
if (/@import|url\(\s*['"]?https?:/.test(css)) errors.push("style.css pulls in an external resource");

// The hand-copied dataset must be gone: no rows like [17.99, 10.38, 1], no in-browser model.
const rows = js.match(/\[\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[01]\s*\]/g) ?? [];
if (rows.length > 0) errors.push(`script.js still embeds ${rows.length} training rows`);
if (/trainingData|function predictDiagnosis/.test(js)) errors.push("script.js still has the in-browser KNN");

for (const path of ["/predict", "/api/models", "/api/dataset", "/api/boundary"]) {
  if (!js.includes(path)) errors.push(`script.js never calls ${path}`);
}
if (!/method:\s*'POST'/.test(js)) errors.push("script.js does not POST to /predict");
if (!/id="model-select"/.test(html)) errors.push("index.html has no model selector");
for (const fn of ["scatter", "histogram", "hbars", "roc", "decisionMap"]) {
  if (!new RegExp(`function ${fn}\\b`).test(charts)) errors.push(`charts.js is missing ${fn}()`);
  if (!new RegExp(`Charts\\.${fn}\\(`).test(js)) errors.push(`script.js never draws Charts.${fn}()`);
}

if (errors.length) {
  console.log("FAIL:\n - " + errors.join("\n - "));
  process.exit(1);
}
console.log("FRONTEND VERIFIED: local assets only, no embedded data, 4 API calls, 5 chart types drawn");
