import { useEffect, useState } from "react";
import type { Decision } from "../types";

interface Props {
  flagId: string;
  decision?: Decision;
  decide: (id: string, d: Decision | null) => void;
}

// Professional judgment stays with the auditor: a verdict needs a written reason.
export default function DecisionBox({ flagId, decision, decide }: Props) {
  const [reason, setReason] = useState("");
  useEffect(() => setReason(decision?.reason ?? ""), [flagId, decision]);
  const ok = reason.trim().length >= 5;

  const save = (verdict: Decision["verdict"]) => decide(flagId, { verdict, reason: reason.trim(), at: new Date().toISOString() });

  return (
    <div className="card decision">
      <h3>การตัดสินของผู้สอบบัญชี</h3>
      {decision ? (
        <p>
          <strong>{decision.verdict === "issue" ? "เป็นประเด็น" : "ไม่เป็นประเด็น"}</strong> · {decision.reason}
          <span className="muted small"> ({new Date(decision.at).toLocaleString("th-TH")})</span>{" "}
          <button className="link" onClick={() => decide(flagId, null)}>
            แก้ไข
          </button>
        </p>
      ) : (
        <>
          <label className="small muted" htmlFor={`reason-${flagId}`}>
            เหตุผล (จำเป็น อย่างน้อย 5 ตัวอักษร)
          </label>
          <textarea
            id={`reason-${flagId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="เช่น ได้รับหนังสือแจ้งเปลี่ยนบัญชีจาก vendor ลงวันที่ …"
          />
          <div className="row">
            <button className="btn danger" disabled={!ok} onClick={() => save("issue")}>
              เป็นประเด็น
            </button>
            <button className="btn" disabled={!ok} onClick={() => save("not_issue")}>
              ไม่เป็นประเด็น
            </button>
          </div>
        </>
      )}
      <p className="muted small">เดโม: บันทึกไว้ในเบราว์เซอร์นี้เท่านั้น ระบบจริงจะเก็บเป็น Audit Trail</p>
    </div>
  );
}
