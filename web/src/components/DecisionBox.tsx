import { useEffect, useState } from "react";
import type { Decision } from "../types";

interface Props {
  flagId: string;
  decision?: Decision;
  decide: (id: string, d: Decision | null) => void;
}

const INITIALS_KEY = "ac-initials";
const when = (iso: string) => new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });

function loadInitials() {
  try {
    return localStorage.getItem(INITIALS_KEY) ?? "";
  } catch {
    return "";
  }
}

// Professional judgment stays with the auditor. Like a working paper: the preparer signs with a
// verdict and a written reason, then a different person signs it off as reviewed.
export default function DecisionBox({ flagId, decision, decide }: Props) {
  const [reason, setReason] = useState("");
  const [initials, setInitials] = useState(loadInitials);
  useEffect(() => setReason(decision?.reason ?? ""), [flagId, decision]);
  const who = initials.trim().toUpperCase();
  const ok = reason.trim().length >= 5 && who.length >= 2;

  const remember = (v: string) => {
    setInitials(v);
    try {
      localStorage.setItem(INITIALS_KEY, v);
    } catch {
      /* storage blocked: initials last for this page view */
    }
  };
  const prepare = (verdict: Decision["verdict"]) =>
    decide(flagId, { verdict, reason: reason.trim(), at: new Date().toISOString(), by: who });
  const review = () => decision && decide(flagId, { ...decision, review: { by: who, at: new Date().toISOString() } });
  const samePerson = !!decision?.by && decision.by === who;

  return (
    <section className="group" aria-label="ลงนาม">
      <h3 className="group-title">ลงนามกระดาษทำการ</h3>
      <div className="group-body signoff">
        <label className="field-row">
          <span>ชื่อย่อของคุณ</span>
          <input value={initials} onChange={(e) => remember(e.target.value)} maxLength={4} placeholder="เช่น SK" aria-label="ชื่อย่อผู้ลงนาม" />
        </label>

        <div className="step">
          <span className={"step-dot" + (decision ? " done" : "")} aria-hidden>
            {decision ? "✓" : "1"}
          </span>
          <div className="step-main">
            <strong>ผู้จัดทำ (Prepared)</strong>
            {decision ? (
              <p>
                <span className={"pill " + (decision.verdict === "issue" ? "bad" : "ok")}>
                  {decision.verdict === "issue" ? "เป็นประเด็น" : "ไม่เป็นประเด็น"}
                </span>{" "}
                {decision.reason}
                <span className="muted small">
                  {" "}
                  · {decision.by ?? "-"} · {when(decision.at)}
                </span>{" "}
                <button className="link" onClick={() => decide(flagId, null)}>
                  แก้ไข
                </button>
              </p>
            ) : (
              <>
                <textarea
                  id={`reason-${flagId}`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  aria-label="เหตุผล"
                  placeholder="เหตุผล (จำเป็น) เช่น ได้รับหนังสือแจ้งเปลี่ยนบัญชีจาก vendor ลงวันที่ …"
                />
                <div className="row">
                  <button className="btn destructive" disabled={!ok} onClick={() => prepare("issue")}>
                    เป็นประเด็น
                  </button>
                  <button className="btn" disabled={!ok} onClick={() => prepare("not_issue")}>
                    ไม่เป็นประเด็น
                  </button>
                  {!ok && <span className="muted small">ใส่ชื่อย่อและเหตุผลอย่างน้อย 5 ตัวอักษร</span>}
                </div>
              </>
            )}
          </div>
        </div>

        <div className={"step" + (decision ? "" : " disabled")}>
          <span className={"step-dot" + (decision?.review ? " done" : "")} aria-hidden>
            {decision?.review ? "✓" : "2"}
          </span>
          <div className="step-main">
            <strong>ผู้สอบทาน (Reviewed)</strong>
            {decision?.review ? (
              <p>
                สอบทานแล้ว
                <span className="muted small">
                  {" "}
                  · {decision.review.by} · {when(decision.review.at)}
                </span>{" "}
                <button className="link" onClick={() => decide(flagId, { ...decision, review: undefined })}>
                  ยกเลิก
                </button>
              </p>
            ) : decision ? (
              <div className="row">
                <button className="btn filled" disabled={who.length < 2 || samePerson} onClick={review}>
                  ลงนามสอบทาน
                </button>
                {samePerson && <span className="muted small">ผู้สอบทานต้องไม่ใช่คนเดียวกับผู้จัดทำ</span>}
              </div>
            ) : (
              <p className="muted small">รอผู้จัดทำลงนามก่อน</p>
            )}
          </div>
        </div>
        <p className="muted small">เดโม: บันทึกไว้ในเบราว์เซอร์นี้เท่านั้น ระบบจริงจะเก็บเป็น Audit Trail</p>
      </div>
    </section>
  );
}
