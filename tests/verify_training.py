"""Check the saved model bundles, and that the figures the app computes from the CSV match an independent recomputation."""
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, confusion_matrix, roc_auc_score
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "backend" / "models"
KEYS = {"knn", "logistic_regression", "naive_bayes", "svm", "decision_tree", "random_forest"}
sys.path.insert(0, str(ROOT / "backend"))


def fail(msg):
    print("FAIL:", msg)
    sys.exit(1)


# Training must leave only .pkl files: no generated data copies.
files = sorted(p.name for p in MODELS_DIR.iterdir())
if files != sorted(f"{k}.pkl" for k in KEYS):
    fail(f"backend/models must hold exactly the six .pkl files, found {files}")

from app import METRICS, SAMPLES  # noqa: E402  (computed from the CSV at import time)

metrics = METRICS
if {m["key"] for m in metrics["models"]} != KEYS:
    fail("the app does not list exactly the six expected models")

data = pd.read_csv(ROOT / "cancer_data.csv")
if len(data) != 569:
    fail(f"CSV has {len(data)} rows, expected 569")
counts = data["diagnosis"].value_counts().to_dict()
expected_ds = {"rows": len(data), "malignant": counts["M"], "benign": counts["B"]}
if metrics.get("dataset") != expected_ds:
    fail(f"app dataset {metrics.get('dataset')} != recomputed {expected_ds}")

x = data[["radius_mean", "texture_mean"]].values
y = data["diagnosis"].values
idx = np.arange(len(data))
_, x_test, _, y_test, idx_train, idx_test = train_test_split(x, y, idx, test_size=0.2, random_state=0)
if metrics["test_rows"] != len(x_test) or metrics["train_rows"] != len(y) - len(y_test):
    fail("train/test row counts disagree with the split")

# Samples served by the app: every CSV row once, same values, split flag matches the recomputed split.
if len(SAMPLES) != 569 or len({s[0] for s in SAMPLES}) != 569:
    fail("the app must hold 569 rows with unique ids")
test_ids = set(data["id"].iloc[idx_test].tolist())
for s, (_, row) in zip(SAMPLES, data.iterrows()):
    if s[0] != row["id"] or abs(s[1] - row["radius_mean"]) > 1e-9 or abs(s[2] - row["texture_mean"]) > 1e-9 or s[3] != row["diagnosis"]:
        fail(f"sample {s[0]} differs from the CSV")
    if (s[4] == "test") != (s[0] in test_ids):
        fail(f"split flag wrong for id {s[0]}")
if sum(1 for s in SAMPLES if s[4] == "test") != len(y_test):
    fail("test count != test_rows")

y_is_m = (y_test == "M").astype(int)
for m in metrics["models"]:
    path = MODELS_DIR / f"{m['key']}.pkl"
    bundle = joblib.load(path)  # trusted: produced locally by backend/train_model.py
    for field in ("key", "label", "order", "model", "csv_fingerprint", "features"):
        if field not in bundle:
            fail(f"{path.name} has no '{field}'")
    if bundle["key"] != m["key"] or len(bundle["csv_fingerprint"]) != 64:
        fail(f"{path.name}: bad key or fingerprint")
    model = bundle["model"]
    pred = model.predict(x_test)
    acc = accuracy_score(y_test, pred)
    if abs(acc - m["accuracy"]) > 5e-7:
        fail(f"{m['key']}: app says {m['accuracy']} but the saved model scores {acc:.6f}")
    if set(model.classes_) != {"B", "M"}:
        fail(f"{m['key']}: unexpected classes {model.classes_}")
    p_m = model.predict_proba(x_test)[:, list(model.classes_).index("M")]
    auc = roc_auc_score(y_is_m, p_m)
    if abs(auc - m["auc"]) > 5e-7:
        fail(f"{m['key']}: app AUC {m['auc']} but recomputed {auc:.6f}")
    cm = confusion_matrix(y_test, pred, labels=["B", "M"]).tolist()
    if m["confusion"] != cm:
        fail(f"{m['key']}: confusion matrix {m['confusion']} != recomputed {cm}")
    if sum(map(sum, cm)) != len(y_test):
        fail(f"{m['key']}: confusion matrix does not sum to the test rows")
    roc = m["roc"]
    if list(map(float, roc[0])) != [0.0, 0.0] or list(map(float, roc[-1])) != [1.0, 1.0]:
        fail(f"{m['key']}: ROC curve must run from (0,0) to (1,1)")
    if any(roc[i][0] > roc[i + 1][0] or roc[i][1] > roc[i + 1][1] for i in range(len(roc) - 1)):
        fail(f"{m['key']}: ROC curve is not monotone")
    area = sum((roc[i + 1][0] - roc[i][0]) * (roc[i + 1][1] + roc[i][1]) / 2 for i in range(len(roc) - 1))
    if abs(area - m["auc"]) > 0.01:
        fail(f"{m['key']}: ROC area {area:.4f} disagrees with AUC {m['auc']}")

best = max(metrics["models"], key=lambda m: m["accuracy"])["key"]
if metrics["best"] != best:
    fail(f"'best' is {metrics['best']} but highest accuracy is {best}")

print("TRAINING VERIFIED: 6 model bundles only, accuracy/AUC/confusion recomputed from the CSV, 569 samples, best =", best)
