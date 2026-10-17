"""Read every file of one engagement folder into Records with quoted, located fields.

Supported formats: ERP export / bank statement / vendor master (CSV), Excel (.xlsx),
PDF with a text layer, and scanned images (Tesseract OCR, Thai + English).
Fields of text documents come from an LLM when one is configured (extract_llm.py), else from
the templates below, which are also the fallback when no model answers.
"""
import csv
import hashlib
import io
import re
from collections import defaultdict
from pathlib import Path

from .entities import account_token, mask_account
from .model import Field, Record
from .normalize import amount, norm, squash
from .quotes import verify

OCR_MIN_CONF = 60  # a line whose weakest word is below this is "อ่านไม่ชัด"
DOC_NO = re.compile(r"^[A-Z]{2,8}(-[A-Z0-9]+)+$")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ---------- document templates (text documents: PDF text layer or OCR lines) ----------

INVOICE_PATTERNS = {
    "invoice_no": (r"เลขที่\s*(\S+)", str),
    "date": (r"วันที่\s*(\d{4}-\d{2}-\d{2})", str),
    "vendor_name": (r"ผู้ขาย\s*:\s*(.+)", str),
    "tax_id": (r"ผู้เสียภาษี\s*(\d{13})", str),
    "po_ref": (r"ใบสั่งซื้อ\s*(PO-\d{4}-\d{3})", str),
    "subtotal": (r"รวมเงิน\s*([\d,]+\.\d{2})", amount),
    "vat": (r"ภาษีมูลค่าเพิ่ม\s*7%\s*([\d,]+\.\d{2})", amount),
    "total": (r"ยอดรวมทั้งสิ้น\s*([\d,]+\.\d{2})", amount),
    "credit_days": (r"ครบกำหนดชำระ\s*(\d+)\s*วัน", int),
    "item": (r"รายการ\s*:\s*(.+?)\s*จำนวน", str),
    "quantity": (r"จำนวน\s*([\d,]+)\s*\S+\s*ราคาต่อหน่วย", amount),
    "unit_price": (r"ราคาต่อหน่วย\s*([\d,]+\.\d{2})", amount),
}
CONTRACT_PATTERNS = {
    "contract_no": (r"เลขที่\s*(\S+)", str),
    "vendor_name": (r"และ\s*(.+?)\s*\(ผู้ขาย\)", str),
    "tax_id": (r"ผู้เสียภาษี(?:ของผู้ขาย)?\s*(\d{13})", str),
    "start_date": (r"ตั้งแต่วันที่\s*(\d{4}-\d{2}-\d{2})", str),
    "end_date": (r"ถึงวันที่\s*(\d{4}-\d{2}-\d{2})", str),
    "credit_days": (r"เครดิต\s*(\d+)\s*วัน", int),
    "ceiling": (r"วงเงิน\S*\s*(?:\S+\s*)?ไม่เกิน\s*([\d,]+\.\d{2})\s*บาท", amount),
}
# One contract price-list line, e.g. "6.3 น้ำมันเครื่อง ราคาต่อหน่วย 250.00 บาท ต่อลิตร"
PRICE_LINE = re.compile(r"^\s*\d+\.\d+\s+(.+?)\s+ราคาต่อหน่วย\s*([\d,]+\.\d{2})\s*บาท")


def _price_list(lines, method):
    """Contract price list: one field per item, "price:<item>"."""
    out = {}
    for line, loc, clear, bbox in lines:
        m = PRICE_LINE.match(line)
        if m:
            name = f"price:{m.group(1).strip()}"
            out[name] = Field(name, amount(m.group(2)), line.strip(), loc, method=method, clear=clear, bbox=bbox)
    return out


def _apply_template(lines, patterns, method):
    """lines: [(text, locator, clear, bbox)] → {field: Field}; first matching line wins."""
    out = {}
    for name, (pat, conv) in patterns.items():
        rx = re.compile(pat)
        for text, loc, clear, bbox in lines:
            m = rx.search(text)
            if not m:
                continue
            try:
                value = conv(m.group(1).strip())
            except ValueError:
                value, clear = m.group(1), False
            if name.endswith("_no") and not DOC_NO.match(str(value)):
                clear = False  # e.g. OCR read "INV-BS-205" as "ปงง-88-205"
            out[name] = Field(name, value, text.strip(), loc, method=method, clear=clear, bbox=bbox)
            break
    return out


