"""LLM extraction: code verifies every quote and converts every value; masked text only goes out."""
import pytest

from auditconcierge.extract_llm import LLMExtractor, mask_line, parse_date
from auditconcierge.readers import _template_fields
from fake_llm import FakeGemini

NEW_LAYOUT = [  # an invoice that looks nothing like the sample template
    "INVOICE / ใบแจ้งหนี้",
    "Invoice No.: IV2569/0042   Date: 12 ก.พ. 2569",
    "Seller: TG Company Co., Ltd. (Tax ID 0-1055-51000-01-1)",
    "Your PO: PO-2026-002",
    "Net amount ฿150,000.00   VAT 7% ฿10,500.00",
    "GRAND TOTAL ฿160,500.00 (payment due 45 days)",
    "Please transfer to 123-4-56789-0",
]


def lines_of(texts):
    return [(t, f"หน้า 1 บรรทัด {i}", True, None) for i, t in enumerate(texts, 1)]


def new_layout_answer(prompt):
    return {"kind": "invoice", "fields": {
        "invoice_no": {"line": 2, "raw": "IV2569/0042", "quote": "Invoice No.: IV2569/0042"},
        "date": {"line": 2, "raw": "12 ก.พ. 2569", "quote": "Date: 12 ก.พ. 2569"},
        "vendor_name": {"line": 3, "raw": "TG Company Co., Ltd.", "quote": "Seller: TG Company Co., Ltd."},
        "tax_id": {"line": 3, "raw": "0-1055-51000-01-1", "quote": "Tax ID 0-1055-51000-01-1"},
        "po_ref": {"line": 4, "raw": "PO-2026-002", "quote": "Your PO: PO-2026-002"},
        "subtotal": {"line": 5, "raw": "150,000.00", "quote": "Net amount ฿150,000.00"},
        "vat": {"line": 5, "raw": "10,500.00", "quote": "VAT 7% ฿10,500.00"},
        "total": {"line": 6, "raw": "160,500.00", "quote": "GRAND TOTAL ฿160,500.00"},
        "credit_days": {"line": 6, "raw": "45", "quote": "payment due 45 days"},
    }}


def test_llm_reads_a_layout_the_templates_cannot():
    kind, fields = _template_fields(lines_of(NEW_LAYOUT), "\n".join(NEW_LAYOUT), "template")
    assert kind is None or "total" not in fields
    fake = FakeGemini(new_layout_answer)
    kind, fields = LLMExtractor("k", "gemini-a", post=fake).extract(lines_of(NEW_LAYOUT), "llm")
    assert kind == "invoice"
    got = {k: f.value for k, f in fields.items()}
    assert got == {"invoice_no": "IV2569/0042", "date": "2026-02-12", "vendor_name": "TG Company Co., Ltd.",
                   "tax_id": "0105551000011", "po_ref": "PO-2026-002", "subtotal": 150000.0, "vat": 10500.0,
                   "total": 160500.0, "credit_days": 45}
    assert all(f.verified and f.clear and f.method == "llm" for f in fields.values())
    assert fields["total"].locator == "หน้า 1 บรรทัด 6" and fields["total"].quote == NEW_LAYOUT[5]


def test_bank_account_is_masked_before_the_model_sees_it():
    fake = FakeGemini(new_layout_answer)
    LLMExtractor("k", "gemini-a", post=fake).extract(lines_of(NEW_LAYOUT), "llm")
    prompt = fake.calls[0][1]
    assert "123-4-56789-0" not in prompt and "xxx-x-xx789-0" in prompt
    assert "0-1055-51000-01-1" in prompt and "160,500.00" in prompt  # tax ID and amounts stay readable


def test_invented_or_unparsable_values_are_never_usable():
    def liar(prompt):
        return {"kind": "invoice", "fields": {
            "total": {"line": 6, "raw": "999,999.00", "quote": "GRAND TOTAL ฿999,999.00"},  # not in the document
            "date": {"line": 2, "raw": "Date", "quote": "Date"},  # in the document, but not a date
            "invoice_no": {"line": 1, "raw": "IV2569/0042", "quote": "Invoice No.: IV2569/0042"},  # wrong line number
            "vat": None,
        }}
    _, fields = LLMExtractor("k", "gemini-a", post=FakeGemini(liar)).extract(lines_of(NEW_LAYOUT), "llm")
    assert not fields["total"].verified and not fields["total"].clear
    assert fields["date"].verified and not fields["date"].clear
    assert fields["invoice_no"].clear and fields["invoice_no"].locator == "หน้า 1 บรรทัด 2"
    assert "vat" not in fields


