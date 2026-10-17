"""FN/FP cross-check.

score()       : compare a run with an answer key (expected.json) → per-type TP / FN / FP, recall, precision.
blind_spots() : every check the rules could not run, and why ("ไม่มี flag" ≠ "ไม่มีปัญหา"). Goes into
                coverage.skipped_checks so the auditor sees where silence means "not checked", not "fine".

Usage: python -m auditconcierge.crosscheck <engagement folder> [expected.json] [--json]
Exit code 1 when anything was missed (FN), raised extra (FP), flagged a clean transaction or the
"รอจับคู่" list differs from the key.
"""
import argparse
import json
import sys
from pathlib import Path

# Which checks read which field, per document kind (mirrors rules.py and contracts.py).
USES = {
    "po": {"amount": ["POLICY_BREACH", "VALUE_MISMATCH"], "approver_role": ["POLICY_BREACH"], "date": ["DATE_ORDER"]},
    "gr": {"amount": ["VALUE_MISMATCH"], "date": ["DATE_ORDER"]},
    "invoice": {"subtotal": ["VALUE_MISMATCH", "CONTRACT_BREACH"], "total": ["VALUE_MISMATCH", "DUPLICATE"],
                "date": ["DATE_ORDER", "DUPLICATE", "CONTRACT_BREACH"], "invoice_no": ["CONTRACT_BREACH"],
                "tax_id": ["PARTY_MISMATCH"], "po_ref": ["VALUE_MISMATCH", "MISSING_LINK"],
                "credit_days": ["TEXT_CONFLICT"], "unit_price": ["CONTRACT_BREACH"], "quantity": ["CONTRACT_BREACH"], "item": ["CONTRACT_BREACH"]},
    "payment": {"amount": ["VALUE_MISMATCH"], "date": ["DATE_ORDER", "CONTRACT_BREACH"], "account": ["PARTY_MISMATCH"]},
    "contract": {"credit_days": ["TEXT_CONFLICT", "CONTRACT_BREACH"], "start_date": ["CONTRACT_BREACH"], "end_date": ["CONTRACT_BREACH"],
                 "ceiling": ["CONTRACT_BREACH"], "vendor_name": ["PARTY_MISMATCH"], "tax_id": ["PARTY_MISMATCH", "CONTRACT_BREACH"]},
}
# A document without these fields cannot be compared at all.
REQUIRED = {"po": ["amount", "date"], "invoice": ["total", "date"], "payment": ["amount", "date"], "gr": ["amount", "date"]}
KIND_TH = {"po": "PO", "gr": "ใบรับของ", "invoice": "Invoice", "payment": "รายการโอน", "contract": "สัญญา"}