def _pdf_lines(path: Path):
    import pymupdf

    lines = []
    with pymupdf.open(path) as doc:
        for pno, page in enumerate(doc, 1):
            for i, line in enumerate(norm(page.get_text()).splitlines(), 1):
                if line.strip():
                    lines.append((line, f"หน้า {pno} บรรทัด {i}", True, None))
    return lines


def _ocr_lines(path: Path):
    import pytesseract
    from PIL import Image

    img = Image.open(path)
    d = pytesseract.image_to_data(img, lang="tha+eng", output_type=pytesseract.Output.DICT)
    groups = defaultdict(list)
    for i, word in enumerate(d["text"]):
        if word.strip():
            groups[(d["block_num"][i], d["par_num"][i], d["line_num"][i])].append(i)
    lines = []
    for n, idx in enumerate(groups.values(), 1):
        text, prev_right = "", None
        for i in idx:  # re-insert spaces where the gap between words is wide
            if prev_right is not None and d["left"][i] - prev_right > 0.8 * d["height"][i]:
                text += " "
            text += d["text"][i]
            prev_right = d["left"][i] + d["width"][i]
        x0 = min(d["left"][i] for i in idx)
        y0 = min(d["top"][i] for i in idx)
        x1 = max(d["left"][i] + d["width"][i] for i in idx)
        y1 = max(d["top"][i] + d["height"][i] for i in idx)
        conf = min(float(d["conf"][i]) for i in idx)
        lines.append((norm(text), f"บรรทัด {n} (OCR ความมั่นใจ {conf:.0f})", conf >= OCR_MIN_CONF, [x0, y0, x1 - x0, y1 - y0]))
    return lines


def _text_record(path: Path, rel: str, fmt: str, llm=None):
    lines = _pdf_lines(path) if fmt == "pdf" else _ocr_lines(path)
    text = "\n".join(l[0] for l in lines)
    got = llm.extract(lines, "ocr" if fmt == "scan" else "llm", rel) if llm else None
    kind, fields = got if got else _template_fields(lines, text, "ocr" if fmt == "scan" else "template")
    if kind is None:
        return None
    doc_no = fields.get(f"{kind}_no")
    rid = doc_no.value if doc_no is not None and doc_no.clear and doc_no.verified else f"{Path(rel).stem} (อ่านเลขที่ไม่ชัด)"
    return Record(rid, kind, rel, fmt, sha256(path), text, fields)


def _template_fields(lines, text, method):
    title = lines[0][0] if lines else ""
    flat = squash(text)
    invoice_hits = sum(k in flat for k in ("ใบกำกับภาษี", "ใบแจ้งหนี้", "ยอดรวมทั้งสิ้น", "ภาษีมูลค่าเพิ่ม"))
    if "สัญญา" in title:
        kind, fields = "contract", _apply_template(lines, CONTRACT_PATTERNS, method) | _price_list(lines, method)
    elif invoice_hits >= 2:  # keyword vote, so one OCR misread in the title does not hide an invoice
        kind, fields = "invoice", _apply_template(lines, INVOICE_PATTERNS, method)
    elif "นโยบาย" in title:
        kind, fields = "policy", _apply_template(lines, {"policy_no": (r"เลขที่\s*(\S+)", str)}, method)
    else:
        return None, {}
    for f in fields.values():
        f.verified = verify(f.quote, text)
    return kind, fields


# ---------- tables ----------

def _csv_rows(path: Path):
    raw = path.read_text(encoding="utf-8")
    lines = raw.splitlines()
    rows = list(csv.DictReader(io.StringIO(raw)))
    return rows, lines


def _table_fields(row: dict, mapping: dict, quote: str, loc: str, source_text: str):
    out = {}
    for name, (col, conv) in mapping.items():
        if row.get(col) not in (None, ""):
            out[name] = Field(name, conv(str(row[col])), quote, loc, verify(quote, source_text), "table")
    return out


def _mask_accounts(rows, lines, col):
    """Bank account numbers are tokenised at ingestion: from here on only the salted token
    (for comparisons) and a masked form (for display) exist."""
    tokens = {}
    for row in rows:
        raw = row.get(col)
        if raw:
            tokens[raw] = account_token(raw)
            masked = mask_account(raw)
            lines = [l.replace(raw, masked) for l in lines]
            row[col] = masked
    return lines, tokens


