import type { Flag, Rule } from "../types";
import { fieldLabel } from "../labels";
import { locale, t } from "../i18n";
import type { Mark } from "./DocViewer";

interface Props {
  flag: Flag;
  marks: Mark[];
  rules: Rule[];
  activeKey: string | null;
  onPick: (key: string) => void;
}

const show = (v: Mark["value"]) => (v == null ? "-" : typeof v === "number" ? v.toLocaleString(locale(), { minimumFractionDigits: 2 }) : v);

// Every flag carries the exact quotes it was raised from, with file + location. Each row is a
// "snip": pick it and the viewer opens the source with a box on that value, so the auditor checks
// the document instead of trusting the system.
export default function EvidencePanel({ flag, marks, rules, activeKey, onPick }: Props) {
  const rule = rules.find((r) => r.id === flag.basis);
  return (
    <section className="group" aria-label={t("หลักฐาน", "Evidence")}>
      <h3 className="group-title">{t("หลักฐาน", "Evidence")}</h3>
      <div className="group-body">
        <table className="evidence-table">
          <thead>
            <tr>
              <th aria-label={t("เครื่องหมายตรวจ", "Tick mark")} />
              <th>{t("ข้อมูล", "Field")}</th>
              <th className="num">{t("ค่า", "Value")}</th>
              <th className="src">{t("ที่มา", "Source")}</th>
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
                  aria-current={m.key === activeKey ? "true" : undefined}
                >
                  <td>
                    <span className="tick ok" title={t("พบข้อความนี้ในไฟล์ต้นฉบับ", "Found in the source file")}>
                      ✓
                    </span>
                  </td>
                  <td>
                    {fieldLabel(e.field)}
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
        <p className="muted small">✓ {t("= พบข้อความนี้ในไฟล์ต้นฉบับ (ไม่ใช่ข้อสรุปการตรวจสอบ)", "= quote found in the source file (not an audit conclusion)")}</p>
        {rule && (
          <p className="rule small">
            <span className={"tick " + (rule.verified ? "ok" : "warn")}>{rule.verified ? "✓" : "?"}</span> {t("กฎ", "Rule")} {rule.id}{" "}
            {t("จาก", "from")} {rule.source_doc}: “{rule.source_quote}”{" "}
            {rule.verified ? t("พบข้อความนี้ในเอกสารนโยบาย", "found in the policy document") : t("ไม่พบข้อความนี้ในเอกสาร", "not found in the document")}
          </p>
        )}
      </div>
    </section>
  );
}
