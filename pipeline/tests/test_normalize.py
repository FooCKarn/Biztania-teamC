from auditconcierge.entities import VendorBook, account_token, mask_account, name_key
from auditconcierge.model import Field, Record
from auditconcierge.normalize import amount, norm, squash
from auditconcierge.quotes import verify


def test_pdf_private_use_tone_mark_and_split_sara_am():
    # what PyMuPDF returns for "ผู้ขาย" and "จำกัด" with the Loma font
    assert norm("ผูขาย") == "ผู้ขาย"
    assert norm("จํากัด") == "จำกัด"


def test_thai_digits_and_amounts():
    assert norm("๑๒๐,๐๐๐") == "120,000"
    assert amount("150,000.00") == 150000.0


def test_quote_check_ignores_spacing_but_not_content():
    src = "รวมเงิน 150,000.00 บาท\nครบกำหนดชำระ 30 วัน"
    assert verify("รวมเงิน150,000.00 บาท", src)  # OCR drops spaces between Thai words
    assert not verify("รวมเงิน 120,000.00 บาท", src)
    assert not verify("", src)


def _vendor(code, th, en, tax, acct):
    from auditconcierge.entities import account_token as tok
    fs = {k: Field(k, v, "", "") for k, v in
          {"vendor_code": code, "name_th": th, "name_en": en, "tax_id": tax, "account": acct, "account_token": tok(acct)}.items()}
    return Record(f"VENDOR-{code}", "vendor", "vendor_master.csv", "csv", "", "", fs)


def test_vendor_resolution_and_unsure_names_stay_unmerged():
    book = VendorBook([_vendor("V001", "บริษัท ทีจี คอมพานี จำกัด", "TG COMPANY CO.,LTD.", "0105551000011", "123-4-56789-0"),
                       _vendor("V002", "บริษัท บางกอกสตีล จำกัด", "BANGKOK STEEL CO.,LTD.", "0105552000022", "222-3-33333-4")])
    assert book.resolve(name="บจ. ทีจี คอมพานี")[0] == "V001"
    assert book.resolve(name="TRF TG COMPANY")[0] == "V001"
    assert book.resolve(tax_id="0105552000022")[0] == "V002"
    assert book.resolve(name="Siam Steel")[0] is None
    assert name_key("TG COMPANY CO.,LTD.") == "tg"


def test_account_is_masked_and_tokenised():
    assert mask_account("987-6-54321-0") == "xxx-x-xx321-0"
    assert account_token("123-4-56789-0") == account_token("1234567890")
    assert account_token("123-4-56789-0") != account_token("987-6-54321-0")
    assert "56789" not in account_token("123-4-56789-0")
    assert squash(" a b\n") == "ab"
