"""Contract checks: each vendor contract's terms against that vendor's invoices and payments.

Same rules as rules.py: code decides, every flag quotes both the contract clause and the
document it is compared with, and a field that is unclear or unverified never raises a flag.
A contract is tied to a vendor by tax id or name, not by the PO match, so an inferred
("likely") PO match does not lower these flags; invoices still waiting in "รอจับคู่" are skipped.
Invoices whose own number is unreadable (e.g. a second, scanned copy) are not counted
toward the contract ceiling, so one invoice is never summed twice.
"""
from datetime import date

from .entities import name_key
from .matching import within
from .rules import ev

CHECKS = {
    "price": ("ราคาต่อหน่วยไม่ตรงกับสัญญา",
              ["ราคาที่เรียกเก็บเปลี่ยนจากสัญญาเพราะอะไร มีบันทึกแก้ไขราคาหรือไม่", "ใครอนุมัติ PO ที่ราคาสูงกว่าสัญญา"]),
    "period": ("Invoice อยู่นอกอายุสัญญา",
               ["มีการต่ออายุสัญญาหรือทำสัญญาใหม่หรือไม่", "การซื้อหลังสัญญาหมดอายุผ่านการอนุมัติตามขั้นตอนใด"]),
    "late": ("จ่ายเงินเกินกำหนดเครดิตตามสัญญา",
             ["มีดอกเบี้ยหรือค่าปรับจากการจ่ายล่าช้าที่ควรบันทึกหรือไม่", "เหตุใดจึงจ่ายช้ากว่ากำหนด"]),
    "ceiling": ("ยอดซื้อสะสมเกินวงเงินสัญญา",
                ["มีการขยายวงเงินสัญญาหรือไม่ ขอเอกสารแก้ไขสัญญา", "ยอดที่เกินวงเงินได้รับอนุมัติโดยใคร"]),
    "party": ("ชื่อคู่สัญญาไม่ตรงกับ Vendor master",
              ["คู่สัญญาและ vendor ที่รับเงินเป็นนิติบุคคลเดียวกันหรือไม่ ขอหนังสือรับรองบริษัท", "มีการเปลี่ยนชื่อบริษัทหรือโอนสิทธิตามสัญญาหรือไม่"]),
}


