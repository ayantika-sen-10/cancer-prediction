"""Start the real server in a subprocess and talk to it over HTTP.

Uses a free port (so a stale server on 5000 can never answer for us), checks that the
answering server runs the current code, and kills the whole process tree afterwards
(on Windows the venv python.exe is only a launcher; killing it alone orphans the server).
"""
import csv
import http.client
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

with socket.socket() as s:
    s.bind(("127.0.0.1", 0))
    PORT = s.getsockname()[1]
BASE = f"http://127.0.0.1:{PORT}"


def stop(proc):
    if os.name == "nt":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        proc.kill()
    proc.wait()


def fail(msg, proc=None):
    print("FAIL:", msg)
    if proc:
        stop(proc)
    sys.exit(1)


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=5) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()


proc = subprocess.Popen(
    [sys.executable, str(ROOT / "backend" / "app.py")],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    env={**os.environ, "PORT": str(PORT)},
)
try:
    for _ in range(40):
        try:
            get("/api/models")
            break
        except (urllib.error.URLError, ConnectionError, http.client.HTTPException, OSError):
            # a server that is still starting may reset, refuse or answer garbage; retry until it is ready
            if proc.poll() is not None:
                fail("server process exited during startup")
            time.sleep(0.25)
    else:
        fail("server did not start within 10s", proc)

    status, ctype, body = get("/")
    if status != 200 or b"Cancer Cell Detection" not in body or "html" not in ctype:
        fail(f"/ did not serve the page ({status}, {ctype})", proc)
    for asset, needle, kind in (("/script.js", b"fetch(", "javascript"), ("/charts.js", b"window.Charts", "javascript"),
                                ("/style.css", b"--class-b", "css")):
        status, ctype, body = get(asset)
        if status != 200 or needle not in body or kind not in ctype:
            fail(f"{asset} not served correctly ({status}, {ctype})", proc)
    status, ctype, body = get("/fonts/inter-latin-wght-normal.woff2")
    if status != 200 or body[:4] != b"wOF2" or len(body) < 20000 or "woff2" not in ctype:
        fail(f"Inter font not served as WOFF2 ({status}, {ctype}, {len(body)} bytes)", proc)
    status, _, body = get("/api/models")
    info = json.loads(body)
    if status != 200 or len(info["models"]) != 6:
        fail("/api/models did not list six models", proc)
    with (ROOT / "cancer_data.csv").open(newline="", encoding="utf-8") as f:
        csv_rows = list(csv.DictReader(f))
    if info["dataset"] != {"rows": len(csv_rows), "malignant": sum(r["diagnosis"] == "M" for r in csv_rows),
                           "benign": sum(r["diagnosis"] == "B" for r in csv_rows)}:
        fail("server /api/models dataset counts differ from the CSV (stale server?)", proc)
    status, _, body = get("/api/dataset")
    ds = json.loads(body)
    if status != 200 or ds["rows"] != len(csv_rows) or [s[0] for s in ds["samples"]] != [int(r["id"]) for r in csv_rows]:
        fail("/api/dataset rows differ from the CSV", proc)
    if any(s[1] != float(r["radius_mean"]) or s[2] != float(r["texture_mean"]) or s[3] != r["diagnosis"] for s, r in zip(ds["samples"], csv_rows)):
        fail("/api/dataset values differ from the CSV", proc)
    status, _, body = get("/api/boundary?model=knn&res=20")
    grid = json.loads(body)["p_malignant"]
    if status != 200 or len(grid) != 20 or len(grid[0]) != 20:
        fail("/api/boundary did not return a 20x20 grid", proc)

    req = urllib.request.Request(
        BASE + "/predict",
        data=json.dumps({"radius_mean": 20, "texture_mean": 20, "model": "knn"}).encode(),
        headers={"Content-Type": "application/json", "Origin": "null"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as r:
        result = json.loads(r.read())
        if r.headers.get("Access-Control-Allow-Origin") is None:
            fail("CORS header missing on /predict", proc)
    if len(result["consensus"]) != 6 or len(result["nearest"]) != 5:
        fail("live /predict is missing consensus or nearest samples", proc)
    if result["diagnosis"] != "M" or result["model"] != "knn":
        fail(f"unexpected live prediction {result}", proc)

    try:
        get("/definitely-missing")
        fail("unknown path should 404", proc)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            fail(f"unknown path returned {e.code}", proc)
finally:
    stop(proc)

try:
    urllib.request.urlopen(BASE + "/api/models", timeout=2)
    print("FAIL: server still answering after shutdown (orphaned process)")
    sys.exit(1)
except (urllib.error.URLError, ConnectionError):
    pass

print(f"LIVE SERVER VERIFIED: page, 3 assets + Inter WOFF2, /api/models + /api/dataset (match the CSV), /api/boundary, /predict (with CORS, consensus, neighbours) over real HTTP on port {PORT}; server stopped cleanly")
