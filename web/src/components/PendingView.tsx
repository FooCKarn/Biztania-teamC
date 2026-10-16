import { useState } from "react";
import type { Trail } from "../decisions";
import type { ConflictMap, Doc } from "../types";
import { FIELD_LABEL, KIND_LABEL } from "../labels";

const SHOW = ["date", "vendor_name", "description", "subtotal", "amount", "total"];

function Facts({ doc }: { doc: Doc }) {
  return (
    <dl className="facts">
      {SHOW.filter((k) => doc.fields[k]).map((k) => (
        <div key={k}>
          <dt>{FIELD_LABEL[k] ?? k}</dt>
          <dd>{typeof doc.fields[k].value === "number" ? doc.fields[k].value!.toLocaleString("th-TH") : String(doc.fields[k].value)}</dd>
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
    if (actor.length < 2) return setError("ใส่ชื่อย่อในช่องลงนามของหน้า ควรตรวจ ก่อนยืนยันคู่");
    setError(await trail.act({ action: "pair", target: `pair:${doc}`, value: cand, actor }));
  };

  if (!data.pending.length) return <p className="muted pad">ไม่มีเอกสารที่รอจับคู่</p>;
  return (
    <div className="stack">
      <p className="muted">
        เอกสารที่ระบบไม่แน่ใจว่าคู่กับเอกสารใด จะ<strong>ยังไม่ถูกนำไปตรวจขัดแย้ง</strong>จนกว่าผู้สอบบัญชีจะยืนยันคู่
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
                <p className="small muted">เอกสารนี้</p>
                {doc && <Facts doc={doc} />}
              </div>
              {p.candidates.map((c) => {
                const cd = docs.get(c);
                return (
                  <div key={c} className={"cand" + (picked[p.doc] === c ? " chosen" : "")}>
                    <p className="small muted">
                      ตัวเลือก: {cd ? KIND_LABEL[cd.kind] : ""} {c}
                    </p>
                    {cd && <Facts doc={cd} />}
                    <button className="btn" onClick={() => pick(p.doc, c)} aria-pressed={picked[p.doc] === c}>
                      {picked[p.doc] === c ? "เลือกแล้ว" : "ยืนยันคู่นี้"}
                    </button>
                  </div>
                );
              })}
            </div>
            {picked[p.doc] && (
              <p className="small muted">
                บันทึกคู่ {p.doc} ↔ {picked[p.doc]} ไว้ใน Audit Trail {trail.mode === "server" ? "บน server" : "ของเบราว์เซอร์นี้"} แล้ว
                ระบบจริงจะรันตรวจขัดแย้งของคู่นี้ใหม่ทันที
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
