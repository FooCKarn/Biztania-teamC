"""Seeded-error (mutation) tests: change one fact of the frozen-foods engagement and re-run.

FN side: each rule must raise exactly the new flag the change calls for.
FP side: a near miss (inside tolerance, on a boundary, an inferred match) must raise nothing new.
Known blind spots are strict xfails: when a rule learns to catch one, the xfail fails and this file
(and docs/mvp.md) must be updated. Silent spots that cannot be flagged must at least show up in
coverage.skipped_checks.
"""
import json
import sys
from collections import Counter
from pathlib import Path

import pytest

from auditconcierge.build import build

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "samples"))
import frozen_foods  # noqa: E402


def _key(f):
    return f["type"], tuple(f["docs"])


@pytest.fixture(scope="module")
def base(tmp_path_factory):
    folder = tmp_path_factory.mktemp("base")
    frozen_foods.write(folder)
    return Counter(_key(f) for f in build(folder)["flags"])


def run(tmp_path, change):
    d = frozen_foods.default_data()
    change(d)
    frozen_foods.write(tmp_path, d)
    return build(tmp_path)


def new_flags(result, base):
    return list((Counter(_key(f) for f in result["flags"]) - base).elements())


def row(rows, first):
    return next(r for r in rows if r[0] == first)


def pay(d, inv):
    return next(p for p in d["payments"] if p[1] == inv)


def set_invoice(d, no, *, sub=None, days="keep", qty_price=None):
    inv = row(d["invoices"], no)
    if sub is not None:
        inv[4] = sub
    if days != "keep":
        inv[5] = days
    if qty_price:
        d["items"][no][1], d["items"][no][3] = qty_price


def total(sub):
    return round(sub * 1.07, 2)


# (name, change, expected new flag type, document the new flag must list)
MUST_FLAG = [
    ("po_amount_over_tolerance", lambda d: row(d["pos"], "PO-2026-101").__setitem__(4, 49000), "VALUE_MISMATCH", "PO-2026-101"),
    ("payment_amount_differs", lambda d: pay(d, "INV-LG-503").__setitem__(2, 40000.00), "VALUE_MISMATCH", "INV-LG-503"),
    ("payment_to_unregistered_account", lambda d: pay(d, "INV-CH-604").__setitem__(3, "777-7-11111-2"), "PARTY_MISMATCH", "INV-CH-604"),
    ("invoice_tax_id_differs", lambda d: d["invoice_overrides"].__setitem__("INV-CH-604", {"tax_id": "0999990000099"}), "PARTY_MISMATCH", "INV-CH-604"),
    ("invoice_paid_twice", lambda d: d["payments"].append(["2026-07-01", "INV-LG-503", total(38000), None]), "DUPLICATE", "INV-LG-503"),
    ("rebilled_same_day_new_number", lambda d: d["invoices"].append(["INV-LG-504", "2026-06-15", "V102", "PO-2026-109", 38000, None]),
     "DUPLICATE", "INV-LG-504"),
    ("po_over_threshold_not_manager", lambda d: d["pos"].append(["PO-2026-120", "2026-06-10", "V103", "อุปกรณ์ห้องเย็น", 120000, "ปิติ ตัวอย่าง", "Purchasing Officer"]),
     "POLICY_BREACH", "PO-2026-120"),
    ("paid_before_invoice", lambda d: pay(d, "INV-LG-503").__setitem__(0, "2026-06-10"), "DATE_ORDER", "INV-LG-503"),
    ("po_missing", lambda d: d["pos"].remove(row(d["pos"], "PO-2026-112")), "MISSING_LINK", "INV-CH-604"),
    ("unit_price_above_contract", lambda d: (row(d["pos"], "PO-2026-101").__setitem__(4, 52000), pay(d, "INV-PK-401").__setitem__(2, total(52000)),
                                              set_invoice(d, "INV-PK-401", sub=52000, qty_price=(2000, 26))),
     "CONTRACT_BREACH", "INV-PK-401"),
    ("invoice_credit_days_differ", lambda d: set_invoice(d, "INV-PK-401", days=60), "TEXT_CONFLICT", "INV-PK-401"),
    ("invoice_after_contract_end", lambda d: d["contracts"]["contract_lg.pdf"].__setitem__("end", "2026-06-10"), "CONTRACT_BREACH", "INV-LG-503"),
    ("paid_after_credit_term", lambda d: pay(d, "INV-LG-503").__setitem__(0, "2026-07-16"), "CONTRACT_BREACH", "INV-LG-503"),
    ("cumulative_over_ceiling", lambda d: d["contracts"]["contract_lg.pdf"].__setitem__("ceiling", 120000), "CONTRACT_BREACH", "INV-LG-503"),
    ("contract_party_name_differs", lambda d: d["contracts"]["contract_pk.pdf"].__setitem__("party", "บริษัท ตัวอย่างบรรจุภัณฑ์ แอนด์ การพิมพ์ จำกัด"),
     "PARTY_MISMATCH", "CONTRACT-PK"),
]

