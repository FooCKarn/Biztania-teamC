"""Second synthetic engagement (fictional frozen-food company, Q2 2026) with 9 seeded conflicts.

It is the upload test set from the project files, made importable so the FN/FP cross-check tests can
write it, change one fact (a mutation) and re-run the pipeline. Every name, tax id and account is fictional.

Usage: python samples/frozen_foods.py <out dir>
Writes the files to upload into <out>/upload/, the answer key into <out>/expected.json and an
unreadable CSV into <out>/extra/.
"""
import copy
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from generate import thb, write_pdf  # noqa: E402  (same PDF style as the TG Company set)

CLIENT = "บริษัท สมมติฟู้ดส์แช่แข็ง จำกัด"
BAD_ACCOUNT = "888-8-12345-6"


def _total(sub):
    return round(sub * 1.07, 2)


def default_data() -> dict:
    """Every fact of the engagement. Tests deep-copy this, change one value and write it."""
    vendors = [
        {"code": "V101", "th": "บริษัท ตัวอย่างบรรจุภัณฑ์ จำกัด", "en": "SAMPLE PACKAGING CO.,LTD.", "tax_id": "0999990000011", "account": "999-9-00001-1", "brief": "SAMPLE PACKAGING"},
        {"code": "V102", "th": "บริษัท ทดลองขนส่ง จำกัด", "en": "TEST LOGISTICS CO.,LTD.", "tax_id": "0999990000022", "account": "999-9-00002-2", "brief": "TEST LOGISTICS"},
        {"code": "V103", "th": "บริษัท สมมติเคมีภัณฑ์ จำกัด", "en": "DUMMY CHEMICAL CO.,LTD.", "tax_id": "0999990000033", "account": "999-9-00003-3", "brief": "DUMMY CHEMICAL"},
    ]
    pos = [
        ("PO-2026-101", "2026-04-01", "V101", "กล่องกระดาษลูกฟูก", 50000, "มานี ทดสอบ", "Manager"),
        ("PO-2026-102", "2026-04-03", "V101", "ถุงพลาสติกซีล", 36000, "มานี ทดสอบ", "Manager"),
        ("PO-2026-103", "2026-04-10", "V101", "ถาดโฟมบรรจุอาหาร", 150000, "ปิติ ตัวอย่าง", "Purchasing Officer"),
        ("PO-2026-104", "2026-04-12", "V102", "ค่าขนส่งห้องเย็น เมษายน", 40000, "มานี ทดสอบ", "Manager"),
        ("PO-2026-105", "2026-04-20", "V101", "ฉลากสินค้า", 20000, "มานี ทดสอบ", "Manager"),
        ("PO-2026-106", "2026-05-02", "V101", "เทปกาว", 13000, "มานี ทดสอบ", "Manager"),
        ("PO-2026-107", "2026-05-06", "V101", "กล่องกระดาษลูกฟูก", 25000, "มานี ทดสอบ", "Manager"),
        ("PO-2026-108", "2026-05-01", "V102", "ค่าขนส่งห้องเย็น พฤษภาคม", 42000, "มานี ทดสอบ", "Manager"),
        ("PO-2026-109", "2026-06-01", "V102", "ค่าขนส่งห้องเย็น มิถุนายน", 38000, "มานี ทดสอบ", "Manager"),
        ("PO-2026-110", "2026-04-18", "V103", "น้ำยาฆ่าเชื้อ", 50000, "มานี ทดสอบ", "Manager"),
        ("PO-2026-111", "2026-05-10", "V103", "คลอรีน", 30000, "มานี ทดสอบ", "Manager"),
        ("PO-2026-112", "2026-06-05", "V103", "สารทำความเย็น", 24000, "มานี ทดสอบ", "Manager"),
    ]
    items = {  # invoice → (item, quantity, unit, unit price); PK invoices print one line item
        "INV-PK-401": ("กล่องกระดาษลูกฟูก", 2000, "ใบ", 25),
        "INV-PK-402": ("ถุงพลาสติกซีล", 12000, "ใบ", 3),
        "INV-PK-403": ("ถาดโฟมบรรจุอาหาร", 30000, "ชิ้น", 5),
        "INV-PK-404": ("ฉลากสินค้า", 10000, "ดวง", 2),
        "INV-PK-405": ("เทปกาว", 500, "ม้วน", 26),  # contract price 25
        "INV-PK-406": ("กล่องกระดาษลูกฟูก", 1000, "ใบ", 25),
    }
    # invoice no, date, vendor, PO printed (None = none), subtotal, credit days printed (None = not printed)
    invoices = [
        ("INV-PK-401", "2026-04-06", "V101", "PO-2026-101", 50000, 45),
        ("INV-PK-402", "2026-04-08", "V101", "PO-2026-102", 36000, 45),
        ("INV-PK-403", "2026-04-15", "V101", "PO-2026-103", 150000, 45),
        ("INV-PK-404", "2026-04-25", "V101", "PO-2026-105", 20000, 45),
        ("INV-PK-405", "2026-05-05", "V101", "PO-2026-106", 13000, 45),
        ("INV-PK-406", "2026-05-10", "V101", "PO-2026-107", 25000, 30),   # contract says 45
        ("INV-LG-501", "2026-04-30", "V102", "PO-2026-104", 46000, None),  # PO says 40,000
        ("INV-LG-502", "2026-05-31", "V102", "PO-2026-108", 42000, None),
        ("INV-LG-503", "2026-06-15", "V102", "PO-2026-109", 38000, None),
        ("INV-CH-601", "2026-04-22", "V103", "PO-2026-110", 50000, None),
        ("INV-CH-602", "2026-05-20", "V103", "PO-2026-111", 30000, None),
        ("INV-CH-603", "2026-06-02", "V103", None, 18000, None),           # no PO at all
        ("INV-CH-604", "2026-06-08", "V103", "PO-2026-112", 24000, None),
    ]
    tot = {i[0]: _total(i[4]) for i in invoices}
    # date, invoice paid, amount, account (None = the vendor's account on file)
    payments = [
        ("2026-05-06", "INV-PK-401", tot["INV-PK-401"], None),
        ("2026-05-10", "INV-PK-402", tot["INV-PK-402"], None),
        ("2026-05-20", "INV-PK-403", tot["INV-PK-403"], None),
        ("2026-05-15", "INV-PK-404", tot["INV-PK-404"], None),
        ("2026-05-22", "INV-PK-404", tot["INV-PK-404"], None),   # paid a second time
        ("2026-06-04", "INV-PK-405", tot["INV-PK-405"], None),
        ("2026-06-05", "INV-PK-406", tot["INV-PK-406"], None),
        ("2026-05-25", "INV-LG-501", tot["INV-LG-501"], None),
        ("2026-06-10", "INV-LG-502", tot["INV-LG-502"], BAD_ACCOUNT),  # account not in vendor master
        ("2026-06-30", "INV-LG-503", tot["INV-LG-503"], None),
        ("2026-05-08", "INV-CH-601", 58850.00, None),             # invoice total 53,500
        ("2026-05-12", "INV-CH-602", tot["INV-CH-602"], None),   # before the invoice date (20 May)
        ("2026-06-20", "INV-CH-603", tot["INV-CH-603"], None),
        ("2026-06-25", "INV-CH-604", tot["INV-CH-604"], None),
    ]
    contracts = {
        "contract_pk.pdf": {"no": "CONTRACT-PK", "title": "สัญญาซื้อขายบรรจุภัณฑ์", "vendor": "V101", "start": "2026-01-01", "end": "2026-12-31",
                            "credit": 45, "ceiling": 1000000,
                            "prices": [("กล่องกระดาษลูกฟูก", "ใบ", 25), ("ถุงพลาสติกซีล", "ใบ", 3), ("ถาดโฟมบรรจุอาหาร", "ชิ้น", 5),
                                       ("ฉลากสินค้า", "ดวง", 2), ("เทปกาว", "ม้วน", 25)]},
        "contract_lg.pdf": {"no": "CONTRACT-LG", "title": "สัญญาจ้างขนส่ง", "vendor": "V102", "start": "2026-01-01", "end": "2026-12-31",
                            "credit": 30, "ceiling": 200000, "prices": []},
    }
    return copy.deepcopy({
        "vendors": vendors, "pos": [list(p) for p in pos], "items": {k: list(v) for k, v in items.items()},
        "invoices": [list(i) for i in invoices], "payments": [list(p) for p in payments], "contracts": contracts,
        "invoice_overrides": {},  # invoice no → {"tax_id": ..., "vendor_name": ...} printed instead of the master's
        "extra_bank_rows": [],    # (date, description, amount, account) lines with no invoice reference
    })


