import { useEffect, useState } from "react";
import type { Decision } from "../types";
import type { Trail, TrailAction } from "../decisions";
import { ROLE_LABEL } from "../api";

interface Props {
  flagId: string;
  trail: Trail;
}

const INITIALS_KEY = "ac-initials";
const when = (iso: string) => new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
const ACTION_LABEL: Record<string, string> = {
  prepare: "ลงนามผู้จัดทำ",
  review: "ลงนามสอบทาน",
  unreview: "ยกเลิกการสอบทาน",
  reopen: "เปิดแก้ไข",
  pair: "ยืนยันคู่",
};
const VERDICT_LABEL: Record<string, string> = { issue: "เป็นประเด็น", not_issue: "ไม่เป็นประเด็น" };

function loadInitials() {
  try {
    return localStorage.getItem(INITIALS_KEY) ?? "";
  } catch {
    return "";
  }
}

// Professional judgment stays with the auditor. Like a working paper: the preparer signs with a
// verdict and a written reason, then a different person signs it off as reviewed. Every step,
// including edits, is appended to the Audit Trail; nothing is overwritten.
export default function DecisionBox({ flagId, trail }: Props) {
  const decision: Decision | undefined = trail.decisions[flagId];
  const [reason, setReason] = useState("");
  const [initials, setInitials] = useState(loadInitials);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setReason(decision?.reason ?? "");
    setError(null);
  }, [flagId, decision]);
  // Engagement: the account signs. Demo: typed initials.
  const signedIn = !!trail.actor;
  const who = (trail.actor ?? initials).trim().toUpperCase();
  const locked = !!trail.readOnly;
  const canReview = !signedIn || trail.role === "reviewer" || trail.role === "manager";
  const ok = reason.trim().length >= 5 && who.length >= 2 && !busy && trail.mode !== "loading" && !locked;
  const history = trail.events.filter((e) => e.target === flagId);

  const remember = (v: string) => {
    setInitials(v);
    try {
      localStorage.setItem(INITIALS_KEY, v);
    } catch {
      /* storage blocked: initials last for this page view */
    }
  };
  const run = async (a: TrailAction) => {
    setBusy(true);
    setError(await trail.act(a));
    setBusy(false);
  };
  const prepare = (verdict: Decision["verdict"]) => run({ action: "prepare", target: flagId, value: verdict, reason: reason.trim(), actor: who });
  const needWho = () => (who.length >= 2 ? true : (setError("ใส่ชื่อย่อก่อน"), false));
  const samePerson = !!decision?.by && decision.by === who;

  return (
    <section className="group" aria-label="ลงนาม">
      <h3 className="group-title">ลงนามกระดาษทำการ</h3>
      <div className="group-body signoff">
        {signedIn ? (
          <p className="muted small">
            ลงนามในชื่อ <b>{trail.actor}</b> ({ROLE_LABEL[trail.role ?? ""] ?? trail.role}) จากบัญชีที่เข้าสู่ระบบ
            {locked && " · Engagement ปิดแล้ว ดูได้อย่างเดียว"}
          </p>
        ) : (
          <label className="field-row">
            <span>ชื่อย่อของคุณ</span>
            <input value={initials} onChange={(e) => remember(e.target.value)} maxLength={4} placeholder="เช่น SK" aria-label="ชื่อย่อผู้ลงนาม" />
          </label>
        )}

        <div className="step">
          <span className={"step-dot" + (decision ? " done" : "")} aria-hidden>
            {decision ? "✓" : "1"}
          </span>
          <div className="step-main">
            <strong>ผู้จัดทำ (Prepared)</strong>
            {decision ? (
              <p>
                <span className={"pill " + (decision.verdict === "issue" ? "bad" : "ok")}>{VERDICT_LABEL[decision.verdict]}</span>{" "}
                {decision.reason}
                <span className="muted small">
                  {" "}
                  · {decision.by ?? "-"} · {when(decision.at)}
                </span>{" "}
                <button
                  className="link"
                  disabled={busy || locked}
                  onClick={() => needWho() && run({ action: "reopen", target: flagId, actor: who })}
                  title="ประวัติเดิมยังอยู่ใน Audit Trail"
                >
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
                  maxLength={500}
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
                  {!ok && !busy && !locked && (
                    <span className="muted small">{signedIn ? "ใส่เหตุผลอย่างน้อย 5 ตัวอักษร" : "ใส่ชื่อย่อและเหตุผลอย่างน้อย 5 ตัวอักษร"}</span>
                  )}
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
                <button
                  className="link"
                  disabled={busy || locked || !canReview}
                  onClick={() => needWho() && run({ action: "unreview", target: flagId, actor: who })}
                >
                  ยกเลิก
                </button>
              </p>
            ) : decision ? (
              <div className="row">
                <button
                  className="btn filled"
                  disabled={who.length < 2 || samePerson || busy || locked || !canReview}
                  onClick={() => run({ action: "review", target: flagId, actor: who })}
                >
                  ลงนามสอบทาน
                </button>
                {samePerson && <span className="muted small">ผู้สอบทานต้องไม่ใช่คนเดียวกับผู้จัดทำ</span>}
                {!canReview && !samePerson && <span className="muted small">ต้องเป็นผู้สอบทานหรือ Manager ของ Engagement นี้</span>}
              </div>
            ) : (
              <p className="muted small">รอผู้จัดทำลงนามก่อน</p>
            )}
          </div>
        </div>
        {error && (
          <p className="small error" role="alert">
            {error}
          </p>
        )}

        {history.length > 0 && (
          <details className="trail">
            <summary>ประวัติ Audit Trail ({history.length})</summary>
            <ol>
              {history.map((e) => (
                <li key={e.seq}>
                  <span className="muted small">
                    #{e.seq} · {when(e.at)} · {e.actor}
                  </span>{" "}
                  {ACTION_LABEL[e.action] ?? e.action}
                  {e.value && e.action === "prepare" && ` · ${VERDICT_LABEL[e.value] ?? e.value}`}
                  {e.reason && ` · ${e.reason}`}
                  {e.hash && (
                    <span className="muted small mono" title={`หลักฐาน: ${e.evidence.map((x) => `${x.doc}${x.locator ? ` (${x.locator})` : ""}`).join(", ")}`}>
                      {" "}
                      · {e.hash.slice(0, 8)}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </details>
        )}
        <p className="muted small">
          {trail.mode === "server"
            ? `บันทึกเป็น Audit Trail บน server (เพิ่มได้อย่างเดียว แก้หรือลบไม่ได้) · ${
                trail.chainOk ? "สายแฮชครบ ไม่ถูกแก้ไข" : "สายแฮชไม่ตรง ควรตรวจว่ามีการแก้ข้อมูล"
              }${trail.actor ? "" : ` · workspace ${trail.workspace}`}`
            : trail.mode === "local"
              ? "เดโม: ยังไม่ได้เชื่อมฐานข้อมูล จึงบันทึกไว้ในเบราว์เซอร์นี้เท่านั้น"
              : "กำลังโหลด Audit Trail…"}
        </p>
      </div>
    </section>
  );
}