def blind_spots(records, links, txns, book, cfg):
    """→ [{"doc", "kind", "checks", "reason"}], one row per document and reason."""
    out = []
    link_of = {l.child: l for l in links}
    by_id = {r.id: r for r in records}

    def add(rec, checks, reason):
        out.append({"doc": rec.id, "kind": rec.kind, "checks": sorted(set(checks)), "reason": reason})

    for rule in cfg.get("rules", []):
        if not rule.get("verified"):
            out.append({"doc": rule["source_doc"], "kind": "policy", "checks": ["POLICY_BREACH"] if rule.get("kind") == "approval_threshold" else ["PARTY_MISMATCH"],
                        "reason": f"ไม่พบข้อความของกฎ {rule['id']} ในเอกสารนโยบาย จึงไม่ได้ใช้กฎนี้ตรวจ"})

    for r in records:
        uses = USES.get(r.kind, {})
        for name, f in r.fields.items():
            checks = uses.get(name) or (["CONTRACT_BREACH"] if r.kind == "contract" and name.startswith("price:") else None)
            if checks and not (f.clear and f.verified):
                why = "อ่านไม่ชัด" if not f.clear else "ข้อความอ้างอิงไม่พบในเอกสาร"
                add(r, checks, f"{name} {why} จึงไม่ได้ใช้ตรวจ")
        for name in REQUIRED.get(r.kind, []):
            if name not in r.fields:
                add(r, uses.get(name, []), f"ไม่พบ {name} ใน{KIND_TH[r.kind]} จึงเทียบกับเอกสารอื่นไม่ได้")

        if r.kind in ("invoice", "payment", "contract") and r.vendor is None:
            checks = {"invoice": ["PARTY_MISMATCH", "CONTRACT_BREACH"], "payment": ["PARTY_MISMATCH"],
                      "contract": ["PARTY_MISMATCH", "CONTRACT_BREACH"]}[r.kind]
            add(r, checks, f"ระบุ vendor ไม่ได้ ({r.vendor_how or 'ไม่ทราบเหตุ'}) จึงไม่ได้เทียบกับ Vendor master" +
                (" และสัญญา" if r.kind != "payment" else ""))
        elif r.kind == "payment" and r.vendor and "account_token" not in r.fields:
            add(r, ["PARTY_MISMATCH"], "ไม่มีเลขบัญชีปลายทาง จึงไม่ได้เทียบกับบัญชีใน Vendor master")

        l = link_of.get(r.id)
        if l and l.level == "pending":
            add(r, ["VALUE_MISMATCH", "DATE_ORDER", "CONTRACT_BREACH"] if r.kind == "invoice" else ["VALUE_MISMATCH", "DATE_ORDER"],
                "รอจับคู่: ยังไม่ได้เทียบกับเอกสารคู่และสัญญาจนกว่าผู้ตรวจยืนยันคู่")
        elif l and l.level == "none" and r.kind == "payment":
            add(r, ["VALUE_MISMATCH", "DATE_ORDER", "DUPLICATE"], "รายการโอนนี้ไม่พบ Invoice ที่จับคู่ได้ (เงินออกโดยไม่มีเอกสารรองรับในชุดนี้)")
        elif l and l.level == "none" and r.kind == "gr":
            add(r, ["VALUE_MISMATCH", "DATE_ORDER"], "ใบรับของไม่ได้อ้าง PO ที่มีอยู่ จึงไม่ได้เทียบยอดและวันที่")

    for t in txns:
        kinds = {by_id[m].kind for m in t["members"]}
        if "po" in kinds and "invoice" not in kinds and not any(link_of.get(m) and link_of[m].level == "pending" for m in t["members"]):
            po = next(by_id[m] for m in t["members"] if by_id[m].kind == "po")
            what = "มีใบรับของแต่ยังไม่มี Invoice" if "gr" in kinds else "ยังไม่มีใบรับของและ Invoice"
            add(po, ["VALUE_MISMATCH"], f"{what} ในชุดเอกสาร (ค้างครึ่งทาง ยังไม่ได้เทียบยอดกับ Invoice)")
    return out


def score(result: dict, expected: dict) -> dict:
    """An expected flag is found when a flag of the same type lists its first document.
    Each raised flag can answer one expected flag only, so a missing second flag shows up as FN.
    Flags that lead with the same document are paired first, so two flags on one invoice are not swapped."""
    flags = result["flags"]
    used, hit = set(), {}
    for leading in (True, False):
        for n, exp in enumerate(expected["flags"]):
            if n in hit:
                continue
            cands = [f for f in flags if f["id"] not in used and f["type"] == exp["type"]
                     and (f["docs"][:1] == exp["docs"][:1] if leading else exp["docs"][0] in f["docs"])]
            if cands:
                best = max(cands, key=lambda f: (len(set(exp["docs"]) & set(f["docs"])), -flags.index(f)))
                used.add(best["id"])
                hit[n] = best["id"]
    found = [{"expected": e, "flag": hit[n]} for n, e in enumerate(expected["flags"]) if n in hit]
    missed = [e for n, e in enumerate(expected["flags"]) if n not in hit]
    extra = [f for f in flags if f["id"] not in used]

    clean_flagged = []
    for doc in expected.get("clean", []):
        txn = next((t for t in result["transactions"] if doc in t["members"]), None)
        if txn and txn["flags"]:
            clean_flagged.append({"doc": doc, "flags": txn["flags"]})
    got_pending = sorted(p["doc"] for p in result["pending"])
    exp_pending = sorted(expected.get("pending_match", []))

    per_type = {}
    for t in sorted({e["type"] for e in expected["flags"]} | {f["type"] for f in flags}):
        tp = sum(1 for x in found if x["expected"]["type"] == t)
        fn = sum(1 for e in missed if e["type"] == t)
        fp = sum(1 for f in extra if f["type"] == t)
        per_type[t] = {"tp": tp, "fn": fn, "fp": fp,
                       "recall": round(tp / (tp + fn), 3) if tp + fn else None,
                       "precision": round(tp / (tp + fp), 3) if tp + fp else None}
    tp, fn, fp = len(found), len(missed), len(extra)
    return {
        "tp": tp, "fn": fn, "fp": fp,
        "recall": round(tp / (tp + fn), 3) if tp + fn else None,
        "precision": round(tp / (tp + fp), 3) if tp + fp else None,
        "per_type": per_type,
        "found": found,
        "missed": [{"type": e["type"], "docs": e["docs"], "why": e.get("why", "")} for e in missed],
        "extra": [{"id": f["id"], "type": f["type"], "docs": f["docs"], "summary": f["summary"]} for f in extra],
        "clean_flagged": clean_flagged,
        "pending": {"expected": exp_pending, "got": got_pending, "ok": got_pending == exp_pending},
        "ok": not missed and not extra and not clean_flagged and got_pending == exp_pending,
    }