EXPECTED = {
    "flags": [
        {"type": "POLICY_BREACH", "docs": ["PO-2026-103"], "why": "PO 150,000 ฿ อนุมัติโดย Purchasing Officer แต่นโยบายข้อ 3 กำหนด Manager เมื่อเกิน 100,000 ฿"},
        {"type": "VALUE_MISMATCH", "docs": ["PO-2026-104", "INV-LG-501"], "why": "PO 40,000 ฿ แต่ Invoice 46,000 ฿ (ก่อน VAT)"},
        {"type": "VALUE_MISMATCH", "docs": ["INV-CH-601", "BANK-2026-05-08-INV-CH-601"], "why": "Invoice 53,500.00 ฿ แต่โอน 58,850.00 ฿"},
        {"type": "DUPLICATE", "docs": ["INV-PK-404"], "why": "Invoice ใบเดียวถูกโอนจ่าย 2 ครั้ง (15 และ 22 พ.ค.)"},
        {"type": "PARTY_MISMATCH", "docs": ["INV-LG-502", "BANK-2026-06-10-INV-LG-502"], "why": "โอนเข้าบัญชี xxx-x-xx345-6 ไม่ใช่บัญชีใน Vendor master (บัญชีถูกเปลี่ยน)"},
        {"type": "CONTRACT_BREACH", "docs": ["INV-PK-405", "CONTRACT-PK"], "why": "เทปกาวม้วนละ 26 ฿ แต่สัญญา 25 ฿ (PO ออกที่ 13,000 ฿ ตรงกับ Invoice จึงไม่ใช่ VALUE_MISMATCH)"},
        {"type": "TEXT_CONFLICT", "docs": ["CONTRACT-PK", "INV-PK-406"], "why": "สัญญาเครดิต 45 วัน แต่ Invoice ระบุ 30 วัน"},
        {"type": "DATE_ORDER", "docs": ["INV-CH-602", "BANK-2026-05-12-INV-CH-602"], "why": "โอนเงิน 12 พ.ค. ก่อนวันที่ Invoice 20 พ.ค."},
        {"type": "MISSING_LINK", "docs": ["INV-CH-603"], "why": "ไม่มี PO อ้างถึงและไม่มี PO ยอดใกล้เคียง"},
    ],
    "pending_match": [],
    "clean": ["INV-PK-401", "INV-PK-402", "INV-LG-503", "INV-CH-604"],
}


