"""Vendor resolution and bank-account tokenisation.

Names are matched against the Vendor master (tax ID first, then normalised name, then
token containment). An unsure name is left unresolved rather than merged (Stockplify rule D7).
Bank account numbers never leave this module in clear: comparisons use salted tokens and
the output only shows a masked form.
"""
import hashlib
import os
import re
from difflib import SequenceMatcher

from .normalize import norm

LEGAL = {"บริษัท", "จำกัด", "มหาชน", "บจ", "บมจ", "หจก", "co", "ltd", "limited", "inc", "corp", "corporation",
         "plc", "public", "company", "trf", "pay"}
SALT = os.environ.get("ACCOUNT_TOKEN_SALT", "demo-salt-not-secret")


def name_key(name: str) -> str:
    s = norm(name).lower().replace(".", " ").replace(",", " ")
    toks = [t for t in re.split(r"\s+", s) if t and t not in LEGAL]
    return " ".join(toks)


def account_token(acct: str) -> str:
    digits = re.sub(r"\D", "", acct)
    return hashlib.sha256((SALT + digits).encode()).hexdigest()[:16]


def mask_account(acct: str) -> str:
    seen, keep = 0, 4
    total = sum(c.isdigit() for c in acct)
    out = []
    for c in acct:
        if c.isdigit():
            seen += 1
            out.append(c if seen > total - keep else "x")
        else:
            out.append(c)
    return "".join(out)


class VendorBook:
    def __init__(self, vendor_records):
        self.vendors = {}
        for r in vendor_records:
            code = r.v("vendor_code")
            self.vendors[code] = {
                "code": code, "name_th": r.v("name_th"), "name_en": r.v("name_en"), "tax_id": r.v("tax_id"),
                "account_token": r.v("account_token"), "account_masked": r.v("account", ""),
                "keys": {name_key(r.v("name_th", "")), name_key(r.v("name_en", ""))} - {""},
                "record": r.id,
            }

    def resolve(self, name: str | None = None, tax_id: str | None = None, code: str | None = None):
        """→ (vendor_code, how) or (None, reason)."""
        if code and code in self.vendors:
            return code, "รหัส vendor ใน ERP"
        if tax_id:
            for v in self.vendors.values():
                if v["tax_id"] == tax_id:
                    return v["code"], "เลขประจำตัวผู้เสียภาษีตรงกับ Vendor master"
        if not name:
            return None, "ไม่มีชื่อหรือเลขผู้เสียภาษี"
        key = name_key(name)
        exact = [v for v in self.vendors.values() if key in v["keys"]]
        if len(exact) == 1:
            return exact[0]["code"], "ชื่อตรงกับ Vendor master"
        toks = set(key.split())
        partial = [v for v in self.vendors.values() if any(toks and toks <= set(k.split()) for k in v["keys"])]
        if len(partial) == 1:
            return partial[0]["code"], "ชื่อเป็นส่วนหนึ่งของชื่อใน Vendor master"
        scored = sorted(((max(SequenceMatcher(None, key, k).ratio() for k in v["keys"]), v["code"]) for v in self.vendors.values()), reverse=True)
        if scored and scored[0][0] >= 0.9 and (len(scored) == 1 or scored[1][0] < 0.8):
            return scored[0][1], f"ชื่อใกล้เคียง Vendor master ({scored[0][0]:.0%})"
        return None, "ไม่แน่ใจว่าเป็น vendor รายใด จึงไม่รวม"
