"""Prove the running app takes its data from cancer_data.csv itself."""
import csv
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "cancer_data.csv"
sys.path.insert(0, str(ROOT / "backend"))


def fail(msg):
    print("FAIL:", msg)
    sys.exit(1)


# 1. No generated data copies exist or are referenced anywhere in the code or tests.
for name in ("samples.json", "metrics.json"):
    if list((ROOT / "backend").rglob(name)):
        fail(f"{name} still exists under backend/")
for path in list((ROOT / "backend").glob("*.py")) + list((ROOT / "tests").glob("verify_*.py")):
    if path.name == "verify_source.py":
        continue
    text = path.read_text(encoding="utf-8")
    for name in ("samples.json", "metrics.json"):
        if name in text:
            fail(f"{path.relative_to(ROOT)} still mentions {name}")

# 2. /api/dataset and /api/models equal the CSV rows exactly (read here with the csv module, not pandas).
with CSV.open(newline="", encoding="utf-8") as f:
    rows = list(csv.DictReader(f))
from app import app  # noqa: E402

ds = app.test_client().get("/api/dataset").get_json()
if len(ds["samples"]) != len(rows):
    fail(f"/api/dataset has {len(ds['samples'])} samples, CSV has {len(rows)}")
for s, r in zip(ds["samples"], rows):
    if s[0] != int(r["id"]) or s[1] != float(r["radius_mean"]) or s[2] != float(r["texture_mean"]) or s[3] != r["diagnosis"]:
        fail(f"sample {s[0]} differs from the CSV row {r['id']}")
info = app.test_client().get("/api/models").get_json()
want = {"rows": len(rows), "malignant": sum(r["diagnosis"] == "M" for r in rows), "benign": sum(r["diagnosis"] == "B" for r in rows)}
if info["dataset"] != want:
    fail(f"/api/models dataset {info['dataset']} != CSV {want}")

# 3. Pointing the app at other CSV files: same values -> accepted; any edit -> refuses to start.
raw = CSV.read_bytes()
text = raw.decode("utf-8")
first_line_end = text.index("\n") + 1
header, body = text[:first_line_end], text[first_line_end:]
lines = body.splitlines()
fields = lines[0].split(",")
variants = {}
variants["same values, CRLF line endings"] = ("accept", text.replace("\r\n", "\n").replace("\n", "\r\n"))
changed_radius = fields.copy(); changed_radius[2] = repr(round(float(fields[2]) + 0.01, 4))
variants["one radius edited by +0.01"] = ("refuse", header + ",".join(changed_radius) + "\n" + "\n".join(lines[1:]) + "\n")
flipped = fields.copy(); flipped[1] = "B" if fields[1] == "M" else "M"
variants["one diagnosis label flipped"] = ("refuse", header + ",".join(flipped) + "\n" + "\n".join(lines[1:]) + "\n")
variants["one row removed"] = ("refuse", header + "\n".join(lines[1:]) + "\n")

code = "import sys; sys.path.insert(0, r'%s'); import app; print('LOADED', len(app.SAMPLES))" % (ROOT / "backend")
with tempfile.TemporaryDirectory() as tmp:
    for label, (expect, content) in variants.items():
        path = Path(tmp) / "variant.csv"
        path.write_bytes(content.encode("utf-8"))
        proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                              env={**os.environ, "CANCER_CSV": str(path)}, timeout=120)
        out = proc.stdout + proc.stderr
        if expect == "accept":
            if proc.returncode != 0 or "LOADED 569" not in out:
                fail(f"'{label}' should be accepted but exited {proc.returncode}: {out[-300:]}")
        else:
            if proc.returncode == 0 or "has changed since the models were trained" not in out:
                fail(f"'{label}' should be refused with the retrain message, exit {proc.returncode}: {out[-300:]}")

print(f"SOURCE VERIFIED: no JSON copies, /api/dataset == {len(rows)} CSV rows, {len(variants)} CSV variants behave (1 accepted, {len(variants) - 1} refused)")
