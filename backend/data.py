"""The single place that reads cancer_data.csv and splits it into train/test rows.

Training and the web server both call load(), so they always see the same rows in the same split.
Set CANCER_CSV to read a different file (used by the tests).
"""
import hashlib
import os
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = Path(os.environ.get("CANCER_CSV", ROOT / "cancer_data.csv"))
FEATURES = ["radius_mean", "texture_mean"]
TARGET = "diagnosis"
TEST_SIZE = 0.2
RANDOM_STATE = 0


def fingerprint(df):
    """Hash of the values the models learn from (id, features, label).

    Based on the parsed values, not the file bytes, so line endings or extra columns do not matter,
    but changing any radius, texture, label or id does.
    """
    core = df[["id"] + FEATURES + [TARGET]].to_csv(index=False, lineterminator="\n")
    return hashlib.sha256(core.encode("utf-8")).hexdigest()


def load():
    df = pd.read_csv(CSV_PATH)
    x = df[FEATURES].values
    y = df[TARGET].values
    idx = np.arange(len(df))
    x_train, x_test, y_train, y_test, idx_train, idx_test = train_test_split(
        x, y, idx, test_size=TEST_SIZE, random_state=RANDOM_STATE
    )
    return SimpleNamespace(
        df=df, x=x, y=y, ids=df["id"].to_numpy(),
        x_train=x_train, x_test=x_test, y_train=y_train, y_test=y_test,
        idx_train=idx_train, idx_test=idx_test,
        fingerprint=fingerprint(df),
    )
