"""Generate the synthetic TG Company engagement used by the demo and the tests.

Every document is fictional. The planted conflicts are listed in expected.json so the
pipeline can be scored against a known answer key.

Usage: python samples/generate.py   (writes samples/tg_company/)
"""
import csv
import json
import random
from pathlib import Path

import openpyxl
import pymupdf
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).parent / "tg_company"
FONT_DIR = "/usr/share/fonts/opentype/tlwg"
FONT = f"{FONT_DIR}/Loma.otf"
CSS = "@font-face {font-family: loma; src: url(Loma.otf);} * {font-family: loma; font-size: 12pt; line-height: 1.5;}"
CLIENT = "บริษัท สยามออโต้พาร์ท จำกัด"

VENDORS = [
    # vendor_code, Thai legal name, English name, tax id, bank account on file
    ("V001", "บริษัท ทีจี คอมพานี จำกัด", "TG COMPANY CO.,LTD.", "0105551000011", "123-4-56789-0"),
    ("V002", "บริษัท บางกอกสตีล จำกัด", "BANGKOK STEEL CO.,LTD.", "0105552000022", "222-3-33333-4"),
    ("V003", "บริษัท นอร์ทสตาร์ โลจิสติกส์ จำกัด", "NORTHSTAR LOGISTICS CO.,LTD.", "0105553000033", "555-6-77777-8"),
]

# po_no, date, vendor, description, amount excl. VAT, approver, approver role
POS = [
    ("PO-2026-001", "2026-02-02", "V001", "อะไหล่ระบบเบรก", 80000, "วิภา ศรีสุข", "Manager"),
    ("PO-2026-002", "2026-02-05", "V001", "อะไหล่ช่วงล่าง", 120000, "สมชาย ใจดี", "Purchasing Officer"),
    ("PO-2026-003", "2026-02-10", "V001", "น้ำมันเครื่อง", 50000, "วิภา ศรีสุข", "Manager"),
    ("PO-2026-004", "2026-03-01", "V002", "เหล็กแผ่น", 40000, "วิภา ศรีสุข", "Manager"),
    ("PO-2026-005", "2026-03-03", "V001", "กรองอากาศ", 70000, "วิภา ศรีสุข", "Manager"),
    ("PO-2026-006", "2026-03-05", "V002", "เหล็กเส้น", 45000, "วิภา ศรีสุข", "Manager"),
    ("PO-2026-007", "2026-03-10", "V001", "ยางรถยนต์", 60000, "วิภา ศรีสุข", "Manager"),
    ("PO-2026-008", "2026-03-11", "V001", "ยางอะไหล่", 59500, "วิภา ศรีสุข", "Manager"),
    ("PO-2026-009", "2026-03-15", "V002", "สลักเกลียว", 25000, "วิภา ศรีสุข", "Manager"),
    ("PO-2026-010", "2026-01-12", "V001", "หัวเทียน", 65000, "วิภา ศรีสุข", "Manager"),
    ("PO-2026-011", "2026-01-05", "V001", "ไส้กรองน้ำมัน", 32000, "วิภา ศรีสุข", "Manager"),
]

# gr_no, date, po_no, value received
GRS = [
    ("GR-2026-001", "2026-02-08", "PO-2026-001", 80000),
    ("GR-2026-002", "2026-02-10", "PO-2026-002", 120000),
    ("GR-2026-003", "2026-02-14", "PO-2026-003", 50000),
    ("GR-2026-004", "2026-03-08", "PO-2026-004", 40000),
    ("GR-2026-005", "2026-03-07", "PO-2026-005", 70000),
    ("GR-2026-006", "2026-03-10", "PO-2026-006", 45000),
    ("GR-2026-007", "2026-03-18", "PO-2026-007", 60000),
    ("GR-2026-008", "2026-03-18", "PO-2026-008", 59500),
    ("GR-2026-009", "2026-03-20", "PO-2026-009", 25000),
    ("GR-2026-010", "2026-01-15", "PO-2026-010", 65000),
    ("GR-2026-011", "2026-01-08", "PO-2026-011", 32000),
]