def _csv(path, header, rows, encoding="utf-8"):
    with open(path, "w", newline="", encoding=encoding) as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def _pdf(path, lines):
    write_pdf(path, "".join(f"<p>{l}</p>" for l in lines))


def _invoice_lines(d, no, date, vcode, po, sub, days):
    v = next(x for x in d["vendors"] if x["code"] == vcode)
    o = d["invoice_overrides"].get(no, {})
    lines = ["ใบกำกับภาษี / ใบแจ้งหนี้ (เอกสารทดสอบ ข้อมูลสมมติ)", f"เลขที่ {no}", f"วันที่ {date}",
             f"ผู้ขาย: {o.get('vendor_name', v['th'])}", f"เลขประจำตัวผู้เสียภาษี {o.get('tax_id', v['tax_id'])}", f"ผู้ซื้อ: {CLIENT}"]
    if po:
        lines.append(f"อ้างอิงใบสั่งซื้อ {po}")
    if no in d["items"]:
        item, qty, unit, price = d["items"][no]
        assert abs(qty * price - sub) < 0.01, no
        lines.append(f"รายการ: {item} จำนวน {qty:,} {unit} ราคาต่อหน่วย {thb(price)} บาท")
    elif vcode == "V102":
        lines.append("รายการ: ค่าบริการขนส่งสินค้าแช่แข็งด้วยรถห้องเย็น")
    lines += [f"รวมเงิน {thb(sub)} บาท", f"ภาษีมูลค่าเพิ่ม 7% {thb(round(sub * 0.07, 2))} บาท", f"ยอดรวมทั้งสิ้น {thb(_total(sub))} บาท"]
    if days:
        lines.append(f"ครบกำหนดชำระ {days} วัน")
    return lines


