"""Contract checks on the TG Company sample: each planted breach is found with the contract
clause quoted next to the document it is compared with, and nothing else is flagged."""
import json
from pathlib import Path

import pytest

from auditconcierge.build import build

SAMPLE = Path(__file__).resolve().parent.parent / "samples" / "tg_company"
EXPECTED = json.loads((SAMPLE / "expected.json").read_text(encoding="utf-8"))
CONTRACT_EXP = [e for e in EXPECTED["flags"] if any(d.startswith("CONTRACT-") for d in e["docs"])]


@pytest.fixture(scope="module")
def result():
    return build(SAMPLE)


@pytest.mark.parametrize("exp", CONTRACT_EXP, ids=lambda e: f"{e['type']}-{e['docs'][0]}")
def test_contract_breach_is_found_with_both_sides_quoted(result, exp):
    hits = [f for f in result["flags"] if f["type"] == exp["type"] and f["docs"][0] == exp["docs"][0]
            and set(exp["docs"]) <= set(f["docs"])]
    assert len(hits) == 1, f"{exp['why']}: {[f['summary'] for f in result['flags']]}"
    contract = next(d for d in exp["docs"] if d.startswith("CONTRACT-"))
    docs_quoted = {e["doc"] for e in hits[0]["evidence"]}
    assert contract in docs_quoted and len(docs_quoted) >= 2, hits[0]["evidence"]


def test_unit_price_overcharge_is_the_at_stake_amount(result):
    f = next(f for f in result["flags"] if f["basis"] == "สัญญา:price")
    assert f["at_stake_thb"] == 5000  # 500 × (130 − 120)


def test_ceiling_counts_each_invoice_once(result):
    f = next(f for f in result["flags"] if f["basis"] == "สัญญา:ceiling")
    # INV-BS-205 (PDF) + INV-BS-201 + INV-BS-210; the scan of INV-BS-205 has an unreadable number
    assert f["at_stake_thb"] == 110000 - 80000
    assert not any("_scan" in d for d in f["docs"])


def test_invoices_within_contract_terms_are_not_flagged(result):
    contract_flags = [f for f in result["flags"] if f["basis"].startswith("สัญญา:")]
    for inv in ("INV-TG-101", "INV-TG-103", "INV-TG-105", "INV-TG-110"):
        assert not any(inv in f["docs"] for f in contract_flags), inv