# TG Company invoices print one line item (item, quantity, unit, unit price) so they can be
# checked against the contract price list.
ITEMS = {
    "INV-TG-101": ("อะไหล่ระบบเบรก", 40, "ชุด", 2000),
    "INV-TG-102": ("อะไหล่ช่วงล่าง", 50, "ชุด", 3000),
    "INV-TG-103": ("น้ำมันเครื่อง", 200, "ลิตร", 250),
    "INV-TG-105": ("กรองอากาศ", 200, "ชิ้น", 350),
    "INV-TG-110": ("ยางรถยนต์", 24, "เส้น", 2500),
    "INV-TG-111": ("หัวเทียน", 500, "ชิ้น", 130),  # contract price is 120
    "INV-TG-112": ("ไส้กรองน้ำมัน", 200, "ชิ้น", 160),
}

# Contract price list for TG Company (item, unit, price per unit)
TG_PRICES = [("อะไหล่ระบบเบรก", "ชุด", 2000), ("อะไหล่ช่วงล่าง", "ชุด", 3000), ("น้ำมันเครื่อง", "ลิตร", 250),
             ("กรองอากาศ", "ชิ้น", 350), ("ยางรถยนต์", "เส้น", 2500), ("หัวเทียน", "ชิ้น", 120),
             ("ไส้กรองน้ำมัน", "ชิ้น", 160)]

# invoice no, date, vendor, PO reference (None = not printed), subtotal, credit days, file kinds
INVOICES = [
    ("INV-TG-101", "2026-02-10", "V001", "PO-2026-001", 80000, 60, ["pdf"]),
    ("INV-TG-102", "2026-02-12", "V001", "PO-2026-002", 150000, 30, ["pdf"]),
    ("INV-TG-103", "2026-02-15", "V001", "PO-2026-003", 50000, 60, ["pdf"]),
    ("INV-BS-201", "2026-03-18", "V002", "PO-2026-004", 40000, None, ["pdf"]),
    ("INV-TG-105", "2026-03-08", "V001", "PO-2026-005", 70000, 60, ["pdf"]),
    ("INV-BS-205", "2026-03-12", "V002", "PO-2026-006", 45000, None, ["pdf", "scan"]),
    ("INV-NS-301", "2026-03-14", "V003", None, 30000, None, ["pdf"]),
    ("INV-TG-110", "2026-03-20", "V001", None, 60000, 60, ["pdf"]),
    ("INV-BS-210", "2026-03-22", "V002", None, 25000, None, ["pdf"]),
    ("INV-TG-111", "2026-01-16", "V001", "PO-2026-010", 65000, 60, ["pdf"]),
    ("INV-TG-112", "2026-01-09", "V001", "PO-2026-011", 32000, 60, ["pdf"]),
]

# date, description, amount, counterparty account
PAYMENTS = [
    ("2026-02-20", "TRF INV-TG-101 TG COMPANY", 85600.00, "123-4-56789-0"),
    ("2026-02-25", "TRF INV-TG-102 TG COMPANY", 160500.00, "123-4-56789-0"),
    ("2026-02-28", "TRF INV-TG-103 TG COMPANY", 53500.00, "123-4-56789-0"),
    ("2026-03-10", "TRF INV-BS-201 BANGKOK STEEL", 42800.00, "222-3-33333-4"),
    ("2026-03-15", "TRF INV-TG-105 TG COMPANY", 74900.00, "987-6-54321-0"),
    ("2026-03-20", "TRF INV-BS-205 BANGKOK STEEL", 48150.00, "222-3-33333-4"),
    ("2026-03-27", "TRF INV-BS-205 BANGKOK STEEL", 48150.00, "222-3-33333-4"),
    ("2026-03-25", "TRF INV-NS-301 NORTHSTAR", 32100.00, "555-6-77777-8"),
    ("2026-03-30", "TRF TG COMPANY", 64200.00, "123-4-56789-0"),
    ("2026-03-31", "TRF INV-BS-210 BANGKOK STEEL", 26750.00, "222-3-33333-4"),
    ("2026-02-14", "TRF INV-TG-111 TG COMPANY", 69550.00, "123-4-56789-0"),
    ("2026-03-26", "TRF INV-TG-112 TG COMPANY", 34240.00, "123-4-56789-0"),
]

