import type { Doc, Flag, Rule } from "../types";
import { FIELD_LABEL } from "../labels";

interface Props {
  flag: Flag;
  docs: Map<string, Doc>;
  rules: Rule[];
}

// Every flag carries the exact quotes it was raised from, with file + location, so the
// auditor can check the source instead of trusting the system.
export default function EvidencePanel({ flag, docs, rules }: Props) {
  const rule = rules.find((r) => r.id === flag.basis);
  return (
    <div className="card">
      <h3>หลักฐาน</h3>
      <div className="evidence">
        {flag.evidence.map((e, i) => {
          const doc = docs.get(e.doc);
          const fieldKey = Object.keys(doc?.fields ?? {}).find((k) => k === e.field);
          const crop = fieldKey ? doc?.fields[fieldKey].crop : Object.values(doc?.fields ?? {}).find((f) => f.quote === e.quote)?.crop;
          return (
            <figure key={i} className="ev">
              <figcaption>
                <strong>{FIELD_LABEL[e.field] ?? e.field}</strong>
                {e.value != null && <> = {typeof e.value === "number" ? e.value.toLocaleString("th-TH") : e.value}</>}
                {e.method === "ocr" && <span className="tag warn">OCR</span>}
              </figcaption>
              <blockquote>{e.quote}</blockquote>
              {crop && <img src={`data/${crop}`} alt={`ภาพจากไฟล์สแกน: ${e.quote}`} className="crop" />}
              <p className="muted small">
                {e.file} · {e.locator}
              </p>
            </figure>
          );
        })}
      </div>
      {rule && (
        <p className="rule small">
          กฎ {rule.id} จาก {rule.source_doc}: “{rule.source_quote}” {rule.verified ? "✓ ตรวจพบข้อความนี้ในเอกสารนโยบาย" : "⚠ ไม่พบข้อความนี้ในเอกสาร"}
        </p>
      )}
    </div>
  );
}
