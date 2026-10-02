"""Flask API that serves the trained .pkl models, dataset analytics and the dashboard.

Data source: cancer_data.csv is read at startup (backend/data.py); samples, statistics, histograms, nearest
neighbours and all accuracy/AUC/confusion/ROC figures are computed from its rows. No generated data files.

Run:  python backend/app.py      then open http://localhost:5000
(set PORT=5001 to use another port)

Endpoints
  GET  /api/models    model list + metrics (accuracy, AUC, confusion matrix, ROC) + dataset counts
  GET  /api/dataset   every sample, per-class statistics and histograms of radius/texture
  GET  /api/boundary  P(malignant) on a grid for one model (the "decision map")
  POST /predict       diagnosis, probabilities, nearest training samples, six-model consensus
"""
import math
import mimetypes
import os
import sys
from pathlib import Path

import joblib
import numpy as np
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
import data as dataset  # noqa: E402
from evaluate import evaluate  # noqa: E402

MODELS_DIR = BASE_DIR / "models"
FRONTEND_DIR = BASE_DIR.parent / "cancer-prediction-website"
N_NEIGHBORS = 5
HIST_BINS = 12

mimetypes.add_type("font/woff2", ".woff2")  # Windows often lacks this mapping

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")
CORS(app)  # lets the page work even when opened from a file:// URL or another port


def load_everything():
    """Read the CSV and the trained models; everything the dashboard shows is computed from them."""
    if not dataset.CSV_PATH.exists():
        raise SystemExit(f"Dataset not found: {dataset.CSV_PATH}")
    d = dataset.load()

    paths = sorted(MODELS_DIR.glob("*.pkl"))
    if not paths:
        raise SystemExit("No trained models found. Run:  python backend/train_model.py")
    # joblib/pickle can execute code on load: only load .pkl files produced locally by
    # train_model.py, never files from an untrusted source.
    bundles = sorted((joblib.load(p) for p in paths), key=lambda b: b["order"])
    for b in bundles:
        if b["csv_fingerprint"] != d.fingerprint:
            raise SystemExit(
                f"{dataset.CSV_PATH.name} has changed since the models were trained "
                f"({b['key']}.pkl was trained on different rows). Run:  python backend/train_model.py"
            )

    models = {b["key"]: b["model"] for b in bundles}
    labels = {b["key"]: b["label"] for b in bundles}
    metrics = evaluate([(b["key"], b["label"], b["model"]) for b in bundles], d)
    train_rows = set(d.idx_train.tolist())
    # [id, radius_mean, texture_mean, diagnosis, split] for every CSV row
    samples = [
        [int(d.ids[i]), float(d.x[i, 0]), float(d.x[i, 1]), str(d.y[i]), "train" if i in train_rows else "test"]
        for i in range(len(d.y))
    ]
    return metrics, models, labels, samples


METRICS, MODELS, LABELS, SAMPLES = load_everything()

_XY = np.array([[s[1], s[2]] for s in SAMPLES])
_DX = np.array([s[3] for s in SAMPLES])
_SPLIT = np.array([s[4] for s in SAMPLES])
_TRAIN = np.where(_SPLIT == "train")[0]


def _five_numbers(values):
    return {
        "n": int(len(values)),
        "mean": round(float(np.mean(values)), 3),
        "median": round(float(np.median(values)), 3),
        "std": round(float(np.std(values, ddof=1)), 3),
        "min": round(float(np.min(values)), 3),
        "max": round(float(np.max(values)), 3),
        "q1": round(float(np.percentile(values, 25)), 3),
        "q3": round(float(np.percentile(values, 75)), 3),
    }


def build_dataset_payload():
    stats, hist = {}, {}
    for f_idx, feature in enumerate(METRICS["features"]):
        col = _XY[:, f_idx]
        edges = np.linspace(col.min(), col.max(), HIST_BINS + 1)
        hist[feature] = {
            "edges": [round(float(e), 3) for e in edges],
            "B": np.histogram(col[_DX == "B"], bins=edges)[0].tolist(),
            "M": np.histogram(col[_DX == "M"], bins=edges)[0].tolist(),
        }
        for cls in ("B", "M"):
            stats.setdefault(cls, {})[feature] = _five_numbers(col[_DX == cls])
    return {
        "rows": len(SAMPLES),
        "samples": SAMPLES,  # [id, radius_mean, texture_mean, diagnosis, split]
        "stats": stats,
        "histograms": hist,
        "correlation": round(float(np.corrcoef(_XY[:, 0], _XY[:, 1])[0, 1]), 3),
        "bounds": {
            "radius_mean": [math.floor(_XY[:, 0].min()) - 1, math.ceil(_XY[:, 0].max()) + 1],
            "texture_mean": [math.floor(_XY[:, 1].min()) - 1, math.ceil(_XY[:, 1].max()) + 1],
        },
    }