EXPECTED = {
    "flags": [
        {"type": "POLICY_BREACH", "docs": ["PO-2026-002"], "why": "120,000 ฿ อนุมัติโดย Purchasing Officer แต่กฎกำหนด Manager"},
        {"type": "VALUE_MISMATCH", "docs": ["PO-2026-002", "INV-TG-102"], "why": "PO 120,000 ฿ แต่ Invoice 150,000 ฿"},
        {"type": "TEXT_CONFLICT", "docs": ["CONTRACT-TG", "INV-TG-102"], "why": "สัญญาเครดิต 60 วัน แต่ Invoice 30 วัน"},
        {"type": "DATE_ORDER", "docs": ["INV-BS-201", "BANK-2026-03-10-INV-BS-201"], "why": "จ่ายเงิน 10 มี.ค. ก่อนวันที่ Invoice 18 มี.ค."},
        {"type": "PARTY_MISMATCH", "docs": ["INV-TG-105", "BANK-2026-03-15-INV-TG-105"], "why": "โอนเข้าบัญชีที่ไม่ใช่บัญชีใน Vendor master"},
        {"type": "DUPLICATE", "docs": ["INV-BS-205"], "why": "Invoice เลขเดียวกันมี 2 ไฟล์และจ่าย 2 ครั้ง"},
        {"type": "MISSING_LINK", "docs": ["INV-NS-301"], "why": "ไม่มี PO และใบรับของอ้างถึง"},
        {"type": "CONTRACT_BREACH", "docs": ["INV-TG-111", "CONTRACT-TG"], "why": "หัวเทียนชิ้นละ 130 ฿ แต่ราคาตามสัญญา 120 ฿"},
        {"type": "CONTRACT_BREACH", "docs": ["INV-TG-112", "CONTRACT-TG", "BANK-2026-03-26-INV-TG-112"],
         "why": "จ่าย 76 วันหลังวันที่ Invoice เกินเครดิต 60 วันตามสัญญา"},
        {"type": "CONTRACT_BREACH", "docs": ["INV-BS-210", "CONTRACT-BS"], "why": "Invoice ลงวันที่ 22 มี.ค. หลังสัญญาสิ้นสุด 20 มี.ค."},
        {"type": "CONTRACT_BREACH", "docs": ["INV-BS-201", "CONTRACT-BS"], "why": "ยอดสะสมเกินวงเงินสัญญา 80,000 ฿ ตั้งแต่ INV-BS-201"},
        {"type": "PARTY_MISMATCH", "docs": ["CONTRACT-BS"], "why": "คู่สัญญาชื่อ บางกอกสตีล แอนด์ เมทัล แต่เลขผู้เสียภาษีเป็นของ บางกอกสตีล ใน Vendor master"},
    ],
    "pending_match": ["INV-TG-110"],
    "inferred_match": [["INV-BS-210", "PO-2026-009"]],
    "clean": ["PO-2026-001", "PO-2026-003"],
    "note": "PO-2026-003 / INV-TG-103 ต่างกันแค่ VAT 3,500 ฿ ต้องไม่ถูก flag; สัญญา TG วงเงิน 600,000 ฿ ยังไม่เกิน และ INV-BS-205 ฉบับสแกนที่อ่านเลขไม่ชัดต้องไม่ถูกนับซ้ำในวงเงิน",
}


def thb(x: float) -> str:
    return f"{x:,.2f}"


