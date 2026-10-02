# Cancer Cell Detection (college project)

Educational demo only — not medical advice.

```
cancer_data.csv ──┬──► backend/train_model.py ──► backend/models/*.pkl   (only the fitted models)
                  │                                      │
                  └──► backend/app.py (Flask) ◄──────────┘   reads the CSV at startup and computes
                              │                              samples, statistics, accuracy, ROC ... itself
dashboard (HTML/CSS/JS) ◄─ JSON
```

Inputs: `radius_mean`, `texture_mean`. Target: `diagnosis` (M/B). Six models from
`ml50cancer.py` are trained on the real 569-row CSV (80/20 split, `random_state=0`).

## Run

```bash
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt     # Windows
python backend/train_model.py                      # creates backend/models/*.pkl (needed once, and after any CSV change)
python backend/app.py                              # http://localhost:5000
```

The dashboard is driven by `cancer_data.csv`: the server reads it when it starts, and every sample, statistic and
accuracy figure is computed from those rows. If you edit the CSV, the server refuses to start until you run
`python backend/train_model.py` again, so the models and the data can never silently disagree.

Open <http://localhost:5000>. Flask serves the dashboard and the API from one address.
Set `PORT=5001` to use another port. Charts are drawn by the project's own `charts.js`
(SVG + canvas) and the Inter font is self-hosted in `cancer-prediction-website/fonts/` (SIL Open Font License), so the page needs no internet connection.

## Dashboard

| Section | What it shows (all computed from the data) |
|---|---|
| Overview | best accuracy, class balance, sample counts, best AUC, test-set size |
| Detect | prediction, probabilities, percentile reading, six-model consensus, 5 nearest samples, scatter with your cell, decision map |
| Dataset | histograms and per-class statistics of radius and texture |
| Models | accuracy chart, metrics table, per-model confusion matrix and ROC curve |
| About | pipeline, what the measurements mean, limits |

Colours: Benign = blue, Malignant = orange (colour-blind-safe, light and dark themes).

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/models` | models + accuracy/precision/recall/F1/AUC, confusion matrix, ROC, dataset counts |
| GET | `/api/dataset` | all samples, per-class statistics, histograms |
| GET | `/api/boundary?model=knn&res=60` | P(malignant) grid for the decision map |
| POST | `/predict` | body `{"radius_mean": 15, "texture_mean": 10, "model": "knn"}` (`model` optional, defaults to the most accurate); returns diagnosis, probabilities, `consensus` of all models and the `nearest` training samples |

## Checks

```bash
.venv\Scripts\python tests\verify_training.py
.venv\Scripts\python tests\verify_api.py
.venv\Scripts\python tests\verify_live.py
node tests\verify_frontend.mjs
node tests\verify_text.mjs
node tests\verify_ui.mjs
```

Only load `.pkl` files you trained yourself — pickle can run code when loaded.
