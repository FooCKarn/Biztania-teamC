import { useEffect, useState } from "react";
import type { Decision } from "../types";
import type { Trail, TrailAction } from "../decisions";
import { ROLE_LABEL, when } from "../api";
import { bi, t } from "../i18n";

interface Props {
  flagId: string;
  trail: Trail;
}

const INITIALS_KEY = "ac-initials";
const ACTION_LABEL: Record<string, string> = bi({
  prepare: ["ลงนามผู้จัดทำ", "Signed as preparer"],
  review: ["ลงนามสอบทาน", "Signed off review"],
  unreview: ["ยกเลิกการสอบทาน", "Withdrew review"],
  reopen: ["เปิดแก้ไข", "Reopened"],
  pair: ["ยืนยันคู่", "Confirmed pair"],
});
const VERDICT_LABEL: Record<string, string> = bi({ issue: ["เป็นประเด็น", "Issue"], not_issue: ["ไม่เป็นประเด็น", "Not an issue"] });

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
  const needWho = () => (who.length >= 2 ? true : (setError(t("ใส่ชื่อย่อก่อน", "Enter your initials first")), false));
  const samePerson = !!decision?.by && decision.by === who;

  return (
    <section className="group" aria-label={t("ลงนาม", "Sign-off")}>
      <h3 className="group-title">{t("ลงนามกระดาษทำการ", "Working paper sign-off")}</h3>
      <div className="group-body signoff">
        {signedIn ? (
          <p className="muted small">
            {t("ลงนามในชื่อ", "Signing as")} <b>{trail.actor}</b> ({ROLE_LABEL[trail.role ?? ""] ?? trail.role}){" "}
            {t("จากบัญชีที่เข้าสู่ระบบ", "from the signed-in account")}
            {locked && ` · ${t("Engagement ปิดแล้ว ดูได้อย่างเดียว", "Engagement closed, read only")}`}
          </p>
        ) : (
          <label className="field-row">
            <span>{t("ชื่อย่อของคุณ", "Your initials")}</span>
            <input
              value={initials}
              onChange={(e) => remember(e.target.value)}
              maxLength={4}
              placeholder={t("เช่น SK", "e.g. SK")}
              aria-label={t("ชื่อย่อผู้ลงนาม", "Signer initials")}
            />
          </label>
        )}

        <div className="step">
          <span className={"step-dot" + (decision ? " done" : "")} aria-hidden>
            {decision ? "✓" : "1"}
          </span>
          <div className="step-main">
            <strong>{t("ผู้จัดทำ (Prepared)", "Prepared")}</strong>
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
                  title={t("ประวัติเดิมยังอยู่ใน Audit Trail", "The earlier history stays in the Audit Trail")}
                >
                  {t("แก้ไข", "Edit")}
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
                  aria-label={t("เหตุผล", "Reason")}
                  placeholder={t(
                    "เหตุผล (จำเป็น) เช่น ได้รับหนังสือแจ้งเปลี่ยนบัญชีจาก vendor ลงวันที่ …",
                    "Reason (required), e.g. received the vendor's bank change letter dated …",
                  )}
                />
                <div className="row">
                  <button className="btn destructive" disabled={!ok} onClick={() => prepare("issue")}>
                    {VERDICT_LABEL.issue}
                  </button>
                  <button className="btn" disabled={!ok} onClick={() => prepare("not_issue")}>
                    {VERDICT_LABEL.not_issue}
                  </button>
                  {!ok && !busy && !locked && (
                    <span className="muted small">{signedIn
                        ? t("ใส่เหตุผลอย่างน้อย 5 ตัวอักษร", "Enter a reason of at least 5 characters")
                        : t("ใส่ชื่อย่อและเหตุผลอย่างน้อย 5 ตัวอักษร", "Enter your initials and a reason of at least 5 characters")}</span>
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
            <strong>{t("ผู้สอบทาน (Reviewed)", "Reviewed")}</strong>
            {decision?.review ? (
              <p>
                {t("สอบทานแล้ว", "Reviewed")}
                <span className="muted small">
                  {" "}
                  · {decision.review.by} · {when(decision.review.at)}
                </span>{" "}
                <button
                  className="link"
                  disabled={busy || locked || !canReview}
                  onClick={() => needWho() && run({ action: "unreview", target: flagId, actor: who })}
                >
                  {t("ยกเลิก", "Withdraw")}
                </button>
              </p>
            ) : decision ? (
              <div className="row">
                <button
                  className="btn filled"
                  disabled={who.length < 2 || samePerson || busy || locked || !canReview}
                  onClick={() => run({ action: "review", target: flagId, actor: who })}
                >
                  {t("ลงนามสอบทาน", "Sign off review")}
                </button>
                {samePerson && <span className="muted small">{t("ผู้สอบทานต้องไม่ใช่คนเดียวกับผู้จัดทำ", "The reviewer must not be the preparer")}</span>}
                {!canReview && !samePerson && (
                  <span className="muted small">{t("ต้องเป็นผู้สอบทานหรือ Manager ของ Engagement นี้", "Only this engagement's reviewer or manager can sign")}</span>
                )}
              </div>
            ) : (
              <p className="muted small">{t("รอผู้จัดทำลงนามก่อน", "Waiting for the preparer to sign")}</p>
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
            <summary>
              {t("ประวัติ Audit Trail", "Audit Trail history")} ({history.length})
            </summary>
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
                    <span className="muted small mono" title={`${t("หลักฐาน", "Evidence")}: ${e.evidence.map((x) => `${x.doc}${x.locator ? ` (${x.locator})` : ""}`).join(", ")}`}>
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
            ? `${t("บันทึกเป็น Audit Trail บน server (เพิ่มได้อย่างเดียว แก้หรือลบไม่ได้)", "Recorded in the server Audit Trail (append-only)")} · ${
                trail.chainOk
                  ? t("สายแฮชครบ ไม่ถูกแก้ไข", "hash chain intact")
                  : t("สายแฮชไม่ตรง ควรตรวจว่ามีการแก้ข้อมูล", "hash chain broken, check whether data was altered")
              }${trail.actor ? "" : ` · workspace ${trail.workspace}`}`
            : trail.mode === "local"
              ? t("เดโม: ยังไม่ได้เชื่อมฐานข้อมูล จึงบันทึกไว้ในเบราว์เซอร์นี้เท่านั้น", "Demo: no database connected, so this is kept in this browser only")
              : t("กำลังโหลด Audit Trail…", "Loading Audit Trail…")}
        </p>
      </div>
    </section>
  );
}
