"""Conflict rules. Code decides; every flag carries the quotes of both sides.

Flags are "ควรตรวจ" (worth a closer look), never a conclusion that something is wrong.
A field that is unverified or unclear is never used to raise a flag.
"""
from collections import defaultdict

from .matching import within

BASE_SEVERITY = {"PARTY_MISMATCH": 5, "DUPLICATE": 5, "POLICY_BREACH": 4, "VALUE_MISMATCH": 4,
                 "MISSING_LINK": 3, "DATE_ORDER": 3, "TEXT_CONFLICT": 2}
TITLES = {
    "VALUE_MISMATCH": "ยอดเงินไม่ตรงกัน", "PARTY_MISMATCH": "คู่ค้า/บัญชีรับเงินไม่ตรง", "DATE_ORDER": "ลำดับวันที่ผิดปกติ",
    "MISSING_LINK": "ไม่พบเอกสารที่ควรมี", "POLICY_BREACH": "ไม่เป็นไปตามกฎของบริษัท", "DUPLICATE": "อาจซ้ำซ้อน",
    "TEXT_CONFLICT": "เงื่อนไขในเอกสารไม่ตรงกัน",
}
QUESTIONS = {
    "VALUE_MISMATCH": ["ขอเอกสารแก้ไข PO หรือใบลดหนี้ที่อธิบายส่วนต่าง", "ส่วนต่างนี้ได้รับอนุมัติโดยใคร"],
    "PARTY_MISMATCH": ["บัญชีปลายทางนี้เป็นของ vendor จริงหรือไม่ มีหนังสือแจ้งเปลี่ยนบัญชีหรือเปล่า", "ใครเป็นผู้อนุมัติการโอนรายการนี้"],
    "DATE_ORDER": ["เหตุใดจึงจ่ายเงินก่อนวันที่ในใบกำกับภาษี", "มีข้อตกลงจ่ายล่วงหน้าหรือเงินมัดจำหรือไม่"],
    "MISSING_LINK": ["ขอ PO และใบรับของของรายการนี้", "การซื้อนี้ผ่านขั้นตอนจัดซื้อตามปกติหรือไม่"],
    "POLICY_BREACH": ["มีหลักฐานการอนุมัติจาก Manager นอกระบบหรือไม่", "ผู้อนุมัติมีอำนาจอนุมัติวงเงินนี้หรือไม่"],
    "DUPLICATE": ["Invoice นี้ถูกบันทึกและจ่ายซ้ำหรือไม่", "ขอหลักฐานการคืนเงินหรือหักกลบ ถ้ามีการจ่ายซ้ำ"],
    "TEXT_CONFLICT": ["เงื่อนไขใดเป็นข้อตกลงที่ใช้จริง", "มีการแก้ไขสัญญาหรือข้อตกลงใหม่หรือไม่"],
}


def ev(rec, name, label=None):
    """Evidence item for one field of one record (None if the field is unusable)."""
    f = rec.fields.get(name)
    if f is None or not f.clear or not f.verified:
        return None
    return {"doc": rec.id, "file": rec.file, "format": rec.format, "field": label or name, "value": f.value,
            "quote": f.quote, "locator": f.locator, "method": f.method, "bbox": f.bbox}


class Flagger:
    def __init__(self, cfg):
        self.cfg, self.flags, self.links = cfg, [], []

    def add(self, typ, docs, summary, evidence, *, match="sure", at_stake=0.0, basis=None, txn=None):
        evidence = [e for e in evidence if e]
        sev = BASE_SEVERITY[typ] + (1 if at_stake >= self.cfg["materiality_thb"] else 0) - (1 if match == "likely" else 0)
        self.flags.append({
            "id": f"F{len(self.flags) + 1:03d}", "type": typ, "title": TITLES[typ], "summary": summary,
            "docs": docs, "transaction": txn, "evidence": evidence, "basis": basis or "rule",
            "match": match, "at_stake_thb": round(at_stake, 2), "severity": sev,
            "risk": "สูง" if sev >= 5 else "กลาง" if sev >= 3 else "ต่ำ",
            "status": "ควรตรวจ", "questions": QUESTIONS[typ],
            "ocr": any(e["method"] == "ocr" for e in evidence),
        })

    def compare(self, txn, a, b, field_a, field_b, label):
        self.links.append({"transaction": txn, "a": a.id, "b": b.id, "field": label,
                           "status": "agrees" if within(a.v(field_a), b.v(field_b), self.cfg["tolerance_pct"]) else "conflicts"})
        return self.links[-1]["status"] == "agrees"