def _read_csv(path: Path, rel: str):
    rows, lines = _csv_rows(path)
    header = list(rows[0].keys()) if rows else []
    raw_accounts = [r.get("counterparty_account") or r.get("bank_account") for r in rows]
    for col in ("counterparty_account", "bank_account"):
        if col in header:
            lines, _ = _mask_accounts(rows, lines, col)
    text = norm("\n".join(lines))
    recs = []
    for n, row in enumerate(rows, 2):
        quote, loc = lines[n - 1], f"แถว {n}"
        token = Field("account_token", account_token(raw_accounts[n - 2]), "", loc, True, "table") if raw_accounts[n - 2] else None
        if "po_no" in header:
            f = _table_fields(row, {
                "po_no": ("po_no", str), "date": ("po_date", str), "vendor_code": ("vendor_code", str),
                "vendor_name": ("vendor_name", str), "description": ("description", str),
                "amount": ("amount_excl_vat", amount), "approved_by": ("approved_by", str),
                "approver_role": ("approver_role", str)}, quote, loc, text)
            recs.append(Record(row["po_no"], "po", rel, "erp_csv", sha256(path), text, f))
        elif "withdrawal" in header:
            f = _table_fields(row, {
                "date": ("date", str), "description": ("description", str), "amount": ("withdrawal", amount),
                "account": ("counterparty_account", str)}, quote, loc, text)
            ref = re.search(r"INV-[A-Z]{2}-\d{3}", row["description"])
            if token:
                f["account_token"] = token
            if ref:
                f["invoice_ref"] = Field("invoice_ref", ref.group(0), quote, loc, True, "table")
            recs.append(Record(f"BANK-{row['date']}-{ref.group(0) if ref else f'row{n}'}", "payment", rel, "csv", sha256(path), text, f))
        elif "vendor_code" in header and "tax_id" in header:
            f = _table_fields(row, {
                "vendor_code": ("vendor_code", str), "name_th": ("name_th", str), "name_en": ("name_en", str),
                "tax_id": ("tax_id", str), "account": ("bank_account", str)}, quote, loc, text)
            if token:
                f["account_token"] = token
            recs.append(Record(f"VENDOR-{row['vendor_code']}", "vendor", rel, "csv", sha256(path), text, f, row["vendor_code"], "vendor master"))
    return recs


def _read_xlsx(path: Path, rel: str):
    import openpyxl

    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).active
    rows = [[("" if c is None else str(c)) for c in r] for r in ws.iter_rows(values_only=True)]
    text = norm("\n".join(" | ".join(r) for r in rows))
    header, recs = rows[0], []
    if "อ้างอิง PO" not in header:
        return recs
    for n, r in enumerate(rows[1:], 2):
        row = dict(zip(header, r))
        quote, loc = " | ".join(r), f"ชีต {ws.title} แถว {n}"
        f = _table_fields(row, {
            "gr_no": ("เลขที่ใบรับของ", str), "date": ("วันที่รับ", lambda s: s[:10]), "po_ref": ("อ้างอิง PO", str),
            "amount": ("มูลค่าที่รับ (บาท)", amount)}, quote, loc, text)
        recs.append(Record(row["เลขที่ใบรับของ"], "gr", rel, "xlsx", sha256(path), text, f))
    return recs


def read_engagement(folder: Path, llm=None):
    """Return (records, unreadable_files). llm: an extract_llm.LLMExtractor, or None for templates only."""
    records, skipped = [], []
    for path in sorted(p for p in folder.rglob("*") if p.is_file()):
        rel = path.relative_to(folder).as_posix()
        if path.name in ("expected.json", "remember.json"):
            continue
        ext = path.suffix.lower()
        if ext == ".csv":
            records += _read_csv(path, rel)
        elif ext == ".xlsx":
            records += _read_xlsx(path, rel)
        elif ext in (".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"):
            rec = _text_record(path, rel, "pdf" if ext == ".pdf" else "scan", llm)
            if rec:
                records.append(rec)
            else:
                skipped.append(rel)
        else:
            skipped.append(rel)
    return records, skipped
