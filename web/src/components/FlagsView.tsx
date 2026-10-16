import { useEffect, useMemo, useState } from "react";
import type { ConflictMap, Decision, Doc, Flag } from "../types";
import { MATCH_LABEL, RISK_ORDER, TYPE_LABEL, baht } from "../labels";
import TxnChain from "./TxnChain";
import EvidencePanel from "./EvidencePanel";
import DecisionBox from "./DecisionBox";
import DocCard from "./DocCard";

interface Props {
  data: ConflictMap;
  docs: Map<string, Doc>;
  decisions: Record<string, Decision>;
  decide: (id: string, d: Decision | null) => void;
  focusTxn: string | null;
}

const byRisk = (a: Flag, b: Flag) => b.severity - a.severity || (b.at_stake_thb ?? 0) - (a.at_stake_thb ?? 0);

export default function FlagsView({ data, docs, decisions, decide, focusTxn }: Props) {
  const [risk, setRisk] = useState<string>("all");
  const [type, setType] = useState<string>("all");
  const [state, setState] = useState<string>("open");
  const [selected, setSelected] = useState<string | null>(null);
  const [txnOnly, setTxnOnly] = useState<string | null>(null);
  const [doc, setDoc] = useState<string | null>(null);

  useEffect(() => {
    if (!focusTxn) return;
    const first = data.flags.filter((f) => f.transaction === focusTxn).sort(byRisk)[0];
    setSelected(first?.id ?? null);
    setTxnOnly(first ? null : focusTxn);
    setDoc(null);
  }, [focusTxn, data.flags]);

  const types = useMemo(() => [...new Set(data.flags.map((f) => f.type))], [data.flags]);
  const list = data.flags
    .filter((f) => risk === "all" || f.risk === risk)
    .filter((f) => type === "all" || f.type === type)
    .filter((f) => state === "all" || (state === "open" ? !decisions[f.id] : !!decisions[f.id]))
    .sort(byRisk);

  const flag = data.flags.find((f) => f.id === selected) ?? (txnOnly ? undefined : list[0]);
  const txnId = flag?.transaction ?? txnOnly;
  const txn = data.transactions.find((t) => t.id === txnId);

  return (
    <div className="split">
      <section className="list" aria-label="รายการที่ควรตรวจ">
        <div className="filters">
          <select value={risk} onChange={(e) => setRisk(e.target.value)} aria-label="ระดับความเสี่ยง">
            <option value="all">ทุกระดับ</option>
            {RISK_ORDER.map((r) => (
              <option key={r} value={r}>
                เสี่ยง{r}
              </option>
            ))}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="ประเภท">
            <option value="all">ทุกประเภท</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t] ?? t}
              </option>
            ))}
          </select>
          <select value={state} onChange={(e) => setState(e.target.value)} aria-label="สถานะ">
            <option value="open">ยังไม่ตัดสิน</option>
            <option value="done">ตัดสินแล้ว</option>
            <option value="all">ทั้งหมด</option>
          </select>
        </div>
        {list.length === 0 && <p className="muted pad">ไม่มีรายการตามตัวกรองนี้</p>}
        <ul>
          {list.map((f) => (
            <li key={f.id}>
              <button
                className={"flag-row" + (flag?.id === f.id ? " active" : "")}
                onClick={() => {
                  setSelected(f.id);
                  setTxnOnly(null);
                  setDoc(null);
                }}
              >
                <span className={`risk risk-${f.risk}`}>{f.risk}</span>
                <span className="flag-main">
                  <strong>{f.title}</strong>
                  <span className="muted small">{f.summary}</span>
                  <span className="tags">
                    {f.match === "likely" && <span className="tag warn">{MATCH_LABEL.likely}</span>}
                    {f.ocr && <span className="tag">มีข้อมูลจาก OCR</span>}
                    {!!f.at_stake_thb && <span className="tag">{baht(f.at_stake_thb)}</span>}
                    {decisions[f.id] && (
                      <span className="tag ok">
                        {decisions[f.id].verdict === "issue" ? "เป็นประเด็น" : "ไม่เป็นประเด็น"}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="detail" aria-label="รายละเอียด">
        {!flag && !txn && <p className="muted pad">เลือกรายการทางซ้ายเพื่อดูแผนที่และหลักฐาน</p>}
        {flag && (
          <>
            <div className="detail-head">
              <span className={`risk risk-${flag.risk}`}>เสี่ยง{flag.risk}</span>
              <h2>{flag.title}</h2>
              <p>{flag.summary}</p>
              <p className="muted small">
                สถานะ: {flag.status} · ไม่ใช่ข้อสรุปว่าผิด
                {flag.match === "likely" && " · ธุรกรรมนี้จับคู่โดยอนุมาน (ไม่มีเลขอ้างอิงระหว่างเอกสาร) จึงลดระดับความเสี่ยงลงหนึ่งขั้น"}
                {flag.basis && data.rules.some((r) => r.id === flag.basis) && ` · อ้างกฎ ${flag.basis}`}
              </p>
            </div>
          </>
        )}
        {txn && (
          <div className="card">
            <h3>
              แผนที่ธุรกรรม {txn.id.replace(/^T-/, "")}{" "}
              <span className="muted small">({MATCH_LABEL[txn.match]})</span>
            </h3>
            <TxnChain txn={txn} docs={docs} flags={data.flags} highlight={flag} selectedDoc={doc} onSelect={setDoc} />
          </div>
        )}
        {doc && docs.get(doc) && <DocCard doc={docs.get(doc)!} onClose={() => setDoc(null)} />}
        {flag && (
          <>
            <EvidencePanel flag={flag} docs={docs} rules={data.rules} />
            <div className="card">
              <h3>คำถามที่ควรถามต่อ</h3>
              <ul className="questions">
                {flag.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
            <DecisionBox flagId={flag.id} decision={decisions[flag.id]} decide={decide} />
          </>
        )}
      </section>
    </div>
  );
}