def _pct(x):
    return "-" if x is None else f"{x:.0%}"


def report(s: dict, skipped: list | None = None) -> str:
    lines = [f"{'ประเภท':16s} {'TP':>3s} {'FN':>3s} {'FP':>3s}  recall precision"]
    for t, c in s["per_type"].items():
        lines.append(f"{t:16s} {c['tp']:3d} {c['fn']:3d} {c['fp']:3d}  {_pct(c['recall']):>6s} {_pct(c['precision']):>9s}")
    lines.append(f"{'รวม':16s} {s['tp']:3d} {s['fn']:3d} {s['fp']:3d}  {_pct(s['recall']):>6s} {_pct(s['precision']):>9s}")
    for m in s["missed"]:
        lines.append(f"  FN พลาด {m['type']} {', '.join(m['docs'])}: {m['why']}")
    for e in s["extra"]:
        lines.append(f"  FP เกิน {e['id']} {e['type']} {', '.join(e['docs'])}: {e['summary']}")
    for c in s["clean_flagged"]:
        lines.append(f"  FP ธุรกรรมสะอาด {c['doc']} ถูกยก {', '.join(c['flags'])}")
    if not s["pending"]["ok"]:
        lines.append(f"  รอจับคู่ต่างจากเฉลย: ได้ {s['pending']['got']} เฉลย {s['pending']['expected']}")
    if skipped is not None:
        lines.append(f"จุดที่ตรวจไม่ได้ {len(skipped)} รายการ (ดู coverage.skipped_checks)")
        for b in skipped:
            lines.append(f"  - {b['doc']}: {b['reason']} [{', '.join(b['checks'])}]")
    lines.append("ผ่าน: ไม่มี FN/FP" if s["ok"] else "ไม่ผ่าน")
    return "\n".join(lines)


def main():
    from .build import build

    ap = argparse.ArgumentParser(description="Score a run against an answer key (FN/FP cross-check)")
    ap.add_argument("folder", type=Path)
    ap.add_argument("expected", type=Path, nargs="?", help="default: <folder>/expected.json, else <folder>/../expected.json")
    ap.add_argument("--extractor", choices=("auto", "llm", "template"), default="template")
    ap.add_argument("--json", action="store_true", help="print the score as JSON")
    a = ap.parse_args()
    exp_path = a.expected or next((p for p in (a.folder / "expected.json", a.folder.parent / "expected.json") if p.exists()), None)
    if exp_path is None:
        ap.error("no expected.json found; pass its path")
    result = build(a.folder, extractor=a.extractor)
    s = score(result, json.loads(exp_path.read_text(encoding="utf-8")))
    skipped = result["coverage"]["skipped_checks"]
    print(json.dumps(s | {"skipped_checks": skipped}, ensure_ascii=False, indent=1) if a.json else report(s, skipped))
    sys.exit(0 if s["ok"] else 1)


if __name__ == "__main__":
    main()
