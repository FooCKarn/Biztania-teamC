"""Run the whole pipeline on one engagement folder and write conflict_map.json for the web app.

Usage: python -m auditconcierge <engagement folder> [--out ../web/public/data] [--extractor auto|llm|template]
"""
import argparse
import hashlib
import json
from pathlib import Path

from .entities import VendorBook
from .extract_llm import make_extractor
from .matching import link_all, resolve_vendors, transactions
from .pages import locate, save_pages
from .quotes import verify
from .readers import read_engagement
from .rules import run_rules

SCHEMA_VERSION = "0.2"


def load_remember(folder: Path, records):
    cfg = json.loads((folder / "remember.json").read_text(encoding="utf-8"))
    texts = {r.file: r.text for r in records}
    for rule in cfg["rules"]:  # a rule is used only if its quote is really in the policy document
        rule["verified"] = verify(rule["source_quote"], texts.get(rule["source_doc"], ""))
    return cfg


def save_crops(folder: Path, records, out: Path):
    """Image crop of every OCR field, so the auditor can compare the quote with the scan."""
    from PIL import Image

    crops = out / "crops"
    crops.mkdir(parents=True, exist_ok=True)
    for r in records:
        if r.format != "scan":
            continue
        img = Image.open(folder / r.file)
        for f in r.fields.values():
            if f.bbox:
                x, y, w, h = f.bbox
                name = f"{Path(r.file).stem}_{f.name}.png"
                img.crop((max(0, x - 12), max(0, y - 10), x + w + 12, y + h + 10)).save(crops / name)
                f.crop = f"crops/{name}"


def build(folder: Path, out: Path | None = None, extractor: str = "template", llm=None, progress=None) -> dict:
    """extractor: template (default here, offline and deterministic for tests) | llm | auto.
    llm: an already made LLMExtractor (tests pass one with a fake transport).
    progress: optional callback progress(stage, **info) with stage ocr | read | pages | check."""
    progress = progress or (lambda *a, **k: None)
    llm = llm or make_extractor(extractor)
    records, skipped, skip_reasons = read_engagement(folder, llm, progress)
    progress("pages")
    boxes = save_pages(folder, records, out) if out else {}
    progress("check")
    cfg = load_remember(folder, records)
    book = VendorBook([r for r in records if r.kind == "vendor"])
    resolve_vendors(records, book)
    links = link_all(records, cfg["tolerance_pct"])
    txns = transactions(records, links)
    flags, comparisons = run_rules(records, links, txns, book, cfg)
    by_file = {r.file: r.file for r in records} | {r.id: r.file for r in records}
    for f in flags:
        for e in f["evidence"]:
            if e["bbox"] is None and by_file.get(e["doc"]) in boxes:
                e["bbox"] = locate(boxes[by_file[e["doc"]]], e["quote"])
    if out:
        save_crops(folder, records, out)

    by_id = {r.id: r for r in records}
    flag_docs = {d for f in flags for d in f["docs"]}
    pending = [{"doc": l.child, "kind": by_id[l.child].kind, "why": l.why, "candidates": l.candidates}
               for l in links if l.level == "pending"]
    for t in txns:
        t["links"] = [c for c in comparisons if c["transaction"] == t["id"]]
        t["flags"] = [f["id"] for f in flags if f["transaction"] == t["id"]]
        t["pending"] = any(p["doc"] in t["members"] for p in pending)

    docs = []
    for r in records:
        d = r.to_json()
        d["fields"].pop("account_token", None)
        for k, f in d["fields"].items():
            f["crop"] = getattr(r.fields[k], "crop", None)
        link = next((l for l in links if l.child == r.id), None)
        d["link"] = {"parent": link.parent, "level": link.level, "why": link.why} if link else None
        d["in_flags"] = r.id in flag_docs
        docs.append(d)

    unclear = [{"doc": r.id, "field": f.name, "locator": f.locator, "quote": f.quote}
               for r in records for f in r.fields.values() if not f.clear]
    unverified = [{"doc": r.id, "field": f.name} for r in records for f in r.fields.values() if not f.verified]
    files = sorted({r.file for r in records} | set(skipped))
    run_id = hashlib.sha256("".join(r.sha256 for r in records).encode()).hexdigest()[:12]
    result = {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "engagement": {"client": cfg["client"], "tolerance_pct": cfg["tolerance_pct"], "materiality_thb": cfg["materiality_thb"],
                       "synthetic": cfg.get("synthetic", True)},
        "rules": [{k: v for k, v in r.items()} for r in cfg["rules"]],
        "vendors": [{k: v for k, v in v.items() if k not in ("keys", "account_token")} for v in book.vendors.values()],
        "files": [{"file": f, "sha256": next((r.sha256 for r in records if r.file == f), None),
                   "read": f not in skipped} for f in files],
        "documents": docs,
        "transactions": txns,
        "flags": flags,
        "pending": pending,
        "extraction": {"mode": "llm" if llm else "template", "models": dict(llm.used) if llm else {},
                       "template_fallback": list(llm.fallbacks) if llm else [],
                       "errors": sorted(set(llm.errors)) if llm else []},
        "coverage": {"files": len(files), "unreadable_files": skipped, "unreadable_reasons": skip_reasons, "unclear_fields": unclear,
                     "unverified_fields": unverified},
    }
    if out:
        out.mkdir(parents=True, exist_ok=True)
        (out / "conflict_map.json").write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", type=Path)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--extractor", choices=("auto", "llm", "template"), default="auto",
                    help="auto = LLM when GEMINI_API_KEY is set, else templates")
    a = ap.parse_args()
    res = build(a.folder, a.out, a.extractor)
    ex = res["extraction"]
    print(f"extraction: {ex['mode']} {ex['models']}" + (f" · templates for {ex['template_fallback']}" if ex["template_fallback"] else ""))
    print(f"files {res['coverage']['files']} · documents {len(res['documents'])} · transactions {len(res['transactions'])}"
          f" · flags {len(res['flags'])} · รอจับคู่ {len(res['pending'])} · อ่านไม่ชัด {len(res['coverage']['unclear_fields'])}")
    for f in res["flags"]:
        print(f"  [{f['risk']}] {f['type']:15s} {', '.join(f['docs'])} — {f['summary']}")
    for p in res["pending"]:
        print(f"  [รอจับคู่] {p['doc']} — {p['why']} {p['candidates']}")


if __name__ == "__main__":
    main()
