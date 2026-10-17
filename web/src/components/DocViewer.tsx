import { useEffect, useRef } from "react";
import type { Doc } from "../types";
import { fieldLabel, KIND_LABEL } from "../labels";
import { useSource } from "../source";
import { t } from "../i18n";

/** One value to tick on the source: a box on a page image, or a row (and cell) in a table file. */
export interface Mark {
  key: string;
  doc: string;
  label: string;
  value: string | number | null;
  quote: string;
  locator: string;
  bbox: number[] | null;
  active: boolean;
}

interface Props {
  doc: Doc;
  /** Every document read from the same file, so a CSV/XLSX row is shown among its neighbours. */
  siblings: Doc[];
  /** Marks for any document of this file; the active one decides what is scrolled into view. */
  marks: Mark[];
  onPick?: (key: string) => void;
}

const rowOf = (locator: string) => Number(/แถว (\d+)/.exec(locator)?.[1] ?? NaN);
const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function cells(quote: string, format: string): string[] {
  if (format === "xlsx") return quote.split(" | ");
  const out: string[] = [];
  let cur = "",
    q = false;
  for (const c of quote) {
    if (c === '"') q = !q;
    else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const sameValue = (cell: string, v: Mark["value"]) =>
  v != null && (cell.trim() === String(v).trim() || (typeof v === "number" && Number(cell.replace(/,/g, "")) === v));

// Like ticking a value against the source in DataSnipper: the page (or sheet) the value came from,
// with a box on the exact line or cell. Only data the pipeline already published is shown, so bank
// accounts stay masked (and page images have account-like lines blacked out by the pipeline).
export default function DocViewer({ doc, siblings, marks, onPick }: Props) {
  const activeRef = useRef<HTMLElement | null>(null);
  const { base, engagement } = useSource();
  const active = marks.find((m) => m.active);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [doc.id, active?.key]);

  const head = (
    <header className="viewer-head">
      <div className="viewer-file">
        <span className="file-icon" aria-hidden>
          {doc.format === "scan" ? "▣" : doc.format === "pdf" ? "▤" : "▦"}
        </span>
        <div>
          <strong>{doc.file}</strong>
          <span className="muted small">
            {KIND_LABEL[doc.kind]} · {doc.format.replace("erp_csv", "ERP export").toUpperCase()} · sha256 {doc.sha256.slice(0, 10)}…
          </span>
        </div>
      </div>
    </header>
  );

  let body;
  if (doc.page && engagement?.purged) {
    body = (
      <p className="viewer-hint">
        {t(
          "ไฟล์ต้นฉบับและภาพหน้าเอกสารถูกลบแล้วตามนโยบายลบไฟล์หลังปิดงาน ข้อความอ้างอิง (quote) ยังอยู่ในกระดาษทำการ",
          "The source file and page images were deleted under the post-closing retention policy. The quotes remain in the working paper.",
        )}
      </p>
    );
  } else if (doc.page) {
    const { width: W, height: H } = doc.page;
    const pct = (b: number[]) => ({
      left: `${(b[0] / W) * 100}%`,
      top: `${(b[1] / H) * 100}%`,
      width: `${(b[2] / W) * 100}%`,
      height: `${(b[3] / H) * 100}%`,
    });
    body = (
      <div className="page">
        <img src={`${base}${doc.page.image}`} alt={t(`หน้าเอกสาร ${doc.file}`, `Page of ${doc.file}`)} width={W} height={H} />
        {marks
          .filter((m) => m.doc === doc.id && m.bbox)
          .map((m) => (
            <button
              key={m.key}
              ref={m.active ? (el) => void (activeRef.current = el) : undefined}
              className={"snip" + (m.active ? " active" : "")}
              style={pct(m.bbox!)}
              onClick={() => onPick?.(m.key)}
              title={`${m.label}: ${m.quote}`}
              aria-label={`${m.label} ${m.quote}`}
            >
              <span className="snip-tick" aria-hidden>
                ✓
              </span>
            </button>
          ))}
      </div>
    );
  } else {
    const rows = siblings
      .flatMap((d) => {
        const f = Object.values(d.fields).find((x) => rowOf(x.locator));
        return f ? [{ doc: d, row: rowOf(f.locator), cells: cells(f.quote, d.format) }] : [];
      })
      .sort((a, b) => a.row - b.row);
    const width = Math.max(1, ...rows.map((r) => r.cells.length));
    body = rows.length ? (
      <div className="sheet-wrap">
        <table className="sheet">
          <thead>
            <tr>
              <th />
              {Array.from({ length: width }, (_, i) => (
                <th key={i}>{COLS[i] ?? i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const hits = marks.filter((m) => m.doc === r.doc.id);
              const on = hits.length > 0;
              const isActive = hits.some((m) => m.active);
              const activeCol = isActive ? r.cells.findIndex((c) => hits.some((m) => m.active && sameValue(c, m.value))) : -1;
              return (
                <tr
                  key={r.doc.id}
                  className={(on ? "hit" : "") + (isActive ? " active" : "")}
                  ref={isActive && activeCol < 0 ? (el) => void (activeRef.current = el) : undefined}
                  onClick={on ? () => onPick?.(hits[0].key) : undefined}
                >
                  <th>{r.row}</th>
                  {r.cells.map((c, i) => {
                    const cellHit = on && hits.some((m) => sameValue(c, m.value));
                    return (
                      <td
                        key={i}
                        className={cellHit ? "cell-hit" : ""}
                        ref={i === activeCol ? (el) => void (activeRef.current = el) : undefined}
                      >
                        {cellHit && (
                          <span className="snip-tick" aria-hidden>
                            ✓
                          </span>
                        )}
                        {c}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="muted pad">{t("ไม่มีข้อมูลตารางให้แสดง", "No table data to show")}</p>
    );
  }

  return (
    <div className="viewer">
      {head}
      {body}
      {active ? (
        <div className="viewer-quote">
          <p className="small">
            <span className="tick ok" aria-hidden>
              ✓
            </span>{" "}
            <strong>{active.label}</strong> {t("พบข้อความนี้ในไฟล์ต้นฉบับ", "found in the source file")} · {active.locator}
          </p>
          <blockquote>{active.quote}</blockquote>
        </div>
      ) : (
        <p className="viewer-hint muted small">
          {t("แตะกรอบบนเอกสารหรือแถวในตารางหลักฐานเพื่อดูข้อความต้นฉบับ", "Tap a box on the document or a row in the evidence table to see the source text")}
        </p>
      )}
      <details className="viewer-fields">
        <summary>
          {t("ข้อมูลที่ระบบอ่านได้จากเอกสารนี้", "Fields read from this document")} ({Object.keys(doc.fields).length})
        </summary>
        <table className="fields">
          <tbody>
            {Object.values(doc.fields).map((f) => (
              <tr key={f.name} className={f.clear ? "" : "unclear"}>
                <th>{fieldLabel(f.name)}</th>
                <td>
                  {String(f.value)}
                  {!f.clear && <span className="pill warn">? {t("อ่านไม่ชัด ไม่นำไปใช้ตรวจ", "unclear, not used for checks")}</span>}
                  {!f.verified && <span className="pill warn">{t("ไม่พบข้อความต้นฉบับ", "source text not found")}</span>}
                  {f.crop && !engagement?.purged && (
                    <img src={`${base}${f.crop}`} alt={`${t("ภาพจากไฟล์สแกน", "Scan crop")}: ${f.quote}`} className="crop" />
                  )}
                </td>
                <td className="muted small">{f.locator}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