DATASET = build_dataset_payload()
_BOUNDARY_CACHE = {}


def parse_number(payload, field):
    value = payload.get(field)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"'{field}' must be a number")
    if not math.isfinite(value) or value < 0:
        raise ValueError(f"'{field}' must be a finite number that is 0 or greater")
    return float(value)


def malignant_probability(model, features):
    col = list(model.classes_).index("M")
    return model.predict_proba(features)[:, col]


@app.get("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/api/models")
def list_models():
    return jsonify(METRICS)


@app.get("/api/dataset")
def dataset():
    return jsonify(DATASET)


@app.get("/api/boundary")
def boundary():
    key = request.args.get("model", METRICS["best"])
    if key not in MODELS:
        return jsonify(error=f"Unknown model '{key}'", available=list(MODELS)), 400
    try:
        res = int(request.args.get("res", 60))
    except ValueError:
        return jsonify(error="'res' must be an integer"), 400
    res = max(10, min(100, res))

    if (key, res) not in _BOUNDARY_CACHE:
        (x0, x1), (y0, y1) = DATASET["bounds"]["radius_mean"], DATASET["bounds"]["texture_mean"]
        xs = np.linspace(x0, x1, res)
        ys = np.linspace(y0, y1, res)
        grid = np.array([[x, y] for y in ys for x in xs])
        p = malignant_probability(MODELS[key], grid).reshape(res, res)
        _BOUNDARY_CACHE[(key, res)] = {
            "model": key,
            "label": LABELS[key],
            "res": res,
            "x": [x0, x1],
            "y": [y0, y1],
            # grid[row][col]: row = texture (y0 -> y1), col = radius (x0 -> x1); value = P(malignant)
            "p_malignant": np.round(p, 3).tolist(),
        }
    return jsonify(_BOUNDARY_CACHE[(key, res)])


@app.post("/predict")
def predict():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Request body must be a JSON object"), 400
    try:
        radius = parse_number(payload, "radius_mean")
        texture = parse_number(payload, "texture_mean")
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

    key = payload.get("model", METRICS["best"])
    if key not in MODELS:
        return jsonify(error=f"Unknown model '{key}'", available=list(MODELS)), 400

    features = [[radius, texture]]

    def run(model_key):
        model = MODELS[model_key]
        diagnosis = str(model.predict(features)[0])
        probs = {str(c): float(p) for c, p in zip(model.classes_, model.predict_proba(features)[0])}
        return {
            "model": model_key,
            "label": LABELS[model_key],
            "diagnosis": diagnosis,
            "confidence": round(probs[diagnosis] * 100, 1),
            "probabilities": {c: round(p * 100, 1) for c, p in probs.items()},
        }

    chosen = run(key)
    consensus = [run(k) for k in MODELS]

    # Nearest training samples by Euclidean distance on the raw features (what KNN uses).
    dist = np.sqrt(((_XY[_TRAIN] - np.array([radius, texture])) ** 2).sum(axis=1))
    order = np.argsort(dist, kind="stable")[:N_NEIGHBORS]
    nearest = [
        {
            "id": SAMPLES[_TRAIN[i]][0],
            "radius_mean": SAMPLES[_TRAIN[i]][1],
            "texture_mean": SAMPLES[_TRAIN[i]][2],
            "diagnosis": SAMPLES[_TRAIN[i]][3],
            "distance": round(float(dist[i]), 3),
        }
        for i in order
    ]

    return jsonify(
        **chosen,
        input={"radius_mean": radius, "texture_mean": texture},
        consensus=consensus,
        agreement={
            "malignant": sum(1 for c in consensus if c["diagnosis"] == "M"),
            "benign": sum(1 for c in consensus if c["diagnosis"] == "B"),
            "total": len(consensus),
        },
        nearest=nearest,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
