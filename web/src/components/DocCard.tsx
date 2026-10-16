import type { Doc } from "../types";
import { FIELD_LABEL, KIND_LABEL, MATCH_LABEL } from "../labels";

export default function DocCard({ doc, onClose }: { doc: Doc; onClose?: () => void }) {
  return (
    <div className="card">
      <div className="row between">
        <h3>
          {KIND_LABEL[doc.kind]} {doc.id}
        </h3>
        {onClose && (
          <button className="link" onClick={onClose} aria-label="ปิด">
            ปิด
          </button>
        )}
      </div>
      <p className="muted small">
        {doc.file} · sha256 {doc.sha256.slice(0, 12)}…{doc.vendor && ` · vendor ${doc.vendor} (${doc.vendor_how})`}
      </p>
      {doc.link && (
        <p className="small">
          {MATCH_LABEL[doc.link.level]}: {doc.link.why}
        </p>
      )}
      <table className="fields">
        <tbody>
          {Object.values(doc.fields).map((f) => (
            <tr key={f.name} className={f.clear ? "" : "unclear"}>
              <th>{FIELD_LABEL[f.name] ?? f.name}</th>
              <td>
                {String(f.value)}
                {!f.clear && <span className="tag warn">อ่านไม่ชัด ไม่นำไปใช้ตรวจ</span>}
                {!f.verified && <span className="tag warn">ไม่พบข้อความต้นฉบับ</span>}
                {f.crop && <img src={`data/${f.crop}`} alt={`ภาพจากไฟล์สแกน: ${f.quote}`} className="crop" />}
              </td>
              <td className="muted small">{f.locator}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