def write_pdf(path: Path, html: str):
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_htmlbox(pymupdf.Rect(48, 48, 548, 800), html, css=CSS, archive=pymupdf.Archive(FONT_DIR))
    doc.set_metadata({"title": path.stem, "creationDate": "D:20260401000000", "modDate": "D:20260401000000"})
    doc.save(path, garbage=4, deflate=True, no_new_id=True)


def invoice_lines(inv):
    no, date, vcode, po, sub, days, _ = inv
    v = next(x for x in VENDORS if x[0] == vcode)
    vat = round(sub * 0.07, 2)
    lines = [
        "ใบกำกับภาษี / ใบแจ้งหนี้",
        f"เลขที่ {no}",
        f"วันที่ {date}",
        f"ผู้ขาย: {v[1]}",
        f"เลขประจำตัวผู้เสียภาษี {v[3]}",
        f"ผู้ซื้อ: {CLIENT}",
    ]
    if po:
        lines.append(f"อ้างอิงใบสั่งซื้อ {po}")
    if no in ITEMS:
        item, qty, unit, price = ITEMS[no]
        assert qty * price == sub, no
        lines.append(f"รายการ: {item} จำนวน {qty:,} {unit} ราคาต่อหน่วย {thb(price)} บาท")
    lines += [f"รวมเงิน {thb(sub)} บาท", f"ภาษีมูลค่าเพิ่ม 7% {thb(vat)} บาท", f"ยอดรวมทั้งสิ้น {thb(sub + vat)} บาท"]
    if days:
        lines.append(f"ครบกำหนดชำระ {days} วัน")
    return lines


def write_scan(path: Path, lines):
    rnd = random.Random(205)
    font = ImageFont.truetype(FONT, 34)
    im = Image.new("L", (1500, 120 + 78 * len(lines)), 250)
    d = ImageDraw.Draw(im)
    for i, line in enumerate(lines):
        d.text((60, 50 + i * 78), line, font=font, fill=20)
    for _ in range(1800):  # scanner speckle
        im.putpixel((rnd.randrange(im.width), rnd.randrange(im.height)), rnd.randrange(150, 230))
    im = im.rotate(0.4, fillcolor=250).filter(ImageFilter.GaussianBlur(0.6))
    im.save(path)


