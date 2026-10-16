"""Group records into transactions (PO → GR → Invoice → Payment) with a confidence level.

sure    : the document prints the other document's number (Invoice → PO-2026-001)
likely  : no reference, but exactly one candidate has the same vendor, an amount within
          tolerance and a date in the right order → checked, flags marked "จับคู่โดยอนุมาน"
pending : several candidates (or an unreadable key) → not checked; goes to "รอจับคู่"
none    : no candidate at all → becomes a MISSING_LINK candidate (after full-text search)
"""
import re
from dataclasses import dataclass, field

from .entities import VendorBook


@dataclass
class Link:
    child: str
    parent: str | None
    level: str  # sure | likely | pending | none
    why: str
    candidates: list = field(default_factory=list)


def within(a: float, b: float, pct: float) -> bool:
    return abs(a - b) <= abs(b) * pct / 100


def resolve_vendors(records, book: VendorBook):
    for r in records:
        if r.kind == "po":
            r.vendor, r.vendor_how = book.resolve(name=r.v("vendor_name"), code=r.v("vendor_code"))
        elif r.kind in ("invoice", "contract"):
            r.vendor, r.vendor_how = book.resolve(name=r.v("vendor_name"), tax_id=r.v("tax_id"))
        elif r.kind == "payment":
            desc = re.sub(r"INV-[A-Z]{2}-\d{3}", " ", r.v("description", ""))
            r.vendor, r.vendor_how = book.resolve(name=desc)


def link_all(records, tolerance_pct: float):
    by_kind = {}
    for r in records:
        by_kind.setdefault(r.kind, []).append(r)
    pos = {r.id: r for r in by_kind.get("po", [])}
    invoices = by_kind.get("invoice", [])
    links = []

    for gr in by_kind.get("gr", []):
        ref = gr.v("po_ref")
        links.append(Link(gr.id, ref, "sure", f"ใบรับของอ้างถึง {ref}") if ref in pos
                     else Link(gr.id, None, "none", "ใบรับของไม่ได้อ้าง PO ที่มีอยู่"))

    for inv in invoices:
        ref = inv.v("po_ref")
        if ref in pos:
            links.append(Link(inv.id, ref, "sure", f"Invoice อ้างถึง {ref}"))
            continue
        if "po_ref" in inv.fields and not inv.fields["po_ref"].clear:
            links.append(Link(inv.id, None, "pending", "อ่านเลข PO ใน Invoice ไม่ชัด"))
            continue
        sub, date = inv.v("subtotal"), inv.v("date")
        cands = [p for p in pos.values() if p.vendor and p.vendor == inv.vendor and sub is not None
                 and within(sub, p.v("amount", 0), tolerance_pct) and (date is None or p.v("date", "") <= date)]
        if len(cands) == 1:
            links.append(Link(inv.id, cands[0].id, "likely",
                              f"Invoice ไม่ได้อ้าง PO แต่มี PO ของ vendor เดียวกันยอดใกล้กันเพียงใบเดียว ({cands[0].id})", [cands[0].id]))
        elif cands:
            links.append(Link(inv.id, None, "pending",
                              f"Invoice ไม่ได้อ้าง PO และมี PO ที่เข้าเกณฑ์ {len(cands)} ใบ", [c.id for c in cands]))
        else:
            links.append(Link(inv.id, None, "none", "ไม่พบ PO ของ vendor นี้ที่ยอดใกล้กัน"))

    paid_inv = {}
    for pay in by_kind.get("payment", []):
        ref = pay.v("invoice_ref")
        inv_ids = {i.id for i in invoices}
        if ref in inv_ids:
            links.append(Link(pay.id, ref, "sure", f"รายการโอนระบุ {ref}"))
            paid_inv.setdefault(ref, []).append(pay.id)
            continue
        amt = pay.v("amount")
        cands = [i for i in invoices if i.vendor and i.vendor == pay.vendor and amt is not None
                 and i.v("total") is not None and within(amt, i.v("total"), 0) and i.id not in paid_inv]
        if len(cands) == 1:
            links.append(Link(pay.id, cands[0].id, "likely",
                              f"รายการโอนไม่ระบุเลข Invoice แต่ยอดและ vendor ตรงกับ {cands[0].id} เพียงใบเดียว", [cands[0].id]))
        elif cands:
            links.append(Link(pay.id, None, "pending", f"ยอดโอนตรงกับ Invoice {len(cands)} ใบ", [c.id for c in cands]))
        else:
            links.append(Link(pay.id, None, "none", "ไม่พบ Invoice ที่ยอดตรงกัน"))
    return links


def transactions(records, links):
    """Union records connected by sure/likely links. Returns list of dicts."""
    parent = {r.id: r.id for r in records if r.kind in ("po", "gr", "invoice", "payment")}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for l in links:
        if l.parent and l.level in ("sure", "likely") and l.child in parent and l.parent in parent:
            parent[find(l.child)] = find(l.parent)
    groups = {}
    for rid in parent:
        groups.setdefault(find(rid), []).append(rid)
    by_id = {r.id: r for r in records}
    order = {"po": 0, "gr": 1, "invoice": 2, "payment": 3}
    out = []
    for members in groups.values():
        members.sort(key=lambda m: (order[by_id[m].kind], m))
        head = members[0]
        vendor = next((by_id[m].vendor for m in members if by_id[m].vendor), None)
        mlinks = [l for l in links if l.child in members]
        level = "likely" if any(l.level == "likely" for l in mlinks if l.parent) else "sure"
        out.append({"id": f"T-{head}", "members": members, "vendor": vendor, "match": level})
    out.sort(key=lambda t: t["id"])
    return out
