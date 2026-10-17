"""Score the pipeline against the answer key planted in samples/tg_company/expected.json."""
import json
from pathlib import Path

import pytest

from auditconcierge.build import build

SAMPLE = Path(__file__).resolve().parent.parent / "samples" / "tg_company"
EXPECTED = json.loads((SAMPLE / "expected.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def result():
    return build(SAMPLE)


def _docs(flag):
    return set(flag["docs"])


@pytest.mark.parametrize("exp", EXPECTED["flags"], ids=lambda e: e["type"])
def test_every_planted_conflict_is_found(result, exp):
    hits = [f for f in result["flags"] if f["type"] == exp["type"] and set(exp["docs"][:1]) <= _docs(f)]
    assert hits, f"missed {exp['type']} {exp['docs']}: {exp['why']}"


def test_no_extra_flags(result):
    expected_types = sorted(e["type"] for e in EXPECTED["flags"])
    assert sorted(f["type"] for f in result["flags"]) == expected_types


def test_clean_and_vat_only_transactions_are_not_flagged(result):
    for po in EXPECTED["clean"]:
        txn = next(t for t in result["transactions"] if po in t["members"])
        assert txn["flags"] == [], f"{po} should be clean"


def test_ambiguous_invoice_waits_for_matching(result):
    assert [p["doc"] for p in result["pending"]] == EXPECTED["pending_match"]
    assert not any("INV-TG-110" in f["docs"] and f["type"] != "DUPLICATE" for f in result["flags"])


def test_inferred_match_is_marked(result):
    for inv, po in EXPECTED["inferred_match"]:
        doc = next(d for d in result["documents"] if d["id"] == inv)
        assert doc["link"] == {"parent": po, "level": "likely", "why": doc["link"]["why"]}


def test_every_flag_has_verified_evidence_from_two_sides(result):
    for f in result["flags"]:
        assert len(f["evidence"]) >= 2, f["id"]
        assert all(e["quote"] for e in f["evidence"]), f["id"]


def test_scan_invoice_number_is_unclear_not_guessed(result):
    unclear = {(u["doc"], u["field"]) for u in result["coverage"]["unclear_fields"]}
    assert any(field == "invoice_no" for _, field in unclear)
    dup = next(f for f in result["flags"] if f["type"] == "DUPLICATE")
    assert dup["ocr"], "duplicate found through the scanned copy should be marked as coming from OCR"


def test_no_raw_bank_account_in_output(result):
    blob = json.dumps(result, ensure_ascii=False)
    for raw in ("123-4-56789-0", "987-6-54321-0", "222-3-33333-4", "555-6-77777-8"):
        assert raw not in blob


def test_rules_are_backed_by_policy_quotes(result):
    assert all(r["verified"] for r in result["rules"])


def test_csv_saved_by_excel_still_reads_and_unknown_csv_is_reported(tmp_path):
    """A BOM, CRLF and odd header spacing must not hide a known layout; an unknown layout must be listed
    as unreadable with a reason, never silently produce an empty run."""
    (tmp_path / "po.csv").write_bytes(
        "﻿PO_No , po_date,vendor_code,vendor_name,description,amount_excl_vat,approved_by,approver_role\r\n"
        "PO-9,2026-02-02,V001,TG,x,80000.00,A,Manager\r\n".encode("utf-8")
    )
    (tmp_path / "other.csv").write_text("a,b\n1,2\n", encoding="utf-8")
    (tmp_path / "remember.json").write_text(json.dumps({"rules": [], "client": "t", "tolerance_pct": 1, "materiality_thb": 1}), encoding="utf-8")
    out = build(tmp_path)
    assert [d["id"] for d in out["documents"]] == ["PO-9"]
    assert out["coverage"]["unreadable_files"] == ["other.csv"]
    assert "po_no" in out["coverage"]["unreadable_reasons"]["other.csv"]