def test_ocr_garbage_document_number_is_unclear():
    lines = [("ใบกำกับภาษี", "บรรทัด 1 (OCR ความมั่นใจ 90)", True, [0, 0, 1, 1]),
             ("เลขที่ ปงง-88-205", "บรรทัด 2 (OCR ความมั่นใจ 88)", True, [0, 0, 1, 1])]
    ans = lambda p: {"kind": "invoice", "fields": {"invoice_no": {"line": 2, "raw": "ปงง-88-205", "quote": "เลขที่ ปงง-88-205"}}}
    _, fields = LLMExtractor("k", "gemini-a", post=FakeGemini(ans)).extract(lines, "ocr")
    assert fields["invoice_no"].verified and not fields["invoice_no"].clear
    assert fields["invoice_no"].bbox == [0, 0, 1, 1] and fields["invoice_no"].method == "ocr"


def test_falls_back_across_models_then_to_templates():
    fake = FakeGemini(new_layout_answer, {"gemini-a": 429, "gemini-b": 404})
    llm = LLMExtractor("k", "gemini-a,gemini-b,gemma-c", post=fake)
    assert llm.extract(lines_of(NEW_LAYOUT), "llm", "x.pdf")[0] == "invoice"
    assert llm.used == {"gemma-c": 1}
    llm.extract(lines_of(NEW_LAYOUT), "llm", "y.pdf")  # quota-hit models are not retried in the same run
    assert [m for m, _ in fake.calls] == ["gemini-a", "gemini-b", "gemma-c", "gemma-c"]

    dead = LLMExtractor("k", "gemini-a,gemini-b", post=FakeGemini(statuses={"gemini-a": 503, "gemini-b": 429}))
    assert dead.extract(lines_of(NEW_LAYOUT), "llm", "x.pdf") is None and dead.fallbacks == ["x.pdf"]


def test_rejected_key_stops_at_once():
    fake = FakeGemini(statuses={"gemini-a": 403})
    llm = LLMExtractor("bad", "gemini-a,gemini-b", post=fake)
    assert llm.extract(lines_of(NEW_LAYOUT), "llm") is None
    assert llm.extract(lines_of(NEW_LAYOUT), "llm") is None
    assert [m for m, _ in fake.calls] == ["gemini-a"]


@pytest.mark.parametrize("raw,iso", [
    ("2026-02-12", "2026-02-12"), ("12/02/2026", "2026-02-12"), ("12/02/2569", "2026-02-12"),
    ("12 ก.พ. 2569", "2026-02-12"), ("12 กุมภาพันธ์ พ.ศ. 2569", "2026-02-12"), ("๑๒ ก.พ. ๒๕๖๙", "2026-02-12"),
    ("12 Feb 2026", "2026-02-12"), ("February 12, 2026", "2026-02-12"), ("12.02.69", "2026-02-12"),
])
def test_dates_are_converted_by_code(raw, iso):
    assert parse_date(raw) == iso


@pytest.mark.parametrize("raw", ["Date", "31/13/2026", "12 Foo 2026"])
def test_bad_dates_raise(raw):
    with pytest.raises(ValueError):
        parse_date(raw)


def test_mask_line_only_touches_account_like_numbers():
    assert mask_line("โอนเข้าบัญชี 987-6-54321-0") == "โอนเข้าบัญชี xxx-x-xx321-0"
    assert mask_line("บัญชี 9876543210") == "บัญชี xxxxxx3210"
    for keep in ("เลขประจำตัวผู้เสียภาษี 0105551000011", "วันที่ 2026-02-12", "ยอดรวม 1,234,567.00", "PO-2026-002"):
        assert mask_line(keep) == keep


def test_contract_price_list_needs_item_and_price_on_one_line():
    lines = lines_of(["สัญญาซื้อขาย เลขที่ CT-9", "6.1 ผ้าเบรก ราคาต่อหน่วย 1,200.00 บาท", "6.2 น้ำมันเครื่อง ราคาต่อหน่วย 250.00 บาท"])
    ans = lambda p: {"kind": "contract", "fields": {"contract_no": {"line": 1, "raw": "CT-9", "quote": "เลขที่ CT-9"}},
                     "price_list": [{"item": "ผ้าเบรก", "line": 2, "raw": "1,200.00", "quote": "ผ้าเบรก ราคาต่อหน่วย 1,200.00"},
                                    {"item": "หัวเทียน", "line": 3, "raw": "250.00", "quote": "ราคาต่อหน่วย 250.00"}]}
    _, fields = LLMExtractor("k", "gemini-a", post=FakeGemini(ans)).extract(lines, "llm")
    assert fields["price:ผ้าเบรก"].value == 1200.0 and fields["price:ผ้าเบรก"].clear
    assert not fields["price:หัวเทียน"].verified and not fields["price:หัวเทียน"].clear
