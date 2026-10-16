"""LLM field extraction for text documents (PDF text layer or OCR lines), with the template
regexes in readers.py as the offline fallback.

The LLM only points at text; code decides every value:
- the model sees numbered lines with bank-account-like numbers already masked;
- for each field it returns the line number, the exact characters of the value ("raw") and a
  short verbatim quote; it never computes, translates or reformats;
- code checks that quote and raw really are in that line (Thai-safe: compared after `squash`),
  then converts raw itself (amounts, Thai/Buddhist-era dates, day counts);
- a field whose quote is not in the document is kept as unverified, and one whose raw cannot be
  parsed is kept as unclear. Rules never use either, so a hallucination cannot raise a flag.

Models are tried in order (GEMINI_MODELS) like the Worker: quota, unknown model, server errors and
timeouts move on to the next model; a rejected key stops the LLM and every document falls back
to the templates.
"""
import json
import os
import re
import urllib.error
import urllib.request

from .entities import mask_account
from .model import Field
from .normalize import amount, norm, squash
from .readers import CONTRACT_PATTERNS, INVOICE_PATTERNS

DEFAULT_MODELS = ("gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.8-flash,gemini-2.5-flash,"
                  "gemma-4-31b-it,gemma-4-26b-a4b-it")
API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
PROMPT_VERSION = 1

KINDS = {
    "invoice": INVOICE_PATTERNS,
    "contract": CONTRACT_PATTERNS,
    "policy": {"policy_no": (None, str)},
}
DESCRIPTIONS = {
    "invoice_no": "เลขที่ใบกำกับภาษี/ใบแจ้งหนี้ (invoice number)",
    "contract_no": "เลขที่สัญญา (contract number)",
    "policy_no": "เลขที่เอกสารนโยบาย (policy number)",
    "date": "วันที่ของเอกสาร (document date)",
    "vendor_name": "ชื่อผู้ขาย/ผู้ให้บริการ ไม่ใช่ผู้ซื้อ (seller name, not the buyer)",
    "tax_id": "เลขประจำตัวผู้เสียภาษี 13 หลักของผู้ขาย (seller's tax ID)",
    "po_ref": "เลขที่ใบสั่งซื้อที่อ้างถึง (purchase order number referenced)",
    "subtotal": "ยอดก่อนภาษีมูลค่าเพิ่ม (amount before VAT)",
    "vat": "จำนวนภาษีมูลค่าเพิ่ม (VAT amount)",
    "total": "ยอดรวมทั้งสิ้นรวม VAT (grand total including VAT)",
    "credit_days": "จำนวนวันเครดิต/ครบกำหนดชำระ (payment term in days)",
}
SYSTEM = """You read one audit document and point at where each field is written. You never decide anything.
Lines are numbered "n| text". For every field return either null (not written in the document) or
{"line": n, "raw": the exact characters of the value copied from that line, "quote": a short exact
snippet copied from that line that contains the label and the value}.
Copy characters exactly as they appear (Thai included). Never compute, add up, translate, convert dates
or currencies, or guess a value that is not written. If a value is unreadable, return null.
Answer with JSON only: {"kind": "invoice" | "contract" | "policy" | "other", "fields": {"<field>": ... }}"""

# 10-12 digits in dash/space groups (a bank account or phone number); 13-digit tax IDs, ISO dates
# and amounts with separators are left alone.
_ACCOUNT = re.compile(r"(?<![\d,.])\d[\d -]{8,16}\d(?![\d,.])")
_DOC_NO = re.compile(r"^[A-Za-z0-9][A-Za-z0-9/_.-]+$")  # Latin letters/digits only: catches Thai OCR misreads
_MONTHS = {}
for _i, _names in enumerate([
        ("ม.ค.", "มกราคม", "jan", "january"), ("ก.พ.", "กุมภาพันธ์", "feb", "february"),
        ("มี.ค.", "มีนาคม", "mar", "march"), ("เม.ย.", "เมษายน", "apr", "april"),
        ("พ.ค.", "พฤษภาคม", "may"), ("มิ.ย.", "มิถุนายน", "jun", "june"),
        ("ก.ค.", "กรกฎาคม", "jul", "july"), ("ส.ค.", "สิงหาคม", "aug", "august"),
        ("ก.ย.", "กันยายน", "sep", "sept", "september"), ("ต.ค.", "ตุลาคม", "oct", "october"),
        ("พ.ย.", "พฤศจิกายน", "nov", "november"), ("ธ.ค.", "ธันวาคม", "dec", "december")], 1):
    for _n in _names:
        _MONTHS[squash(_n).lower()] = _i