def main():
    (OUT / "invoices").mkdir(parents=True, exist_ok=True)
    vend = {v[0]: v for v in VENDORS}

    with open(OUT / "vendor_master.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["vendor_code", "name_th", "name_en", "tax_id", "bank_account"])
        w.writerows(VENDORS)

    with open(OUT / "erp_po_export.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["po_no", "po_date", "vendor_code", "vendor_name", "description", "amount_excl_vat", "approved_by", "approver_role"])
        for po in POS:
            w.writerow([po[0], po[1], po[2], vend[po[2]][2], po[3], f"{po[4]:.2f}", po[5], po[6]])

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Goods Receipts"
    ws.append(["เลขที่ใบรับของ", "วันที่รับ", "อ้างอิง PO", "มูลค่าที่รับ (บาท)"])
    for gr in GRS:
        ws.append(list(gr))
    wb.properties.created = wb.properties.modified = __import__("datetime").datetime(2026, 4, 1)
    wb.save(OUT / "goods_receipts.xlsx")

    for inv in INVOICES:
        lines = invoice_lines(inv)
        if "pdf" in inv[6]:
            write_pdf(OUT / "invoices" / f"{inv[0]}.pdf", "".join(f"<p>{l}</p>" for l in lines))
        if "scan" in inv[6]:
            write_scan(OUT / "invoices" / f"{inv[0]}_scan.png", lines)

    with open(OUT / "bank_statement_2026Q1.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["date", "description", "withdrawal", "counterparty_account"])
        w.writerows([(d, desc, f"{amt:.2f}", acct) for d, desc, amt, acct in PAYMENTS])

    write_pdf(OUT / "contract_tg.pdf", "".join(f"<p>{l}</p>" for l in [
        "สัญญาซื้อขายอะไหล่ เลขที่ CONTRACT-TG",
        f"ระหว่าง {CLIENT} (ผู้ซื้อ) และ บริษัท ทีจี คอมพานี จำกัด (ผู้ขาย)",
        "เลขประจำตัวผู้เสียภาษีของผู้ขาย 0105551000011",
        "ข้อ 2 สัญญามีผลตั้งแต่วันที่ 2026-01-01 ถึงวันที่ 2026-12-31",
        "ข้อ 5 ผู้ซื้อตกลงชำระเงินภายในกำหนดเครดิต 60 วัน นับจากวันที่ในใบกำกับภาษี",
        "ข้อ 6 ราคาต่อหน่วยไม่รวมภาษีมูลค่าเพิ่ม ตามตารางต่อไปนี้",
        *[f"6.{i} {item} ราคาต่อหน่วย {thb(price)} บาท ต่อ{unit}" for i, (item, unit, price) in enumerate(TG_PRICES, 1)],
        "ข้อ 7 วงเงินรวมตลอดอายุสัญญาไม่เกิน 600,000.00 บาท (ไม่รวมภาษีมูลค่าเพิ่ม)",
    ]))
    # Bangkok Steel: the contract names a different legal entity but carries V002's tax id,
    # ends on 20 Mar and has a ceiling that the Q1 invoices pass.
    write_pdf(OUT / "contract_bs.pdf", "".join(f"<p>{l}</p>" for l in [
        "สัญญาซื้อขายเหล็ก เลขที่ CONTRACT-BS",
        f"ระหว่าง {CLIENT} (ผู้ซื้อ)",
        "และ บริษัท บางกอกสตีล แอนด์ เมทัล จำกัด (ผู้ขาย)",
        "เลขประจำตัวผู้เสียภาษีของผู้ขาย 0105552000022",
        "ข้อ 2 สัญญามีผลตั้งแต่วันที่ 2026-01-01 ถึงวันที่ 2026-03-20",
        "ข้อ 5 ผู้ซื้อตกลงชำระเงินภายในกำหนดเครดิต 30 วัน นับจากวันที่ในใบกำกับภาษี",
        "ข้อ 7 วงเงินรวมตลอดอายุสัญญาไม่เกิน 80,000.00 บาท (ไม่รวมภาษีมูลค่าเพิ่ม)",
    ]))
    write_pdf(OUT / "policy_procurement.pdf", "".join(f"<p>{l}</p>" for l in [
        "นโยบายการจัดซื้อ เลขที่ POLICY-PROC",
        "ข้อ 3 การสั่งซื้อที่มียอดเกิน 100,000 บาท ต้องได้รับอนุมัติจาก Manager",
        "ข้อ 4 ทุกการจ่ายเงินต้องโอนเข้าบัญชีที่ลงทะเบียนไว้ใน Vendor master เท่านั้น",
    ]))

    (OUT / "remember.json").write_text(json.dumps({
        "client": CLIENT,
        "tolerance_pct": 1.0,
        "materiality_thb": 10000,
        "rules": [
            {"id": "R1", "kind": "approval_threshold", "threshold_thb": 100000, "required_role": "Manager",
             "source_doc": "policy_procurement.pdf", "source_quote": "การสั่งซื้อที่มียอดเกิน 100,000 บาท ต้องได้รับอนุมัติจาก Manager"},
            {"id": "R2", "kind": "registered_account",
             "source_doc": "policy_procurement.pdf", "source_quote": "ทุกการจ่ายเงินต้องโอนเข้าบัญชีที่ลงทะเบียนไว้ใน Vendor master เท่านั้น"},
        ],
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "expected.json").write_text(json.dumps(EXPECTED, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {sum(1 for _ in OUT.rglob('*') if _.is_file())} files to {OUT}")


if __name__ == "__main__":
    main()