MUST_NOT_FLAG = [
    ("po_amount_on_tolerance_boundary", lambda d: row(d["pos"], "PO-2026-101").__setitem__(4, 49500)),
    ("po_amount_inside_tolerance", lambda d: row(d["pos"], "PO-2026-101").__setitem__(4, 49800)),
    ("payment_inside_tolerance", lambda d: pay(d, "INV-LG-503").__setitem__(2, total(38000) - 200)),
    ("po_exactly_on_threshold", lambda d: d["pos"].append(["PO-2026-120", "2026-06-10", "V103", "อุปกรณ์ห้องเย็น", 100000, "ปิติ ตัวอย่าง", "Purchasing Officer"])),
    ("po_over_threshold_by_manager", lambda d: d["pos"].append(["PO-2026-120", "2026-06-10", "V103", "อุปกรณ์ห้องเย็น", 150000, "มานี ทดสอบ", "Manager"])),
    ("paid_on_invoice_date", lambda d: pay(d, "INV-LG-503").__setitem__(0, "2026-06-15")),
    ("paid_on_last_credit_day", lambda d: pay(d, "INV-LG-503").__setitem__(0, "2026-07-15")),
    ("cumulative_exactly_ceiling", lambda d: d["contracts"]["contract_lg.pdf"].__setitem__("ceiling", 126000)),
    ("invoice_on_contract_end_date", lambda d: d["contracts"]["contract_lg.pdf"].__setitem__("end", "2026-06-15")),
    ("unit_price_inside_tolerance", lambda d: (row(d["pos"], "PO-2026-101").__setitem__(4, 50400), pay(d, "INV-PK-401").__setitem__(2, total(50400)),
                                               set_invoice(d, "INV-PK-401", sub=50400, qty_price=(2000, 25.2)))),
    ("invoice_without_po_ref_but_one_candidate", lambda d: row(d["invoices"], "INV-CH-604").__setitem__(3, None)),
    ("vat_only_difference_on_new_po", lambda d: (d["pos"].append(["PO-2026-113", "2026-06-06", "V103", "ถุงมือ", 10000, "มานี ทดสอบ", "Manager"]),
                                                  d["invoices"].append(["INV-CH-605", "2026-06-09", "V103", "PO-2026-113", 10000, None]),
                                                  d["payments"].append(["2026-06-26", "INV-CH-605", total(10000), None]))),
]


@pytest.mark.parametrize("name,change,typ,doc", MUST_FLAG, ids=[m[0] for m in MUST_FLAG])
def test_seeded_error_is_flagged(tmp_path, base, name, change, typ, doc):
    got = new_flags(run(tmp_path, change), base)
    assert [t for t, docs in got if doc in docs] == [typ], f"{name}: new flags {got}"
    assert len(got) == 1, f"{name}: extra flags besides the seeded one {got}"


@pytest.mark.parametrize("name,change", MUST_NOT_FLAG, ids=[m[0] for m in MUST_NOT_FLAG])
def test_near_miss_is_not_flagged(tmp_path, base, name, change):
    got = new_flags(run(tmp_path, change), base)
    assert got == [], f"{name}: false positive {got}"


