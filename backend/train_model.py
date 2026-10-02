"""Train the six notebook classifiers on cancer_data.csv and save them as .pkl files.

Same setup as ml50cancer.py: inputs radius_mean + texture_mean, target diagnosis,
80/20 split with random_state=0. Run from anywhere:  python backend/train_model.py

The only outputs are backend/models/<key>.pkl. Each file holds the fitted model plus a fingerprint of the
CSV values it was trained on, so the server can refuse to start if the CSV has changed since.
Everything the dashboard shows (samples, statistics, accuracy, ROC...) is computed from the CSV at runtime.
"""
import sys
from pathlib import Path

import joblib
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import KNeighborsClassifier
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier

sys.path.insert(0, str(Path(__file__).resolve().parent))
import data as dataset  # noqa: E402
from evaluate import evaluate  # noqa: E402

MODELS_DIR = Path(__file__).resolve().parent / "models"

# random_state is fixed wherever the algorithm is random so the saved models and
# metrics are reproducible. The linear SVM is wrapped in CalibratedClassifierCV (the
# replacement for SVC(probability=True)) so the API can report a confidence.
MODELS = {
    "knn": ("K-Nearest Neighbors", KNeighborsClassifier(n_neighbors=5)),
    "logistic_regression": ("Logistic Regression", LogisticRegression()),
    "naive_bayes": ("Gaussian Naive Bayes", GaussianNB()),
    "svm": ("Support Vector Machine", CalibratedClassifierCV(SVC(kernel="linear"), ensemble=False)),
    "decision_tree": ("Decision Tree", DecisionTreeClassifier(random_state=0)),
    "random_forest": ("Random Forest", RandomForestClassifier(n_estimators=10, random_state=0)),
}


def main():
    d = dataset.load()
    MODELS_DIR.mkdir(exist_ok=True)
    for old in MODELS_DIR.glob("*.pkl"):
        old.unlink()  # never leave a stale model from an earlier run next to the new ones

    trained = []
    for order, (key, (label, model)) in enumerate(MODELS.items()):
        model.fit(d.x_train, d.y_train)
        joblib.dump({
            "key": key, "label": label, "order": order, "model": model,
            "csv_fingerprint": d.fingerprint, "features": dataset.FEATURES,
        }, MODELS_DIR / f"{key}.pkl")
        trained.append((key, label, model))

    metrics = evaluate(trained, d)
    print(f"Read {metrics['dataset']['rows']} rows from {dataset.CSV_PATH.name}: "
          f"trained on {metrics['train_rows']}, tested on {metrics['test_rows']}.")
    for r in metrics["models"]:
        mark = "  <- best" if r["key"] == metrics["best"] else ""
        print(f"  {r['label']:<24} accuracy={r['accuracy']:.4f}  auc={r['auc']:.4f}{mark}")
    print(f"Saved {len(trained)} models to {MODELS_DIR}")


if __name__ == "__main__":
    main()