def _days(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def run_contract_rules(fl, records, links, txns, book):
    by_id = {r.id: r for r in records}
    link_of = {l.child: l for l in links}
    txn_of = {m: t["id"] for t in txns for m in t["members"]}
    pays_of = {}
    for r in records:
        if r.kind == "payment" and r.id in link_of and link_of[r.id].parent:
            pays_of.setdefault(link_of[r.id].parent, []).append(r)

    def add(check, docs, summary, evidence, **kw):
        title, questions = CHECKS[check]
        fl.add("CONTRACT_BREACH", docs, summary, evidence, title=title, questions=questions, basis=f"สัญญา:{check}", **kw)

    for c in (r for r in records if r.kind == "contract"):
        invs = sorted((r for r in records if r.kind == "invoice" and r.vendor and r.vendor == c.vendor),
                      key=lambda r: (r.v("date") or "", r.id))
        v = book.vendors.get(c.vendor) if c.vendor else None

        # ---- party: the contract is bound to a vendor by tax id, but names another entity ----
        cname = c.v("vendor_name")
        if v and cname and c.fields["vendor_name"].verified and name_key(cname) not in v["keys"]:
            fl.add("PARTY_MISMATCH", [c.id, v["record"]],
                   f"{c.id} ทำกับ {cname} แต่เลขผู้เสียภาษี {c.v('tax_id')} เป็นของ {v['name_th']} ใน Vendor master",
                   [ev(c, "vendor_name", "คู่สัญญา"), ev(c, "tax_id", "เลขผู้เสียภาษีในสัญญา"), ev(by_id[v["record"]], "name_th", "ชื่อใน Vendor master")],
                   title=CHECKS["party"][0], questions=CHECKS["party"][1], basis="สัญญา:party",
                   at_stake=sum(i.v("subtotal", 0) for i in invs if i.fields.get("invoice_no") and i.fields["invoice_no"].clear))

        for inv in invs:
            tid = txn_of.get(inv.id)
            if inv.id in link_of and link_of[inv.id].level == "pending":
                continue  # not checked until the auditor confirms what it belongs to

            # ---- credit days printed on the invoice (TEXT_CONFLICT, as before) ----
            cd, idays = c.v("credit_days"), inv.v("credit_days")
            if cd is not None and idays is not None and cd != idays:
                fl.add("TEXT_CONFLICT", [c.id, inv.id], f"สัญญากำหนดเครดิต {cd} วัน แต่ {inv.id} ระบุ {idays} วัน",
                       [ev(c, "credit_days", "เครดิตตามสัญญา"), ev(inv, "credit_days", "เครดิตใน Invoice")],
                       at_stake=0, txn=tid)

            # ---- unit price vs the contract price list ----
            item, price = inv.v("item"), inv.v("unit_price")
            cprice = c.v(f"price:{item}") if item else None
            if price is not None and cprice is not None and not within(price, cprice, fl.cfg["tolerance_pct"]):
                qty = inv.v("quantity")
                diff = (price - cprice) * qty if qty is not None else 0
                add("price", [inv.id, c.id],
                    f"{inv.id} คิด{item} หน่วยละ {price:,.2f} ฿ แต่สัญญากำหนด {cprice:,.2f} ฿"
                    + (f" ({qty:,.0f} หน่วย ต่าง {diff:+,.0f} ฿)" if qty is not None else ""),
                    [ev(inv, "unit_price", f"ราคาต่อหน่วย ({item}) ใน Invoice"), ev(c, f"price:{item}", f"ราคาต่อหน่วย ({item}) ตามสัญญา")],
                    at_stake=abs(diff), txn=tid)

            # ---- invoice date inside the contract period ----
            d, start, end = inv.v("date"), c.v("start_date"), c.v("end_date")
            if d and ((end and d > end) or (start and d < start)):
                after = bool(end and d > end)
                add("period", [inv.id, c.id],
                    f"{inv.id} ลงวันที่ {d} " + (f"หลังสัญญาสิ้นสุด {end}" if after else f"ก่อนสัญญาเริ่ม {start}"),
                    [ev(inv, "date", "วันที่ Invoice"), ev(c, "end_date" if after else "start_date", "วันสิ้นสุดสัญญา" if after else "วันเริ่มสัญญา")],
                    at_stake=inv.v("subtotal", 0), txn=tid)

            # ---- payment later than the contract's credit term ----
            if cd is not None and d:
                for pay in pays_of.get(inv.id, []):
                    pd = pay.v("date")
                    if pd and _days(d, pd) > cd:
                        add("late", [inv.id, c.id, pay.id],
                            f"โอนจ่าย {inv.id} วันที่ {pd} หลังวันที่ Invoice {_days(d, pd)} วัน เกินเครดิต {cd} วันตามสัญญา",
                            [ev(inv, "date", "วันที่ Invoice"), ev(c, "credit_days", "เครดิตตามสัญญา"), ev(pay, "date", "วันที่โอน")],
                            match=link_of[pay.id].level, at_stake=0, txn=tid)

        # ---- cumulative invoiced amount vs the contract ceiling (one flag per contract) ----
        cap = c.v("ceiling")
        if cap is None:
            continue
        counted = [i for i in invs if i.fields.get("invoice_no") is not None and i.fields["invoice_no"].clear
                   and i.v("subtotal") is not None and (link_of[i.id].level if i.id in link_of else "sure") != "pending"]
        running, over = 0.0, []
        for inv in counted:
            running += inv.v("subtotal")
            if running > cap:
                over.append(inv)
        if over:
            add("ceiling", [over[0].id, c.id] + [i.id for i in over[1:]],
                f"ยอด Invoice สะสม (ก่อน VAT) {running:,.0f} ฿ เกินวงเงินสัญญา {cap:,.0f} ฿ ตั้งแต่ {over[0].id} ({len(counted)} ใบ)",
                [ev(c, "ceiling", "วงเงินตามสัญญา"), *[ev(i, "subtotal", f"ยอดก่อน VAT {i.id}") for i in counted]],
                at_stake=running - cap, txn=txn_of.get(over[0].id))
