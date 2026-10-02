"""Measure the trained models on the held-out test rows of cancer_data.csv.

Called by train_model.py (to print the results) and by app.py at startup (to serve them), so the
numbers shown on the dashboard are always computed from the CSV, never read from a saved file.
"""
import numpy as np
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    precision_recall_fscore_support,
    roc_auc_score,
    roc_curve,
)

import data as dataset


def roc_points(y_true_is_m, p_malignant):
    """ROC curve as [[fpr, tpr], ...], rounded; thinned to at most ~120 points."""
    fpr, tpr, _ = roc_curve(y_true_is_m, p_malignant)
    pts = np.round(np.column_stack([fpr, tpr]), 4)
    if len(pts) > 120:
        keep = np.unique(np.linspace(0, len(pts) - 1, 120).astype(int))
        pts = pts[keep]
    return pts.tolist()


def evaluate(models, d):
    """models: ordered list of (key, label, fitted_model); d: the object returned by data.load()."""
    y_is_m = (d.y_test == "M").astype(int)
    results = []
    for key, label, model in models:
        pred = model.predict(d.x_test)
        p_m = model.predict_proba(d.x_test)[:, list(model.classes_).index("M")]
        precision, recall, f1, _ = precision_recall_fscore_support(d.y_test, pred, labels=["M"], zero_division=0)
        results.append({
            "key": key,
            "label": label,
            "accuracy": round(float(accuracy_score(d.y_test, pred)), 6),
            "precision_malignant": round(float(precision[0]), 6),
            "recall_malignant": round(float(recall[0]), 6),
            "f1_malignant": round(float(f1[0]), 6),
            "auc": round(float(roc_auc_score(y_is_m, p_m)), 6),
            # rows/columns are [B, M]; [[true B pred B, true B pred M], [true M pred B, true M pred M]]
            "confusion": confusion_matrix(d.y_test, pred, labels=["B", "M"]).tolist(),
            "roc": roc_points(y_is_m, p_m),
        })
    return {
        "features": dataset.FEATURES,
        "dataset": {
            "rows": int(len(d.y)),
            "malignant": int((d.y == "M").sum()),
            "benign": int((d.y == "B").sum()),
        },
        "train_rows": int(len(d.y_train)),
        "test_rows": int(len(d.y_test)),
        "test_size": dataset.TEST_SIZE,
        "random_state": dataset.RANDOM_STATE,
        "best": max(results, key=lambda r: r["accuracy"])["key"],
        "models": results,
    }
