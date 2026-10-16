"""Text normalisation for Thai + English audit documents.

PDF text layers and OCR output spell the same Thai text in different ways (font
private-use glyphs, SARA AM split into NIKHAHIT + SARA AA, tone marks before the vowel).
Quote checks and field regexes run on the normalised form so both sides compare equal.
"""
import re
import unicodedata

# Thai glyph variants that Thai fonts place in the Private Use Area (Windows/Apple layout).
_PUA = {
    0xF700: "ฐ", 0xF701: "ิ", 0xF702: "ี", 0xF703: "ึ", 0xF704: "ื",
    0xF705: "่", 0xF706: "้", 0xF707: "๊", 0xF708: "๋", 0xF709: "์",
    0xF70A: "่", 0xF70B: "้", 0xF70C: "๊", 0xF70D: "๋", 0xF70E: "์",
    0xF70F: "ญ", 0xF710: "ั", 0xF711: "ํ", 0xF712: "็", 0xF713: "่",
    0xF714: "้", 0xF715: "๊", 0xF716: "๋", 0xF717: "์", 0xF718: "ุ",
    0xF719: "ู", 0xF71A: "ฺ",
}
_THAI_DIGITS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")
_VOWEL_MARKS = set("ัิีึืฺุู็")
_TONE_MARKS = set("่้๊๋์ํ")
_MARK_RUN = re.compile("[ัิ-ฺ็-๎]+")


def _order_marks(m: re.Match) -> str:
    run = m.group(0)
    return "".join(sorted(run, key=lambda c: 0 if c in _VOWEL_MARKS else 1 if c in _TONE_MARKS else 2))


def norm(text: str) -> str:
    """Canonical form used everywhere text is compared or parsed."""
    s = unicodedata.normalize("NFC", text).translate(_PUA).translate(_THAI_DIGITS)
    s = s.replace("ํา", "ำ").replace("ํ่า", "่ำ")
    s = _MARK_RUN.sub(_order_marks, s)
    s = s.replace("ํา", "ำ")
    s = s.replace("’", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"[ \t ]+", " ", s)


def squash(text: str) -> str:
    """Normalised text with all whitespace removed (OCR joins Thai words without spaces)."""
    return re.sub(r"\s+", "", norm(text))


def amount(s: str) -> float:
    return float(norm(s).replace(",", "").strip())
