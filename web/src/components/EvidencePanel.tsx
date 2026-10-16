import type { Flag, Rule } from "../types";
import { FIELD_LABEL } from "../labels";
import type { Mark } from "./DocViewer";

interface Props {
  flag: Flag;
  marks: Mark[];
  rules: Rule[];
  activeKey: string | null;
  onPick: (key: string) => void;
}

const show = (v: Mark["value"]) => (v == null ? "-" : typeof v === "number" ? v.toLocaleString("th-TH", { minimumFractionDigits: 2 }) : v);

// Every flag carries the exact quotes it was raised from, with file + location. Each row is a
// "snip": pick it and the viewer opens the source with a box on that value, so the auditor checks
// the document instead of trusting the system.
export default function EvidencePanel({ flag, marks, rules, activeKey, onPick }: Props) {
  const rule = rules.find((r) => r.id === flag.basis);
  return (
    <section className="group" aria-label="หลักฐาน">
      <h3 className="group-title">หลักฐาน</h3>
      <div className="group-body">
        <table className="evidence-table">
          <thead>
            <tr>
              <th aria-label="tick mark" />
              <th>ข้อมูล</th>
              <th className="num">ค่า</th>
              <th className="src">ที่มา</th>
            </tr>
          </thead>
          <tbody>
            {marks.map((m, i) => {
              const e = flag.evidence[i];
              return (
                <tr
                  key={m.key}
                  className={m.key === activeKey ? "active" : ""}
                  onClick={() => onPick(m.key)}
                  tabIndex={0}
                  onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), onPick(m.key))}
                  aria-selected={m.key === activeKey}
                >
                  <td>
                    <span className="tick ok" title="พบข้อความนี้ในไฟล์ต้นฉบับ">
                      ✓
                    </span>
                  </td>
                  <td>
                    {FIELD_LABEL[e.field] ?? e.field}
                    {e.method === "ocr" && <span className="pill warn">OCR</span>}
                    <span className="src-inline muted small">
                      {e.file} · {e.locator}
                    </span>
                  </td>
                  <td className="num">{show(m.value)}</td>
                  <td className="src muted small">
                    {e.file}
                    <br />
                    {e.locator}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rule && (
          <p className="rule small">
            <span className={"tick " + (rule.verified ? "ok" : "warn")}>{rule.verified ? "✓" : "?"}</span> กฎ {rule.id} จาก{" "}
            {rule.source_doc}: “{rule.source_quote}” {rule.verified ? "พบข้อความนี้ในเอกสารนโยบาย" : "ไม่พบข้อความนี้ในเอกสาร"}
          </p>
        )}
      </div>
    </section>
  );
}
