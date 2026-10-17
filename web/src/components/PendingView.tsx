import { useState } from "react";
import type { Trail } from "../decisions";
import type { ConflictMap, Doc } from "../types";
import { fieldLabel, KIND_LABEL } from "../labels";
import { locale, t } from "../i18n";

const SHOW = ["date", "vendor_name", "description", "subtotal", "amount", "total"];

function Facts({ doc }: { doc: Doc }) {
  return (
    <dl className="facts">
      {SHOW.filter((k) => doc.fields[k]).map((k) => (
        <div key={k}>
          <dt>{fieldLabel(k)}</dt>
          <dd>{typeof doc.fields[k].value === "number" ? doc.fields[k].value!.toLocaleString(locale()) : String(doc.fields[k].value)}</dd>
        </div>
      ))}
    </dl>
  );
}

// Documents whose partner is ambiguous are NOT checked for conflicts until the auditor
// confirms the pair; guessing would create false flags or hide real ones.
export default function PendingView({ data, docs, trail }: { data: ConflictMap; docs: Map<string, Doc>; trail: Trail }) {
  const picked = trail.pairs;
  const [error, setError] = useState<string | null>(null);
  const pick = async (doc: string, cand: string) => {
    let actor = trail.actor ?? "";
    if (!actor) {
      try {
        actor = (localStorage.getItem("ac-initials") ?? "").trim().toUpperCase();
      } catch {
        /* ignore */
      }
    }
    if (actor.length < 2) return setError(t("ใส่ชื่อย่อในช่องลงนามของหน้า ควรตรวจ ก่อนยืนยันคู่", "Enter your initials in the sign-off box on the To check tab before confirming a pair"));
    setError(await trail.act({ action: "pair", target: `pair:${doc}`, value: cand, actor }));
  };

  if (!data.pending.length) return <p className="muted pad">{t("ไม่มีเอกสารที่รอจับคู่", "No documents awaiting a match")}</p>;
  return (
    <div className="stack">
      <p className="muted">
        {t("เอกสารที่ระบบไม่แน่ใจว่าคู่กับเอกสารใด จะ", "Documents whose partner is unclear are ")}
        <strong>{t("ยังไม่ถูกนำไปตรวจขัดแย้ง", "not checked for conflicts")}</strong>
        {t("จนกว่าผู้สอบบัญชีจะยืนยันคู่", " until the auditor confirms the pair.")}
      </p>
      {error && (
        <p className="small error" role="alert">
          {error}
        </p>
      )}
      {data.pending.map((p) => {
        const doc = docs.get(p.doc);
        return (
          <div key={p.doc} className="card">
            <h3>
              {KIND_LABEL[p.kind]} {p.doc}
            </h3>
            <p>{p.why}</p>
            <div className="pending-grid">
              <div className="cand self">
                <p className="small muted">{t("เอกสารนี้", "This document")}</p>
                {doc && <Facts doc={doc} />}
              </div>
              {p.candidates.map((c) => {
                const cd = docs.get(c);
                return (
                  <div key={c} className={"cand" + (picked[p.doc] === c ? " chosen" : "")}>
                    <p className="small muted">
                      {t("ตัวเลือก", "Candidate")}: {cd ? KIND_LABEL[cd.kind] : ""} {c}
                    </p>
                    {cd && <Facts doc={cd} />}
                    <button className="btn" onClick={() => pick(p.doc, c)} aria-pressed={picked[p.doc] === c}>
                      {picked[p.doc] === c ? t("เลือกแล้ว", "Chosen") : t("ยืนยันคู่นี้", "Confirm this pair")}
                    </button>
                  </div>
                );
              })}
            </div>
            {picked[p.doc] && (
              <p className="small muted">
                {t("บันทึกคู่", "Recorded pair")} {p.doc} ↔ {picked[p.doc]}{" "}
                {trail.mode === "server"
                  ? t("ไว้ใน Audit Trail บน server แล้ว", "in the server Audit Trail.")
                  : t("ไว้ใน Audit Trail ของเบราว์เซอร์นี้แล้ว", "in this browser's Audit Trail.")}{" "}
                {t("ระบบจริงจะรันตรวจขัดแย้งของคู่นี้ใหม่ทันที", "The full system re-checks this pair for conflicts right away.")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
