# Gates: cancer cell detection - pkl models + Flask API + analytics dashboard

OWNS: backend/**, tests/**, cancer-prediction-website/**, requirements.txt, README.md

Scope (amended 2026-10-03: the CSV is the single data source; no samples.json/metrics.json): six notebook models trained on the real CSV and saved as .pkl; a Flask API that also serves dataset analytics, per-model evaluation (confusion matrix, ROC/AUC), nearest training samples, a six-model consensus and a decision map; and a full dashboard redesign of the website (sidebar layout, KPI tiles, scatter, histograms, model cards, decision map, dark mode) in which every number and chart comes from the data, not from typed-in values. No "Breast"/"Patient"/"Tumor"/"Wisconsin" wording anywhere.

- [x] G1: train_model.py writes only the six .pkl model bundles (stamped with a fingerprint of the CSV values), and the accuracy, AUC, confusion matrices, ROC curves and dataset counts the app computes from the CSV match an independent recomputation
  CHECK: .venv\Scripts\python.exe tests\verify_training.py
  EXPECT: TRAINING VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=b639779927f6b1c4642db7e5ac201302ecd99064e337457c5142ed81b9cd972a; exit=0; EXPECT=matched; output-sha256=d3dd09401712e16018ce2f138a0b1dbb8163a734ce9ae056ed6fd0cfa8cd61ab; output-bytes=122; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\akashroy8\Documents\PROJECTS\PERSONAL PROJECTS\cancer-prediction; path=edb571b0876c/56 entries

- [x] G2: Flask API (test client) predicts with every model, returns nearest samples and a six-model consensus, serves /api/dataset and /api/boundary with numbers that match independent recomputation, and rejects bad input with HTTP 400
  CHECK: .venv\Scripts\python.exe tests\verify_api.py
  EXPECT: API VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=23bb5709781087253fbd5be3eb4332c609265b0234543cea9ce0a9c9f07afe63; exit=0; EXPECT=matched; output-sha256=bcccfa24353add3c49dfe1065889b67255f20a0603a489d36ab76810feb18ac1; output-bytes=145; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\akashroy8\Documents\PROJECTS\PERSONAL PROJECTS\cancer-prediction; path=edb571b0876c/56 entries

- [x] G3: a real server on a free port answers real HTTP for the page, every asset, /api/models, /api/dataset, /api/boundary and /predict, matches the CSV rows, and leaves no process behind
  CHECK: .venv\Scripts\python.exe tests\verify_live.py
  EXPECT: LIVE SERVER VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=d2155cc8b39951392d9dd51343168cc980ca0c1ebd84464a74e4c29d1a9a170f; exit=0; EXPECT=matched; output-sha256=8384935da4ad1637e1f558a68801f847da7ae21208bc39be01ac23b385cb5b08; output-bytes=209; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\akashroy8\Documents\PROJECTS\PERSONAL PROJECTS\cancer-prediction; path=edb571b0876c/56 entries

- [x] G4: frontend links only existing local files, has no embedded training array, no external runtime dependency, and calls /predict, /api/models, /api/dataset and /api/boundary
  CHECK: node tests\verify_frontend.mjs
  EXPECT: FRONTEND VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=517862d35583e98ab0fd9d5a2b96725db36b679333416bc23b75bac3eca39e03; exit=0; EXPECT=matched; output-sha256=6aa835682e558ab43262eb2e14459c50ad196ab2459345bbd060159b30748fc4; output-bytes=89; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\akashroy8\Documents\PROJECTS\PERSONAL PROJECTS\cancer-prediction; path=edb571b0876c/56 entries

- [x] G5: banned words (Breast, Patient, Tumor, Wisconsin) appear nowhere user-facing or in README/tests, proven by a scanner control first
  CHECK: node tests\verify_text.mjs
  EXPECT: TEXT VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=46c31faf5c4ff15dc34bd96d18f097a19774bb0877a5b50585f24252a1abb365; exit=0; EXPECT=matched; output-sha256=4d64f466251164fdb7e07c2ef326f2a807a2751ee957e6903837f7af37439bfd; output-bytes=59; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\akashroy8\Documents\PROJECTS\PERSONAL PROJECTS\cancer-prediction; path=edb571b0876c/56 entries

- [x] G6: the dashboard has every required section, chart container, table and theme hook, and script.js fills each one from the API
  CHECK: node tests\verify_ui.mjs
  EXPECT: UI VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=ae707118cca038571a09ffbd75c90077ec4dab22cb7fe72785e3162bcc4b6523; exit=0; EXPECT=matched; output-sha256=198a1352389a979a0350e17d9ef8c451d20f62c64b12df6c6294aa7cb2dd3f7e; output-bytes=92; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\akashroy8\Documents\PROJECTS\PERSONAL PROJECTS\cancer-prediction; path=edb571b0876c/56 entries

- [x] G7: the class colours (blue Benign, orange Malignant) pass the dataviz palette validator in light and dark mode
  EVIDENCE: 2026-10-01 ran the dataviz validate_palette.js on the class colours with --pairs all. Light (#2a78d6 Benign, #eb6834 Malignant) on #fcfcfb: ALL CHECKS PASS, worst CVD dE 24.7 protan / 32.7 tritan, normal-vision dE 33.6, contrast >=3:1. Dark (#3987e5, #d95926) on #1a1a19: ALL CHECKS PASS, CVD dE 26.8, normal-vision 31.8. verify_ui.mjs additionally pins these exact hex values in style.css. Not validated: the violet accent and grey bar colour (used for UI chrome and single-series bars, not for class identity).

- [x] G8: in a real browser the dashboard renders every chart with non-empty marks, a prediction updates the scatter, neighbours, consensus and decision map, and the numbers shown match the API
  EVIDENCE: 2026-10-01 built-in browser against a fresh server (ports 5078/5079, not the stale 5000). Counts: 569 scatter dots, 17/21 histogram bars, 6 accuracy bars, 6 model cards each with a confusion matrix and ROC svg, 6 metrics rows, 4 stats rows, map canvas 479x345 with 26402 non-background sample pixels, API pill 'API connected - 6 models', hero 90.4%, KPIs 569/212/357/0.961/114, no console errors. Input 15.78/17.98: Malignant 61.6% (B 38.4 / M 61.6), all 6 models agree malignant, 5 nearest = ids 84610002, 869104, 854039, 9010872, 886776 (same as independent brute force in verify_api), scatter showed 1 'Your cell' marker + 5 neighbour rings + 5 lines, decision map title/note updated. Radius 5 gave the out-of-range warning. Presets filled real class medians (12.2/17.39 -> Benign, 17.325/21.46 -> Malignant, all models agree). Changing the model to Random Forest re-ran the prediction and redrew the map. Screenshots viewed: overview, detect form/result/consensus/neighbours, scatter, decision map, histogram, accuracy chart + metrics table, model cards. Not seen in a screenshot: the stats table and the About section (verified only by DOM counts / text). The screenshot tool was unreliable (frequent timeouts/blank frames), so some views were confirmed by DOM metrics rather than by eye.

- [x] G9: the dashboard renders correctly at desktop and phone width and in dark mode (no horizontal overflow, readable text)
  EVIDENCE: 2026-10-01 built-in browser. Dark theme (OS default in the pane) viewed at 800 and 1024 px wide: sidebar, active-section highlight, cards and charts readable. Phone 375x812, dark and light: documentElement.scrollWidth = 375 = viewport (no horizontal overflow), single-column detect layout (347px), scatter svg 313px and map canvas 311px wide; only the horizontally scrollable nav row extends past the edge by design. Theme toggle switched to light (body rgb(243,243,241), class colours #2a78d6/#eb6834) and was saved to localStorage. Phone light-theme screenshot of the detect form and result viewed. Not checked: tablet width, real devices, print.

- [x] G10: Inter is shipped with the project as a real WOFF2 file with its licence, loaded by @font-face from a local path (font-display swap), with a system fallback stack, and no font is fetched from the internet
  CHECK: node tests\verify_fonts.mjs
  EXPECT: FONTS VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=0d12f174aa4e56947573020996dc353899c4e2f43ea95fe3363175fefd04add0; exit=0; EXPECT=matched; output-sha256=ede1008ce0922cedfeec6cf9439f47f33ce0c44f0bac632aaf86c54848b8ac4d; output-bytes=135; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\akashroy8\Documents\PROJECTS\PERSONAL PROJECTS\cancer-prediction; path=edb571b0876c/56 entries

- [x] G11: typography rules hold in style.css: no text below 12px, no weight above 700, body line-height 1.5 or more, tabular figures on table numbers, no emoji in the page or script
  CHECK: node tests\verify_typography.mjs
  EXPECT: TYPOGRAPHY VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=c17c2dc5da1f1b5f661178556cad37d738608a1484c81cb41ad951811c165de1; exit=0; EXPECT=matched; output-sha256=034a75e787e7202f6044307749bb9b209102d33f57a25fa20d17b68ea5e59554; output-bytes=122; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\akashroy8\Documents\PROJECTS\PERSONAL PROJECTS\cancer-prediction; path=edb571b0876c/56 entries

- [x] G12: every text colour token meets WCAG contrast (4.5:1, large text 3:1) against the surfaces it sits on, in light and dark, computed from the CSS variables
  CHECK: node tests\verify_contrast.mjs
  EXPECT: CONTRAST VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=b861fa4c99f0bdf1a61778ce6347b63a2cae40185288b79e0f1f64beb987216e; exit=0; EXPECT=matched; output-sha256=5b1638f965bc83e2aa8c661c115eabdd7947f0ef04fd6e24c3d2438b65870dac; output-bytes=89; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\akashroy8\Documents\PROJECTS\PERSONAL PROJECTS\cancer-prediction; path=edb571b0876c/56 entries

- [x] G13: in a real browser the page really renders in Inter (font loaded, not the fallback) in the page, the SVG charts and the canvas, in both themes
  EVIDENCE: 2026-10-01 built-in browser on a fresh server (port 5082) with the final CSS: document.fonts has one face, Inter, weight 100 900, status 'loaded'; document.fonts.check('600 16px Inter') = true. Computed font-family is Inter for body (15px/400), h2 (22px/650), hero number (64px/700), table cells (14px/500) and SVG chart text (12px/400); the canvas context font is '500 12px Inter, ...'. A canvas text-width probe of the same string gave Inter 591px vs Segoe UI 550px vs Arial 567px, so Inter (not the fallback) is what draws. Weights in use: 400, 500, 600, 650, 700; text sizes 12-64px. On phone width no visible text used a non-Inter family (badFont 0) in either theme. No console errors. Font served as font/woff2 (verify_live G3). Not checked: Safari/Firefox rendering, installing the page on a PC with a policy that blocks @font-face.

- [x] G14: the restyled dashboard looks professional at desktop and phone width in light and dark (consistent spacing, readable type, no clipped or overlapping text)
  EVIDENCE: 2026-10-01 built-in browser, screenshots viewed: dark overview at 1180px wide (hero 90.4%, class balance, tiles, sidebar with section label and active indicator); light detect section (form, preset chips, result); light consensus table at 800px (class chips with tinted background and dot, selected-row highlight, uppercase table headers); phone 375px light detect result with model chips and reading panel. Measured on phone in both themes: scrollWidth 375 = viewport, 0 clipped headings/buttons/labels. Changes: Inter self-hosted, 12-64px scale, weights max 700, softer off-white text in dark, tinted class chips, 40px inputs/buttons with focus rings, backdrop-blurred top bar, emoji removed. Fixed two real defects found by the new checks: 11px text and 800 weights, and --text-3 contrast (4.34:1) on the page background. Not viewed after restyle: Dataset charts, Models cards and About section (the charts only changed font size; verified by G11/G13 numbers). Screenshot tool remained flaky. Tablet width and real devices not checked.

- [x] G15: the running app takes its data from cancer_data.csv itself: no samples.json/metrics.json exist or are referenced, /api/dataset equals the CSV rows exactly, the same CSV with different line endings is accepted, and a CSV edited after training (one value, or one label) makes the server refuse to start
  CHECK: .venv\Scripts\python.exe tests\verify_source.py
  EXPECT: SOURCE VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=4277247416a7e877672b48b64ba5c7ffbd3b86cbca265ec122d5ffdff5ec6b0e; exit=0; EXPECT=matched; output-sha256=4144d50c108365708e904508543a728647db9de5c021a3bd21123a6fdda19242; output-bytes=110; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\akashroy8\Documents\PROJECTS\PERSONAL PROJECTS\cancer-prediction; path=edb571b0876c/56 entries