def test_inferred_match_is_still_checked(tmp_path, base):
    """No PO number on the invoice, one candidate PO → likely match, and a wrong amount is still flagged."""
    def change(d):
        row(d["invoices"], "INV-CH-604")[3] = None
        pay(d, "INV-CH-604")[2] = 20000.00
    res = run(tmp_path, change)
    got = new_flags(res, base)
    assert [(t, docs[0]) for t, docs in got] == [("VALUE_MISMATCH", "INV-CH-604")]
    doc = next(x for x in res["documents"] if x["id"] == "INV-CH-604")
    assert doc["link"]["level"] == "likely" and doc["link"]["parent"] == "PO-2026-112"
    assert next(t for t in res["transactions"] if "INV-CH-604" in t["members"])["match"] == "likely"


# ---- silent spots: no flag is possible, so they must be listed in coverage.skipped_checks ----

def skipped(res, doc):
    return [b for b in res["coverage"]["skipped_checks"] if b["doc"] == doc]


def test_payment_without_invoice_is_listed(tmp_path):
    res = run(tmp_path, lambda d: d["extra_bank_rows"].append(("2026-06-28", "TRF DUMMY CHEMICAL", 30000.00, "999-9-00003-3")))
    rows = [b for b in res["coverage"]["skipped_checks"] if b["kind"] == "payment"]
    assert len(rows) == 1 and "ไม่พบ Invoice" in rows[0]["reason"]


def test_unknown_vendor_is_listed(tmp_path):
    res = run(tmp_path, lambda d: d["invoice_overrides"].__setitem__("INV-CH-604", {"tax_id": "0999990000099", "vendor_name": "หจก. ไม่มีในทะเบียน"}))
    rows = skipped(res, "INV-CH-604")
    assert any("ระบุ vendor ไม่ได้" in b["reason"] and "PARTY_MISMATCH" in b["checks"] for b in rows)


def test_rule_without_policy_quote_is_listed_and_not_used(tmp_path):
    frozen_foods.write(tmp_path)
    rem = json.loads((tmp_path / "remember.json").read_text(encoding="utf-8"))
    rem["rules"][0]["source_quote"] = "การสั่งซื้อทุกครั้งต้องได้รับอนุมัติจาก CEO"
    (tmp_path / "remember.json").write_text(json.dumps(rem, ensure_ascii=False), encoding="utf-8")
    res = build(tmp_path)
    assert not any(f["type"] == "POLICY_BREACH" for f in res["flags"])
    assert any(b["checks"] == ["POLICY_BREACH"] and "R1" in b["reason"] for b in res["coverage"]["skipped_checks"])


# ---- known blind spots (FN by design today); strict, so a fix makes these fail and must update the list ----

@pytest.mark.xfail(strict=True, reason="DUPLICATE groups by number or vendor+date+total; a re-bill with a new number on another day is not caught")
def test_known_gap_rebilled_on_another_day(tmp_path, base):
    res = run(tmp_path, lambda d: (d["invoices"].append(["INV-LG-504", "2026-06-20", "V102", "PO-2026-109", 38000, None]),
                                   d["payments"].append(["2026-07-05", "INV-LG-504", total(38000), None])))
    assert any(t == "DUPLICATE" and "INV-LG-504" in docs for t, docs in new_flags(res, base))


@pytest.mark.xfail(strict=True, reason="R1 looks at one PO at a time; a purchase split into POs under the threshold is not caught")
def test_known_gap_split_purchase(tmp_path, base):
    split = [["PO-2026-120", "2026-06-10", "V103", "อุปกรณ์ห้องเย็น ชุด 1", 60000, "ปิติ ตัวอย่าง", "Purchasing Officer"],
             ["PO-2026-121", "2026-06-10", "V103", "อุปกรณ์ห้องเย็น ชุด 2", 60000, "ปิติ ตัวอย่าง", "Purchasing Officer"]]
    res = run(tmp_path, lambda d: d["pos"].extend(split))
    assert any(t == "POLICY_BREACH" for t, _ in new_flags(res, base))
