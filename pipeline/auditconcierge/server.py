"""HTTP service that runs the pipeline for the Worker (deployed as a container, see pipeline/Dockerfile).

    POST /jobs     signed by the Worker: {run, files: [{id, name, sha256}], settings: {...}}
                   → 202 at once; the job runs in a background thread
    GET  /healthz  → "ok" (also used to wake a sleeping free instance)

For each job the service:
  1. downloads each file from the Worker (GET /api/internal/runs/<run>/files/<id>, signed) into a
     fresh temporary folder and checks its SHA-256,
  2. runs build() exactly as the CLI does,
  3. uploads page images and crops (POST .../asset) and then conflict_map.json (POST .../done),
  4. deletes the temporary folder, whatever happened. On error it reports POST .../fail.

The service keeps nothing: no database, no files after a job, no credentials besides the shared
PIPELINE_SECRET. It only ever talks to WORKER_URL (never to a URL taken from a request), so a
forged job cannot make it fetch or send data anywhere else.

Environment: PIPELINE_SECRET (same as the Worker secret), WORKER_URL (e.g. https://auditpal.<you>.workers.dev),
PORT (default 8080), ACCOUNT_TOKEN_SALT (bank-account token salt, see entities.py).
"""
import hashlib
import hmac
import json
import os
import re
import shutil
import tempfile
import threading
import time
import traceback
import unicodedata
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_JOB_BODY = 256 * 1024
MAX_SKEW = 300
NAME_RE = re.compile(r"^[A-Za-z0-9฀-๿][A-Za-z0-9฀-๿ _.()-]{0,118}\.(pdf|png|jpe?g|tiff?|csv|xlsx|json)$", re.I)
ID_RE = re.compile(r"^[a-f0-9]{16}$")
_jobs = threading.Semaphore(int(os.environ.get("PIPELINE_CONCURRENCY", "1")))  # OCR is CPU-heavy; free hosts have little


def sign(secret: str, method: str, path: str, body: bytes, ts: int | None = None) -> dict:
    ts = int(time.time()) if ts is None else ts
    msg = f"{ts}\n{method.upper()}\n{path}\n{hashlib.sha256(body).hexdigest()}"
    sig = hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()
    return {"x-ac-timestamp": str(ts), "x-ac-signature": sig}


def verify(secret: str, method: str, path: str, body: bytes, headers) -> bool:
    if not secret:
        return False
    try:
        ts = int(headers.get("x-ac-timestamp", ""))
    except ValueError:
        return False
    if abs(time.time() - ts) > MAX_SKEW:
        return False
    expected = sign(secret, method, path, body, ts)["x-ac-signature"]
    return hmac.compare_digest(expected, headers.get("x-ac-signature", ""))


class WorkerClient:
    """Signed calls back to the Worker for one run."""

    def __init__(self, base: str, secret: str, run: str, opener=urllib.request.urlopen):
        self.base = base.rstrip("/")
        self.secret = secret
        self.prefix = f"/api/internal/runs/{run}"
        self.opener = opener

    def _call(self, method: str, path: str, body: bytes = b"", query: dict | None = None, ctype="application/octet-stream"):
        full = self.prefix + path
        url = self.base + urllib.parse.quote(full) + ("?" + urllib.parse.urlencode(query) if query else "")
        headers = sign(self.secret, method, urllib.parse.quote(full), body)
        if method == "POST":
            headers["content-type"] = ctype
        req = urllib.request.Request(url, data=body if method == "POST" else None, method=method, headers=headers)
        with self.opener(req, timeout=120) as r:
            return r.read()

    def file(self, file_id: str) -> bytes:
        return self._call("GET", f"/files/{file_id}")

    def asset(self, result_run: str, path: str, data: bytes):
        self._call("POST", "/asset", data, {"path": path, "result": result_run}, "image/png")

    def done(self, result: dict):
        self._call("POST", "/done", json.dumps(result, ensure_ascii=False).encode(), ctype="application/json")

    def fail(self, error: str):
        self._call("POST", "/fail", json.dumps({"error": error}, ensure_ascii=False).encode(), ctype="application/json")