def mask_line(text: str) -> str:
    def sub(m):
        s = m.group(0)
        digits = sum(c.isdigit() for c in s)
        if not 10 <= digits <= 12 or re.fullmatch(r"\d{4}-\d{2}-\d{2}", s.strip()):
            return s
        return mask_account(s)
    return _ACCOUNT.sub(sub, text)


def _year(y: int) -> int:
    if y < 100:
        y += 2500 if y > 60 else 2000  # "69" → 2569 BE, "26" → 2026
    return y - 543 if y > 2400 else y  # Buddhist era → CE


def parse_date(raw: str) -> str:
    s = squash(raw).lower().replace("พ.ศ.", "").replace("ค.ศ.", "")
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        y, mo, d = _year(int(m[1])), int(m[2]), int(m[3])
    elif m := re.search(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})", s):
        d, mo, y = int(m[1]), int(m[2]), _year(int(m[3]))
    else:
        m = re.search(r"(\d{1,2})([^\d,]+?),?(\d{4})", s) or re.search(r"([^\d]+?)(\d{1,2}),?(\d{4})", s)
        if not m:
            raise ValueError(raw)
        a, b, y = m.groups()
        d, name = (a, b) if a.isdigit() else (b, a)
        mo = _MONTHS.get(name.strip(".")) or _MONTHS.get(name)
        if not mo:
            raise ValueError(raw)
        d, y = int(d), _year(int(y))
    if not (1 <= mo <= 12 and 1 <= d <= 31 and 1990 <= y <= 2100):
        raise ValueError(raw)
    return f"{y:04d}-{mo:02d}-{d:02d}"


def convert(name: str, conv, raw: str):
    """Code, not the model, turns the raw characters into a value."""
    s = norm(raw).strip()
    if conv is amount:
        m = re.search(r"\d[\d,]*(\.\d+)?", s)
        if not m:
            raise ValueError(raw)
        return amount(m.group(0))
    if conv is int:
        m = re.fullmatch(r"\D*(\d{1,4})\D*", s)
        if not m:
            raise ValueError(raw)
        return int(m.group(1))
    if name == "date" or name.endswith("_date"):
        return parse_date(s)
    if name == "tax_id":
        digits = re.sub(r"[\s-]", "", s)
        if not re.fullmatch(r"\d{13}", digits):
            raise ValueError(raw)
        return digits
    if name.endswith("_no") or name.endswith("_ref"):
        if not _DOC_NO.match(s):
            raise ValueError(raw)  # e.g. OCR read "INV-BS-205" as "ปงง-88-205"
        return s
    if not s:
        raise ValueError(raw)
    return s


class ModelError(Exception):
    def __init__(self, model, status, fatal=False):
        super().__init__(f"{model} {status}")
        self.fatal = fatal