def _contract_lines(d, c):
    v = next(x for x in d["vendors"] if x["code"] == c["vendor"])
    lines = [f"{c['title']} เลขที่ {c['no']}",
             f"ระหว่าง {CLIENT} (ผู้ซื้อ) และ {c.get('party', v['th'])} (ผู้ขาย)",
             f"เลขประจำตัวผู้เสียภาษีของผู้ขาย {v['tax_id']}",
             f"ข้อ 2 สัญญามีผลตั้งแต่วันที่ {c['start']} ถึงวันที่ {c['end']}",
             f"ข้อ 5 ผู้ซื้อตกลงชำระเงินภายในกำหนดเครดิต {c['credit']} วัน นับจากวันที่ในใบกำกับภาษี"]
    if c["prices"]:
        lines.append("ข้อ 6 ราคาต่อหน่วยไม่รวมภาษีมูลค่าเพิ่ม ตามตารางต่อไปนี้")
        lines += [f"6.{i} {item} ราคาต่อหน่วย {thb(p)} บาท ต่อ{unit}" for i, (item, unit, p) in enumerate(c["prices"], 1)]
    lines += [f"ข้อ 7 วงเงินรวมตลอดอายุสัญญาไม่เกิน {thb(c['ceiling'])} บาท (ไม่รวมภาษีมูลค่าเพิ่ม)", "(เอกสารทดสอบ ข้อมูลสมมติทั้งหมด)"]
    return lines


def write(up: Path, d: dict | None = None):
    """Write the upload files of one engagement into folder `up`."""
    d = d or default_data()
    up.mkdir(parents=True, exist_ok=True)
    vend = {v["code"]: v for v in d["vendors"]}
    inv_vendor = {i[0]: i[2] for i in d["invoices"]}
    # Saved with a BOM, as Excel does, to check that path too.
    _csv(up / "vendor_master_test.csv", ["vendor_code", "name_th", "name_en", "tax_id", "bank_account"],
         [(v["code"], v["th"], v["en"], v["tax_id"], v["account"]) for v in d["vendors"]], "utf-8-sig")
    _csv(up / "po_export_test.csv",
         ["po_no", "po_date", "vendor_code", "vendor_name", "description", "amount_excl_vat", "approved_by", "approver_role"],
         [(p[0], p[1], p[2], vend[p[2]]["en"], p[3], f"{p[4]:.2f}", p[5], p[6]) for p in d["pos"]])
    bank = [(dt, f"TRF {inv} {vend[inv_vendor[inv]]['brief']}", f"{amt:.2f}", acct or vend[inv_vendor[inv]]["account"])
            for dt, inv, amt, acct in d["payments"]]
    bank += [(dt, desc, f"{amt:.2f}", acct) for dt, desc, amt, acct in d["extra_bank_rows"]]
    _csv(up / "bank_statement_2026Q2.csv", ["date", "description", "withdrawal", "counterparty_account"], sorted(bank))
    for inv in d["invoices"]:
        _pdf(up / f"{inv[0]}.pdf", _invoice_lines(d, *inv))
    for name, c in d["contracts"].items():
        _pdf(up / name, _contract_lines(d, c))
    _pdf(up / "policy_procurement_test.pdf", [
        "นโยบายการจัดซื้อ เลขที่ POLICY-TEST",
        "ข้อ 3 การสั่งซื้อที่มียอดเกิน 100,000 บาท ต้องได้รับอนุมัติจาก Manager",
        "ข้อ 4 ทุกการจ่ายเงินต้องโอนเข้าบัญชีที่ลงทะเบียนไว้ใน Vendor master เท่านั้น",
        "(เอกสารทดสอบ ข้อมูลสมมติทั้งหมด)",
    ])
    (up / "remember.json").write_text(json.dumps({
        "client": CLIENT, "tolerance_pct": 1.0, "materiality_thb": 10000,
        "rules": [
            {"id": "R1", "kind": "approval_threshold", "threshold_thb": 100000, "required_role": "Manager",
             "source_doc": "policy_procurement_test.pdf", "source_quote": "การสั่งซื้อที่มียอดเกิน 100,000 บาท ต้องได้รับอนุมัติจาก Manager"},
            {"id": "R2", "kind": "registered_account",
             "source_doc": "policy_procurement_test.pdf", "source_quote": "ทุกการจ่ายเงินต้องโอนเข้าบัญชีที่ลงทะเบียนไว้ใน Vendor master เท่านั้น"},
        ],
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    out = Path(sys.argv[1])
    write(out / "upload")
    # Negative case: a CSV whose columns match no known layout; it must be listed as unreadable with a reason.
    (out / "extra").mkdir(parents=True, exist_ok=True)
    _csv(out / "extra" / "unknown_layout.csv", ["รหัสสินค้า", "ชื่อสินค้า", "คงเหลือ"], [("SKU-01", "ไก่ทอดแช่แข็ง (สมมติ)", "120")])
    (out / "expected.json").write_text(json.dumps(EXPECTED, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(list((out / 'upload').iterdir()))} upload files to {out / 'upload'}")


if __name__ == "__main__":
    main()