def run_rules(records, links, txns, book, cfg):
    by_id = {r.id: r for r in records}
    link_of = {l.child: l for l in links}
    fl = Flagger(cfg)
    tol = cfg["tolerance_pct"]
    rule = {r["id"]: r for r in cfg["rules"]}

    # ---- POLICY_BREACH (rule R1, from Remember) ----
    r1 = rule.get("R1")
    if r1 and r1.get("verified"):
        for po in (r for r in records if r.kind == "po"):
            amt, role = po.v("amount"), po.v("approver_role")
            if amt is not None and amt > r1["threshold_thb"] and role != r1["required_role"]:
                fl.add("POLICY_BREACH", [po.id],
                       f"{po.id} ยอด {amt:,.0f} ฿ อนุมัติโดย {po.v('approved_by')} ({role}) แต่กฎ R1 กำหนดให้ {r1['required_role']} อนุมัติเมื่อเกิน {r1['threshold_thb']:,} ฿",
                       [ev(po, "amount"), ev(po, "approver_role"),
                        {"doc": r1["source_doc"], "file": r1["source_doc"], "format": "pdf", "field": "กฎ R1",
                         "value": r1["source_quote"], "quote": r1["source_quote"], "locator": "นโยบายการจัดซื้อ", "method": "template", "bbox": None}],
                       at_stake=amt, basis="R1", txn=f"T-{po.id}")

    for t in txns:
        mem = [by_id[m] for m in t["members"]]
        pos = [r for r in mem if r.kind == "po"]
        grs = [r for r in mem if r.kind == "gr"]
        invs = [r for r in mem if r.kind == "invoice"]
        pays = [r for r in mem if r.kind == "payment"]
        tid = t["id"]

        def lvl(rec):
            l = link_of.get(rec.id)
            return l.level if l else "sure"

        # ---- VALUE_MISMATCH ----
        for po in pos:
            for gr in grs:
                if not fl.compare(tid, po, gr, "amount", "amount", "มูลค่า PO ↔ ใบรับของ"):
                    fl.add("VALUE_MISMATCH", [po.id, gr.id], f"PO {po.v('amount'):,.0f} ฿ แต่ใบรับของ {gr.v('amount'):,.0f} ฿",
                           [ev(po, "amount"), ev(gr, "amount")], at_stake=abs(po.v("amount") - gr.v("amount")), txn=tid)
            for inv in invs:
                if inv.v("subtotal") is None:
                    continue
                if not fl.compare(tid, po, inv, "amount", "subtotal", "ยอดก่อน VAT PO ↔ Invoice"):
                    diff = inv.v("subtotal") - po.v("amount")
                    gr_ok = [gr for gr in grs if within(gr.v("amount"), po.v("amount"), tol)]
                    fl.add("VALUE_MISMATCH", [po.id, inv.id] + [g.id for g in gr_ok],
                           f"PO {po.v('amount'):,.0f} ฿" + (" และใบรับของ" if gr_ok else "") + f" แต่ Invoice {inv.v('subtotal'):,.0f} ฿ (ต่าง {diff:+,.0f} ฿)",
                           [ev(po, "amount"), *[ev(g, "amount") for g in gr_ok], ev(inv, "subtotal")],
                           match=lvl(inv), at_stake=abs(diff), txn=tid)
        for pay in pays:
            inv = next((i for i in invs if i.id == (link_of[pay.id].parent if pay.id in link_of else None)), None)
            if inv and inv.v("total") is not None and not fl.compare(tid, inv, pay, "total", "amount", "ยอดรวม Invoice ↔ เงินที่โอน"):
                diff = pay.v("amount") - inv.v("total")
                fl.add("VALUE_MISMATCH", [inv.id, pay.id], f"Invoice {inv.v('total'):,.2f} ฿ แต่โอน {pay.v('amount'):,.2f} ฿",
                       [ev(inv, "total"), ev(pay, "amount")], match=lvl(pay), at_stake=abs(diff), txn=tid)

        # ---- DATE_ORDER ----
        for po in pos:
            for gr in grs:
                if gr.v("date") and po.v("date") and gr.v("date") < po.v("date"):
                    fl.add("DATE_ORDER", [po.id, gr.id], f"รับของ {gr.v('date')} ก่อนออก PO {po.v('date')}",
                           [ev(po, "date"), ev(gr, "date")], at_stake=po.v("amount", 0), txn=tid)
        for pay in pays:
            inv = next((i for i in invs if pay.id in link_of and i.id == link_of[pay.id].parent), None)
            if inv and inv.v("date") and pay.v("date") and pay.v("date") < inv.v("date"):
                fl.add("DATE_ORDER", [inv.id, pay.id], f"โอนเงิน {pay.v('date')} ก่อนวันที่ใน Invoice {inv.v('date')}",
                       [ev(inv, "date", "วันที่ Invoice"), ev(pay, "date", "วันที่โอน")], match=lvl(pay), at_stake=pay.v("amount", 0), txn=tid)

        # ---- PARTY_MISMATCH ----
        for pay in pays:
            v = book.vendors.get(pay.vendor) if pay.vendor else None
            acct, tok = pay.v("account"), pay.v("account_token")
            if v and tok and tok != v["account_token"]:
                fl.add("PARTY_MISMATCH", [d.id for d in invs] + [pay.id],
                       f"โอนเข้าบัญชี {acct} แต่บัญชีของ {v['name_th']} ใน Vendor master คือ {v['account_masked']}",
                       [ev(pay, "account", "บัญชีปลายทาง"), {"doc": v["record"], "file": "vendor_master.csv", "format": "csv", "field": "บัญชีใน Vendor master",
                            "value": v["account_masked"], "quote": f"{v['code']} {v['name_th']} บัญชี {v['account_masked']}",
                            "locator": "Vendor master", "method": "table", "bbox": None}],
                       match=lvl(pay), at_stake=pay.v("amount", 0), basis="R2", txn=tid)
        for inv in invs:
            v = book.vendors.get(inv.vendor) if inv.vendor else None
            if v and inv.v("tax_id") and inv.v("tax_id") != v["tax_id"]:
                fl.add("PARTY_MISMATCH", [inv.id], "เลขผู้เสียภาษีใน Invoice ไม่ตรงกับ Vendor master",
                       [ev(inv, "tax_id")], at_stake=inv.v("total", 0), txn=tid)

        # ---- DUPLICATE (same invoice number, or same vendor + date + total in another file) ----
        groups = defaultdict(list)
        for inv in invs:
            groups[(inv.vendor, inv.fields["date"].value if "date" in inv.fields else None,
                    inv.fields["total"].value if "total" in inv.fields else None)].append(inv)
        for (_, _, total), same in groups.items():
            pay_count = defaultdict(list)
            for p in pays:
                if p.id in link_of and link_of[p.id].parent in {s.id for s in same}:
                    pay_count[link_of[p.id].parent].append(p)
            twice = [p for ps in pay_count.values() if len(ps) > 1 for p in ps]
            if len(same) > 1 or twice:
                files = sorted({s.file for s in same})
                fl.add("DUPLICATE", [s.id for s in same] + [p.id for p in twice],
                       (f"Invoice ยอด {total:,.2f} ฿ พบใน {len(files)} ไฟล์" if len(same) > 1 else "") +
                       (" และ" if len(same) > 1 and twice else "") + (f"ถูกโอนจ่าย {len(twice)} ครั้ง" if twice else ""),
                       [x for s in same for x in (ev(s, "invoice_no"), ev(s, "total"), ev(s, "date"))] +
                       [ev(p, "description", "รายการโอน") for p in twice],
                       at_stake=total or 0, txn=tid)

        # ---- MISSING_LINK: invoice with no PO/GR (after searching every document's full text) ----
        for inv in invs:
            l = link_of.get(inv.id)
            if l and l.level == "none" and not pos:
                mentioned = [r.id for r in records if r.id != inv.id and r.kind in ("po", "gr") and inv.id in r.text]
                if not mentioned:
                    fl.add("MISSING_LINK", [inv.id],
                           f"{inv.id} ({inv.v('total', 0):,.2f} ฿) ไม่มี PO และใบรับของอ้างถึง ค้นข้อความเต็มทุกไฟล์แล้วไม่พบ (ไม่พบ ≠ ไม่มี)",
                           [ev(inv, "invoice_no"), ev(inv, "vendor_name"), ev(inv, "total")],
                           at_stake=inv.v("total", 0), txn=tid)

    # ---- TEXT_CONFLICT: contract terms vs invoice terms (structured field, checked by code) ----
    for c in (r for r in records if r.kind == "contract"):
        for inv in (r for r in records if r.kind == "invoice" and r.vendor and r.vendor == c.vendor):
            cd, idays = c.v("credit_days"), inv.v("credit_days")
            if cd is not None and idays is not None and cd != idays:
                tid = next((t["id"] for t in txns if inv.id in t["members"]), None)
                fl.add("TEXT_CONFLICT", [c.id, inv.id], f"สัญญากำหนดเครดิต {cd} วัน แต่ {inv.id} ระบุ {idays} วัน",
                       [ev(c, "credit_days", "เครดิตตามสัญญา"), ev(inv, "credit_days", "เครดิตใน Invoice")],
                       at_stake=0, txn=tid)

    fl.flags.sort(key=lambda f: (-f["severity"], -f["at_stake_thb"], f["id"]))
    return fl.flags, fl.links
