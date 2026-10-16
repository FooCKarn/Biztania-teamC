"""Page images for the web document viewer: the auditor sees the source page with a box around
the exact line each value came from (like ticking a value against the document).

Lines that look like a bank account number are blacked out before a page is saved, so the page
image never shows an account the rest of the pipeline only exposes masked.
"""
import re
from pathlib import Path

from .normalize import norm

ACCOUNT_LIKE = re.compile(r"(?<!\d)(\d{3}-\d-\d{5}-\d|\d{10})(?!\d)")
ZOOM = 1.5  # PDF points → image pixels
MARGIN = 40  # points kept below the last line when the page is cropped to its content


def _pdf_page(path: Path, out: Path):
    """Render page 1 (cropped to its content) with account-like lines redacted.
    Returns (image size, {normalised line text: [x, y, w, h] in image pixels})."""
    import pymupdf

    with pymupdf.open(path) as doc:
        page = doc[0]
        lines = []
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                lines.append((norm("".join(s["text"] for s in line["spans"])).strip(), pymupdf.Rect(line["bbox"])))
        for text, rect in lines:
            if ACCOUNT_LIKE.search(text):
                page.add_redact_annot(rect, fill=(0, 0, 0))
        page.apply_redactions()
        bottom = max((r.y1 for _, r in lines), default=page.rect.y1)
        clip = pymupdf.Rect(0, 0, page.rect.x1, min(page.rect.y1, bottom + MARGIN))
        pix = page.get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM), clip=clip)
        pix.save(out)
        boxes = {}
        for text, r in lines:
            if not ACCOUNT_LIKE.search(text):
                boxes.setdefault(text, [round(v * ZOOM) for v in (r.x0, r.y0, r.width, r.height)])
        return [pix.width, pix.height], boxes


def _scan_page(path: Path, out: Path):
    from PIL import Image, ImageDraw

    from .readers import _ocr_lines

    img = Image.open(path).convert("RGB")
    draw = ImageDraw.Draw(img)
    for text, _, _, bbox in _ocr_lines(path):
        if bbox and ACCOUNT_LIKE.search(text):
            x, y, w, h = bbox
            draw.rectangle((x - 4, y - 4, x + w + 4, y + h + 4), fill=(0, 0, 0))
    img.save(out)
    return [img.width, img.height]


def save_pages(folder: Path, records, out: Path):
    """Write pages/<file>.png for every PDF and scan, set record.page and each PDF field's bbox
    (OCR fields already carry theirs from the scan).
    Returns {file: {line text: bbox}} so evidence quoted from a PDF line can be boxed too."""
    pages = out / "pages"
    pages.mkdir(parents=True, exist_ok=True)
    done = {}
    for r in records:
        if r.format not in ("pdf", "scan"):
            continue
        if r.file not in done:
            name = Path(r.file).stem + ".png"
            if r.format == "pdf":
                size, boxes = _pdf_page(folder / r.file, pages / name)
            else:
                size, boxes = _scan_page(folder / r.file, pages / name), {}
            done[r.file] = ({"image": f"pages/{name}", "width": size[0], "height": size[1]}, boxes)
        r.page, boxes = done[r.file]
        if r.format == "pdf":
            for f in r.fields.values():
                if f.locator.startswith("หน้า 1 "):
                    f.bbox = boxes.get(f.quote.strip())
    return {file: boxes for file, (_, boxes) in done.items()}


def locate(boxes: dict, quote: str):
    """Box of the PDF line that contains the quote (rule quotes are part of a policy line)."""
    q = norm(quote).strip()
    return boxes.get(q) or next((b for text, b in boxes.items() if q and q in text), None)
