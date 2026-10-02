"""Exercise the Flask API in-process with the test client."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from app import app  # noqa: E402


def fail(msg):
    print("FAIL:", msg)
    sys.exit(1)


client = app.test_client()

listing = client.get("/api/models")
if listing.status_code != 200:
    fail(f"/api/models returned {listing.status_code}")
info = listing.get_json()
keys = [m["key"] for m in info["models"]]
if len(keys) != 6 or info["best"] not in keys:
    fail("/api/models does not list six models with a valid 'best'")
for m in info["models"]:
    for field in ("auc", "confusion", "roc"):
        if field not in m:
            fail(f"/api/models: {m['key']} has no {field}")

# ---- /api/dataset against an independent pandas computation ----
df = pd.read_csv(ROOT / "cancer_data.csv")
ds = client.get("/api/dataset").get_json()
if ds["rows"] != 569 or len(ds["samples"]) != 569:
    fail("/api/dataset must hold 569 samples")
for cls in ("B", "M"):
    for feat in ("radius_mean", "texture_mean"):
        col = df.loc[df.diagnosis == cls, feat]
        s = ds["stats"][cls][feat]
        want = {"n": len(col), "mean": col.mean(), "median": col.median(), "std": col.std(ddof=1),
                "min": col.min(), "max": col.max(), "q1": col.quantile(0.25), "q3": col.quantile(0.75)}
        for name, val in want.items():
            if abs(s[name] - val) > 0.0015:
                fail(f"stats {cls}/{feat}/{name}: api {s[name]} vs pandas {val}")
for feat in ("radius_mean", "texture_mean"):
    h = ds["histograms"][feat]
    if len(h["edges"]) != 13 or len(h["B"]) != 12 or len(h["M"]) != 12:
        fail(f"histogram {feat} must have 12 bins")
    if sum(h["B"]) != 357 or sum(h["M"]) != 212:
        fail(f"histogram {feat} counts {sum(h['B'])}/{sum(h['M'])} != 357/212")
    # independent count of the first and last bin for malignant
    edges = np.array(h["edges"])
    col = df.loc[df.diagnosis == "M", feat].values
    if h["M"][0] != int(((col >= edges[0] - 1e-3) & (col < edges[1])).sum()):
        fail(f"histogram {feat}: first malignant bin count wrong")
    if h["M"][-1] != int(((col >= edges[-2]) & (col <= edges[-1] + 1e-3)).sum()):
        fail(f"histogram {feat}: last malignant bin count wrong")
corr = float(np.corrcoef(df.radius_mean, df.texture_mean)[0, 1])
if abs(ds["correlation"] - corr) > 0.0015:
    fail(f"correlation {ds['correlation']} vs {corr}")

# ---- /predict ----
for key in keys:
    resp = client.post("/predict", json={"radius_mean": 17.99, "texture_mean": 10.38, "model": key})
    if resp.status_code != 200:
        fail(f"{key}: /predict returned {resp.status_code} {resp.get_data(as_text=True)}")
    body = resp.get_json()
    if body["diagnosis"] not in ("B", "M") or body["model"] != key:
        fail(f"{key}: bad body {body}")
    if not 50 <= body["confidence"] <= 100:
        fail(f"{key}: confidence {body['confidence']} outside 50-100")
    if abs(sum(body["probabilities"].values()) - 100) > 0.2:
        fail(f"{key}: probabilities do not sum to 100: {body['probabilities']}")
    if len(body["consensus"]) != 6 or {c["model"] for c in body["consensus"]} != set(keys):
        fail(f"{key}: consensus must list all six models")
    ag = body["agreement"]
    if ag["malignant"] + ag["benign"] != 6 or ag["malignant"] != sum(c["diagnosis"] == "M" for c in body["consensus"]):
        fail(f"{key}: agreement counts inconsistent {ag}")
    chosen = next(c for c in body["consensus"] if c["model"] == key)
    if chosen["diagnosis"] != body["diagnosis"] or chosen["confidence"] != body["confidence"]:
        fail(f"{key}: top-level result differs from its consensus entry")

# nearest training samples: independent brute-force check with the user's own example input
r, t = 15.78, 17.98
body = client.post("/predict", json={"radius_mean": r, "texture_mean": t, "model": "knn"}).get_json()
samples = [s for s in ds["samples"] if s[4] == "train"]
want = sorted(samples, key=lambda s: ((s[1] - r) ** 2 + (s[2] - t) ** 2) ** 0.5)[:5]
got = body["nearest"]
if [g["id"] for g in got] != [w[0] for w in want]:
    fail(f"nearest ids {[g['id'] for g in got]} != brute force {[w[0] for w in want]}")
if any(got[i]["distance"] > got[i + 1]["distance"] for i in range(4)):
    fail("nearest samples are not sorted by distance")
# KNN's own prediction must equal the majority class of those five neighbours
votes_m = sum(1 for g in got if g["diagnosis"] == "M")
if body["diagnosis"] != ("M" if votes_m >= 3 else "B"):
    fail(f"KNN diagnosis {body['diagnosis']} disagrees with its neighbours ({votes_m}/5 malignant)")

# known points: a large-radius nucleus is malignant, a small one benign (clear in the CSV).
big = client.post("/predict", json={"radius_mean": 25.0, "texture_mean": 25.0, "model": "naive_bayes"}).get_json()
small = client.post("/predict", json={"radius_mean": 9.0, "texture_mean": 15.0, "model": "naive_bayes"}).get_json()
if big["diagnosis"] != "M" or small["diagnosis"] != "B":
    fail(f"sanity points wrong: big={big['diagnosis']} small={small['diagnosis']}")

default = client.post("/predict", json={"radius_mean": 15, "texture_mean": 10})
if default.status_code != 200 or default.get_json()["model"] != info["best"]:
    fail("omitting 'model' should use the best model")

# ---- /api/boundary ----
b = client.get("/api/boundary?model=naive_bayes&res=30").get_json()
grid = np.array(b["p_malignant"])
if grid.shape != (30, 30) or grid.min() < 0 or grid.max() > 1:
    fail(f"boundary grid shape/range wrong: {grid.shape} {grid.min()} {grid.max()}")
# corner values must agree with /predict at the same coordinates
for row, col in ((0, 0), (29, 29), (0, 29), (29, 0)):
    x = b["x"][0] + (b["x"][1] - b["x"][0]) * col / 29
    y = b["y"][0] + (b["y"][1] - b["y"][0]) * row / 29
    pm = client.post("/predict", json={"radius_mean": x, "texture_mean": y, "model": "naive_bayes"}).get_json()["probabilities"]["M"]
    if abs(pm - grid[row, col] * 100) > 0.2:
        fail(f"boundary[{row}][{col}]={grid[row, col]} but /predict says {pm}% malignant")
if client.get("/api/boundary?model=nope").status_code != 400:
    fail("unknown boundary model should be 400")
if client.get("/api/boundary?res=abc").status_code != 400:
    fail("non-integer res should be 400")
if np.array(client.get("/api/boundary?res=5000").get_json()["p_malignant"]).shape != (100, 100):
    fail("res must be clamped to 100")

bad_bodies = [
    ({"texture_mean": 10}, "missing radius"),
    ({"radius_mean": "15", "texture_mean": 10}, "string radius"),
    ({"radius_mean": True, "texture_mean": 10}, "boolean radius"),
    ({"radius_mean": -1, "texture_mean": 10}, "negative radius"),
    ({"radius_mean": 15, "texture_mean": None}, "null texture"),
    ({"radius_mean": 15, "texture_mean": 10, "model": "nope"}, "unknown model"),
]
for body_, why in bad_bodies:
    resp = client.post("/predict", json=body_)
    if resp.status_code != 400 or "error" not in resp.get_json():
        fail(f"{why}: expected 400 with error, got {resp.status_code}")
not_json = client.post("/predict", data="radius_mean=15", content_type="text/plain")
if not_json.status_code != 400:
    fail(f"non-JSON body: expected 400, got {not_json.status_code}")
not_object = client.post("/predict", json=[1, 2])
if not_object.status_code != 400:
    fail(f"JSON array body: expected 400, got {not_object.status_code}")
nan = client.post("/predict", data='{"radius_mean": NaN, "texture_mean": 10}', content_type="application/json")
if nan.status_code != 400:
    fail(f"NaN: expected 400, got {nan.status_code}")

print("API VERIFIED: dataset stats/histograms vs pandas, 6 models + consensus + neighbours vs brute force, boundary vs /predict, 9 bad inputs rejected")
