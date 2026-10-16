"""Page images for the web viewer must never show a bank account number in full."""
from PIL import Image

from auditconcierge.pages import ZOOM, _pdf_page, locate


def test_account_lines_are_blacked_out_and_other_lines_are_boxed(tmp_path):
    import pymupdf

    pdf = tmp_path / "inv.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_text((50, 80), "Invoice No. INV-1")
        page.insert_text((50, 110), "Pay to account 123-4-56789-0")
        page.insert_text((50, 140), "Total 1,000.00")
        doc.save(pdf)

    png = tmp_path / "inv.png"
    size, boxes = _pdf_page(pdf, png)
    img = Image.open(png).convert("L")
    assert list(img.size) == size
    assert locate(boxes, "Total 1,000.00") and locate(boxes, "INV-1")
    assert not any("56789" in text for text in boxes)

    # the account line is a solid black box: no white pixel left inside it
    left, top = int(50 * ZOOM), int(102 * ZOOM)
    region = img.crop((left, top, left + 60, top + 6))
    assert region.getextrema()[1] < 40