def remember_for(folder: Path, settings: dict) -> None:
    """remember.json for build(): the engagement's settings, plus company rules if one was uploaded."""
    path = folder / "remember.json"
    cfg = {"rules": []}
    if path.exists():
        try:
            uploaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(uploaded.get("rules"), list):
                cfg["rules"] = uploaded["rules"]
        except (ValueError, AttributeError):
            pass  # a broken rules file means no rules, not a failed run
    cfg.update(
        client=str(settings.get("client") or "-"),
        tolerance_pct=float(settings.get("tolerance_pct", 1.0)),
        materiality_thb=float(settings.get("materiality_thb", 10000)),
        synthetic=bool(settings.get("synthetic", True)),
    )
    path.write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")


def run_job(job: dict, client: WorkerClient) -> dict:
    from .build import build

    work = Path(tempfile.mkdtemp(prefix="ac-job-"))
    try:
        src, out = work / "in", work / "out"
        src.mkdir()
        for f in job["files"]:
            name = unicodedata.normalize("NFC", f["name"])
            if not NAME_RE.match(name) or ".." in name or not ID_RE.match(f["id"]):
                raise ValueError(f"ชื่อไฟล์ไม่ถูกต้อง: {name}")
            data = client.file(f["id"])
            if hashlib.sha256(data).hexdigest() != f.get("sha256"):
                raise ValueError(f"ไฟล์ {name} เสียระหว่างส่ง (SHA-256 ไม่ตรง)")
            (src / name).write_bytes(data)
        remember_for(src, job.get("settings") or {})
        result = build(src, out)
        for sub in ("pages", "crops"):
            for p in sorted((out / sub).glob("*.png")) if (out / sub).exists() else []:
                client.asset(result["run_id"], f"{sub}/{p.name}", p.read_bytes())
        client.done(result)
        return result
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _background(job: dict, client: WorkerClient):
    with _jobs:
        try:
            run_job(job, client)
        except Exception as e:  # report, never crash the server
            traceback.print_exc()
            msg = str(e) if isinstance(e, ValueError) else f"ประมวลผลไม่สำเร็จ ({type(e).__name__})"
            try:
                client.fail(msg)
            except Exception:
                traceback.print_exc()


class Handler(BaseHTTPRequestHandler):
    server_version = "auditconcierge"

    def _send(self, code: int, body: dict | str):
        data = (json.dumps(body, ensure_ascii=False) if isinstance(body, dict) else body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json" if isinstance(body, dict) else "text/plain")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/healthz":
            return self._send(200, "ok")
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/jobs":
            return self._send(404, {"error": "not found"})
        n = int(self.headers.get("content-length") or 0)
        if n > MAX_JOB_BODY:
            return self._send(413, {"error": "too large"})
        body = self.rfile.read(n)
        secret, worker = os.environ.get("PIPELINE_SECRET", ""), os.environ.get("WORKER_URL", "")
        if not worker or not verify(secret, "POST", "/jobs", body, self.headers):
            return self._send(401, {"error": "bad signature"})
        try:
            job = json.loads(body)
            if not ID_RE.match(job["run"]) or not isinstance(job["files"], list):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return self._send(400, {"error": "bad job"})
        client = WorkerClient(worker, secret, job["run"])
        threading.Thread(target=_background, args=(job, client), daemon=True).start()
        self._send(202, {"accepted": job["run"]})

    def log_message(self, fmt, *args):  # no request paths or bodies in logs beyond the default line
        print("%s - %s" % (self.address_string(), fmt % args))


def main():
    port = int(os.environ.get("PORT", "8080"))
    if not os.environ.get("PIPELINE_SECRET") or not os.environ.get("WORKER_URL"):
        print("warning: PIPELINE_SECRET and WORKER_URL must be set, every job will be refused")
    print(f"pipeline service on :{port}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
