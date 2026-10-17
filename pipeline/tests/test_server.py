"""Pipeline service: signatures, and a full job against a fake Worker using the sample engagement."""
import hashlib
import json
import shutil
from pathlib import Path

import pytest

from auditconcierge import server
from auditconcierge.build import build

SAMPLE = Path(__file__).resolve().parents[1] / "samples" / "tg_company"
SECRET = "test-secret-for-the-pipeline-service"


def test_signature_matches_the_worker_format():
    # Same vector as worker/test/engagements.test.js ("signature format is shared with the pipeline").
    h = server.sign("s3cret", "POST", "/jobs", b'{"a":1}', ts=1700000000)
    assert h["x-ac-signature"] == "57a512c101447c650964f207bffaa39f89b8e0fbbd61afc5dd84571f0ebcfaa4"
    assert not server.verify("s3cret", "POST", "/jobs", b'{"a":1}', h), "too old"
    fresh = server.sign("s3cret", "POST", "/jobs", b"{}")
    assert server.verify("s3cret", "POST", "/jobs", b"{}", fresh)
    assert not server.verify("s3cret", "POST", "/jobs", b"{ }", fresh), "body is covered"
    assert not server.verify("other", "POST", "/jobs", b"{}", fresh)
    assert not server.verify("", "POST", "/jobs", b"{}", fresh), "no secret, no jobs"


class FakeWorker:
    """Plays the Worker's internal API: serves files by id, records what comes back."""

    def __init__(self, files):
        self.files = files  # id -> bytes
        self.assets, self.result, self.error = {}, None, None

    def file(self, fid):
        return self.files[fid]

    def asset(self, result_run, path, data):
        self.assets[path] = data

    def done(self, result):
        self.result = result

    def fail(self, error):
        self.error = error


def sample_job():
    files, listing = {}, []
    for i, p in enumerate(sorted(q for q in SAMPLE.rglob("*") if q.is_file() and q.name != "expected.json")):
        fid = f"{i:016x}"
        files[fid] = p.read_bytes()
        listing.append({"id": fid, "name": p.name, "sha256": hashlib.sha256(files[fid]).hexdigest()})
    settings = {"client": "ลูกค้าทดสอบ", "tolerance_pct": 1.0, "materiality_thb": 10000, "synthetic": True}
    return {"run": "a" * 16, "files": listing, "settings": settings}, files


def test_job_reproduces_the_sample_results_from_uploaded_files():
    job, files = sample_job()
    w = FakeWorker(files)
    res = server.run_job(job, w)
    cli = build(SAMPLE)
    assert w.result is res
    assert res["engagement"]["client"] == "ลูกค้าทดสอบ", "settings come from the engagement"
    key = lambda m: sorted((f["type"], tuple(f["docs"])) for f in m["flags"])
    assert key(res) == key(cli), "same flags as the CLI on the same files"
    assert res["pending"] == cli["pending"]
    assert any(p.startswith("pages/") for p in w.assets) and any(p.startswith("crops/") for p in w.assets)
    assert all(v.startswith(b"\x89PNG") for v in w.assets.values())
    assert {r["id"] for r in res["rules"] if r["verified"]} == {"R1", "R2"}, "uploaded remember.json rules are used"


def test_corrupted_download_fails_the_job_and_leaves_no_files(monkeypatch, tmp_path):
    job, files = sample_job()
    files[job["files"][0]["id"]] = b"tampered"
    monkeypatch.setattr(server.tempfile, "mkdtemp", lambda prefix: str(tmp_path / "job"))
    (tmp_path / "job").mkdir()
    with pytest.raises(ValueError, match="SHA-256"):
        server.run_job(job, FakeWorker(files))
    assert not (tmp_path / "job").exists(), "temporary folder is always removed"


def test_bad_file_name_is_refused():
    job, files = sample_job()
    job["files"][0]["name"] = "../etc/passwd.csv"
    with pytest.raises(ValueError):
        server.run_job(job, FakeWorker(files))


def test_without_rules_file_the_run_still_works(tmp_path):
    server.remember_for(tmp_path, {"client": "X", "tolerance_pct": 2, "materiality_thb": 5, "synthetic": False})
    cfg = json.loads((tmp_path / "remember.json").read_text(encoding="utf-8"))
    assert cfg == {"rules": [], "client": "X", "tolerance_pct": 2.0, "materiality_thb": 5.0, "synthetic": False}