def _http_post(url, headers, body, timeout):
    req = urllib.request.Request(url, json.dumps(body).encode(), headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, None


class LLMExtractor:
    """extract(lines, method) → (kind, fields) or None (no model answered: use the templates)."""

    def __init__(self, api_key: str, models=None, post=_http_post, timeout=30):
        self.key = api_key
        self.models = [m.strip() for m in (models or DEFAULT_MODELS).split(",") if m.strip()]
        self.post, self.timeout = post, timeout
        self.dead = set()  # models out of quota / missing for the rest of this run
        self.disabled = False  # key rejected: every model would fail the same way
        self.used = {}  # model → documents answered
        self.fallbacks = []  # documents read by the templates because no model answered
        self.errors = []

    def _call(self, model, prompt):
        body = {
            "systemInstruction": {"parts": [{"text": SYSTEM}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0, "maxOutputTokens": 2048,
                                 **({} if model.startswith("gemma") else {"responseMimeType": "application/json"})},
        }
        try:
            status, data = self.post(API.format(model=model), {"content-type": "application/json", "x-goog-api-key": self.key},
                                     body, self.timeout)
        except (OSError, ValueError) as e:  # network, timeout, or a 200 that is not JSON
            raise ModelError(model, type(e).__name__)
        if status != 200:
            raise ModelError(model, status, status in (401, 403))
        parts = ((data or {}).get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
        m = re.search(r"\{[\s\S]*\}", text)  # tolerate ```json fences or a lead-in sentence
        try:
            out = json.loads(m.group(0) if m else text)
        except ValueError:
            raise ModelError(model, "not JSON")
        if not isinstance(out, dict) or not isinstance(out.get("fields", {}), dict):
            raise ModelError(model, "bad shape")
        return out

    def ask(self, prompt):
        """→ (answer, model) or None."""
        for model in self.models:
            if self.disabled or model in self.dead:
                continue
            try:
                return self._call(model, prompt), model
            except ModelError as e:
                self.errors.append(str(e))
                if e.fatal:
                    self.disabled = True
                elif "not JSON" not in str(e) and "bad shape" not in str(e):
                    self.dead.add(model)
        return None

    def extract(self, lines, method, doc=""):
        masked = [mask_line(l[0]) for l in lines]
        wanted = {k: list(p) for k, p in KINDS.items()}
        spec = "\n".join(f"- {kind}: " + ", ".join(f"{f} = {DESCRIPTIONS.get(f, f)}" for f in fields)
                         for kind, fields in wanted.items())
        prompt = (f"Fields by document kind (return only the fields of the kind you choose):\n{spec}\n\n"
                  "DOCUMENT:\n" + "\n".join(f"{n}| {t}" for n, t in enumerate(masked, 1)))
        got = self.ask(prompt)
        if got is None:
            self.fallbacks.append(doc)
            return None
        out, model = got
        self.used[model] = self.used.get(model, 0) + 1
        kind = out.get("kind")
        if kind not in KINDS:
            return None  # "other": let the keyword templates have a look
        fields = {}
        for name, (_, conv) in KINDS[kind].items():
            ans = out.get("fields", {}).get(name)
            if not isinstance(ans, dict) or not str(ans.get("raw") or "").strip():
                continue
            fields[name] = self._check(name, conv, ans, lines, masked, method)
        return kind, fields

    @staticmethod
    def _check(name, conv, ans, lines, masked, method):
        raw, quote = str(ans["raw"]), str(ans.get("quote") or ans["raw"])
        sr, sq = squash(raw), squash(quote)
        try:
            n = int(ans.get("line"))
        except (TypeError, ValueError):
            n = 0
        # the cited line first, then any line holding both quote and raw (models miscount lines)
        order = ([n - 1] if 0 < n <= len(lines) else []) + list(range(len(lines)))
        hit = next((i for i in order if sr in squash(masked[i]) and sq in squash(masked[i])), None)
        if hit is None:
            # not in any line of the document: kept for coverage, never used by a rule
            return Field(name, mask_line(raw), mask_line(quote), "ไม่พบในบรรทัดใดของเอกสาร",
                         verified=False, method=method, clear=False)
        _, loc, clear, bbox = lines[hit]
        try:
            value = convert(name, conv, raw)
        except ValueError:
            value, clear = raw, False
        return Field(name, value, masked[hit].strip(), loc, verified=True, method=method, clear=clear, bbox=bbox)


def make_extractor(mode: str):
    """mode: template (offline, deterministic) | llm (needs GEMINI_API_KEY) | auto (llm when a key is set)."""
    key = os.environ.get("GEMINI_API_KEY", "")
    if mode == "template" or (mode == "auto" and not key):
        return None
    if not key:
        raise SystemExit("--extractor llm needs GEMINI_API_KEY")
    return LLMExtractor(key, os.environ.get("GEMINI_MODELS"))
