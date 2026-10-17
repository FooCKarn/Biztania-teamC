"""FN/FP scoring against both answer keys, and the "ตรวจไม่ได้" (skipped checks) list in coverage."""
import json
import sys
from pathlib import Path

import pytest

from auditconcierge.build import build
from auditconcierge.crosscheck import score

SAMPLES = Path(__file__).resolve().parent.parent / "samples"
sys.path.insert(0, str(SAMPLES))
import frozen_foods  # noqa: E402

TG = SAMPLES / "tg_company"


@pytest.fixture(scope="module")
def tg():
    return build(TG)


@pytest.fixture(scope="module")
def ff(tmp_path_factory):
    folder = tmp_path_factory.mktemp("frozen_foods")
    frozen_foods.write(folder)
    return build(folder)


def test_tg_company_no_fn_no_fp(tg):
    s = score(tg, json.loads((TG / "expected.json").read_text(encoding="utf-8")))
    assert s["ok"], s
    assert (s["tp"], s["fn"], s["fp"]) == (12, 0, 0)


def test_frozen_foods_no_fn_no_fp(ff):
    s = score(ff, frozen_foods.EXPECTED)
    assert s["ok"], s
    assert (s["tp"], s["fn"], s["fp"]) == (9, 0, 0)


def test_score_reports_a_missed_and_an_extra_flag(tg):
    exp = json.loads((TG / "expected.json").read_text(encoding="utf-8"))
    run = dict(tg, flags=[f for f in tg["flags"] if f["type"] != "MISSING_LINK"])
    s = score(run, exp)
    assert s["fn"] == 1 and s["missed"][0]["docs"] == ["INV-NS-301"] and s["per_type"]["MISSING_LINK"]["recall"] == 0
    exp["flags"] = [e for e in exp["flags"] if e["type"] != "DUPLICATE"]
    s = score(tg, exp)
    assert s["fp"] == 1 and s["extra"][0]["type"] == "DUPLICATE" and not s["ok"]


def test_one_flag_cannot_answer_two_expected_flags(tg):
    exp = json.loads((TG / "expected.json").read_text(encoding="utf-8"))
    exp["flags"].append(dict(exp["flags"][0]))  # the same POLICY_BREACH expected twice
    s = score(tg, exp)
    assert s["fn"] == 1 and s["per_type"]["POLICY_BREACH"] == {"tp": 1, "fn": 1, "fp": 0, "recall": 0.5, "precision": 1.0}


def test_two_contract_flags_on_one_invoice_are_paired_by_leading_document(tg):
    s = score(tg, json.loads((TG / "expected.json").read_text(encoding="utf-8")))
    ids = {x["expected"]["why"][:20]: x["flag"] for x in s["found"] if x["expected"]["type"] == "CONTRACT_BREACH"}
    period = next(f for f in tg["flags"] if f["basis"] == "สัญญา:period")
    ceiling = next(f for f in tg["flags"] if f["basis"] == "สัญญา:ceiling")
    assert period["id"] in ids.values() and ceiling["id"] in ids.values()


def test_clean_set_has_no_skipped_checks(ff):
    assert ff["coverage"]["skipped_checks"] == []


def test_skipped_checks_name_the_silent_spots(tg):
    skipped = {(b["doc"], b["reason"].split(":")[0].split(" ")[0]): b for b in tg["coverage"]["skipped_checks"]}
    pending = skipped[("INV-TG-110", "รอจับคู่")]
    assert {"VALUE_MISMATCH", "CONTRACT_BREACH"} <= set(pending["checks"])
    scan = next(b for b in tg["coverage"]["skipped_checks"] if b["doc"].startswith("INV-BS-205_scan"))
    assert "invoice_no" in scan["reason"] and scan["checks"] == ["CONTRACT_BREACH"]
    half_way = sorted(b["doc"] for b in tg["coverage"]["skipped_checks"] if "ยังไม่มี Invoice" in b["reason"])
    assert half_way == ["PO-2026-007", "PO-2026-008"]
