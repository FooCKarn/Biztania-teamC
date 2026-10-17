from dataclasses import asdict, dataclass, field


@dataclass
class Field:
    name: str
    value: object
    quote: str
    locator: str  # "page 1 line 4", "row 3", "line 2 (OCR)"
    verified: bool = False  # quote found verbatim in the source text
    method: str = "template"  # template | table | ocr
    clear: bool = True  # False = OCR/parse not confident: shown as "อ่านไม่ชัด", never used to raise a flag
    bbox: list | None = None  # [left, top, width, height] in pixels of the scan, or of the PDF page image


@dataclass
class Record:
    """One business document: a PO row, a GR row, an invoice file, a bank line, a contract."""
    id: str
    kind: str  # po | gr | invoice | payment | vendor | contract | policy
    file: str
    format: str  # erp_csv | xlsx | pdf | scan | csv
    sha256: str
    text: str = ""  # normalised full text of the source (for quote checks and full-text search)
    fields: dict = field(default_factory=dict)
    vendor: str | None = None  # resolved vendor_code
    vendor_how: str | None = None
    page: dict | None = None  # {"image", "width", "height"}: page image for the web viewer (PDF/scan)

    def v(self, name, default=None):
        """Value usable by the rules: clear and its quote found in the source (else `default`)."""
        f = self.fields.get(name)
        return f.value if f is not None and f.clear and f.verified else default

    def to_json(self):
        d = asdict(self)
        d.pop("text")
        d["fields"] = {k: asdict(f) for k, f in self.fields.items()}
        return d
