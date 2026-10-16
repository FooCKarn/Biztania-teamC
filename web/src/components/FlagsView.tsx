import { useEffect, useMemo, useState } from "react";
import type { ConflictMap, Doc, Flag } from "../types";
import type { Trail } from "../decisions";
import { FIELD_LABEL, MATCH_LABEL, RISK_ORDER, TYPE_LABEL, baht } from "../labels";
import TxnChain from "./TxnChain";
import EvidencePanel from "./EvidencePanel";
import DecisionBox from "./DecisionBox";
import DocViewer, { type Mark } from "./DocViewer";

interface Props {
  data: ConflictMap;
  docs: Map<string, Doc>;
  trail: Trail;
  focusTxn: string | null;
}

const byRisk = (a: Flag, b: Flag) => b.severity - a.severity || (b.at_stake_thb ?? 0) - (a.at_stake_thb ?? 0);
const RISK_KEY: Record<string, string> = { สูง: "high", กลาง: "mid", ต่ำ: "low" };

export default function FlagsView({ data, docs, trail, focusTxn }: Props) {
  const { decisions } = trail;
  const [risk, setRisk] = useState<string>("all");
  const [type, setType] = useState<string>("all");
  const [state, setState] = useState<string>("open");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [txnOnly, setTxnOnly] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [docFocus, setDocFocus] = useState<string | null>(null);

  const select = (id: string) => {
    setSelected(id);
    setTxnOnly(null);
    setPick(null);
    setDocFocus(null);
  };

  useEffect(() => {
    if (!focusTxn) return;
    const first = data.flags.filter((f) => f.transaction === focusTxn).sort(byRisk)[0];
    setSelected(first?.id ?? null);
    setTxnOnly(first ? null : focusTxn);
    setPick(null);
    setDocFocus(first ? null : (data.transactions.find((t) => t.id === focusTxn)?.members[0] ?? null));
    if (first) setState("all");
  }, [focusTxn, data.flags, data.transactions]);

  const byFile = useMemo(() => new Map(data.documents.map((d) => [d.file, d])), [data.documents]);
  const resolve = (id: string) => docs.get(id) ?? byFile.get(id);

  const types = useMemo(() => [...new Set(data.flags.map((f) => f.type))], [data.flags]);
  const q = query.trim().toLowerCase();
  const list = data.flags
    .filter((f) => risk === "all" || f.risk === risk)
    .filter((f) => type === "all" || f.type === type)
    .filter((f) => state === "all" || (state === "open" ? !decisions[f.id] : !!decisions[f.id]))
    .filter((f) => !q || [f.id, f.title, f.summary, ...f.docs].some((s) => s.toLowerCase().includes(q)))
    .sort(byRisk);

  const flag = data.flags.find((f) => f.id === selected) ?? (txnOnly ? undefined : list[0]);
  const txnId = flag?.transaction ?? txnOnly;
  const txn = data.transactions.find((t) => t.id === txnId);

  // j / k (or ↓ / ↑) move through the list, like a mail app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const step = e.key === "j" || e.key === "ArrowDown" ? 1 : e.key === "k" || e.key === "ArrowUp" ? -1 : 0;
      if (!step || !list.length) return;
      e.preventDefault();
      const i = list.findIndex((f) => f.id === flag?.id);
      select(list[Math.min(list.length - 1, Math.max(0, i + step))].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const flagMarks: Mark[] = (flag?.evidence ?? []).map((e, i) => ({
    key: String(i),
    doc: resolve(e.doc)?.id ?? e.doc,
    label: FIELD_LABEL[e.field] ?? e.field,
    value: e.value,
    quote: e.quote,
    locator: e.locator,
    bbox: e.bbox,
    active: false,
  }));
  const activeKey = docFocus
    ? (flagMarks.find((m) => m.doc === docFocus)?.key ?? null)
    : (pick ?? (flagMarks.length ? "0" : null));
  const marks = flagMarks.map((m) => ({ ...m, active: m.key === activeKey }));

  const viewerDoc = docFocus ? docs.get(docFocus) : resolve(marks.find((m) => m.active)?.doc ?? "");
  const viewerMarks: Mark[] = !viewerDoc
    ? []
    : marks.some((m) => m.doc === viewerDoc.id)
      ? marks.filter((m) => resolve(m.doc)?.file === viewerDoc.file)
      : Object.values(viewerDoc.fields).map((f) => ({
          key: "f:" + f.name,
          doc: viewerDoc.id,
          label: FIELD_LABEL[f.name] ?? f.name,
          value: f.value,
          quote: f.quote,
          locator: f.locator,
          bbox: f.bbox,
          active: false,
        }));

  const pickMark = (key: string) => {
    if (key.startsWith("f:")) return;
    setPick(key);
    setDocFocus(null);
  };

  const prepared = data.flags.filter((f) => decisions[f.id]).length;

  return (
    <div className="workspace">
      <aside className="sidebar" aria-label="รายการที่ควรตรวจ">
        <div className="sidebar-head">
          <input
            className="search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหา เลขเอกสาร หรือ ประเด็น"
            aria-label="ค้นหา"
          />
          <div className="segmented small-seg" role="radiogroup" aria-label="สถานะ">
            {[
              ["open", "ยังไม่ลงนาม"],
              ["done", "ลงนามแล้ว"],
              ["all", "ทั้งหมด"],
            ].map(([v, l]) => (
              <button key={v} role="radio" aria-checked={state === v} onClick={() => setState(v)}>
                {l}
              </button>
            ))}
          </div>
          <div className="row">
            <select value={risk} onChange={(e) => setRisk(e.target.value)} aria-label="ระดับความเสี่ยง">
              <option value="all">ทุกระดับความเสี่ยง</option>
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
          </div>
        </div>
        {list.length === 0 && <p className="muted pad small">ไม่มีรายการตามตัวกรองนี้</p>}
        <ul className="flag-list">
          {list.map((f) => {
            const d = decisions[f.id];
            return (
              <li key={f.id}>
                <button className={"flag-row" + (flag?.id === f.id ? " active" : "")} onClick={() => select(f.id)}>
                  <span className={`dot risk-${RISK_KEY[f.risk]}`} aria-label={`เสี่ยง${f.risk}`} />
                  <span className="flag-main">
                    <span className="flag-top">
                      <span className="ref">{f.id}</span>
                      <strong>{f.title}</strong>
                      <span className="amt">{f.at_stake_thb ? baht(f.at_stake_thb) : ""}</span>
                    </span>
                    <span className="flag-sum">{f.summary}</span>
                    <span className="flag-meta">
                      <span className={"so" + (d ? " done" : "")} title="ผู้จัดทำ">
                        P{d ? ` ${d.by ?? "✓"}` : ""}
                      </span>
                      <span className={"so" + (d?.review ? " done" : "")} title="ผู้สอบทาน">
                        R{d?.review ? ` ${d.review.by}` : ""}
                      </span>
                      {f.match === "likely" && <span className="pill warn">{MATCH_LABEL.likely}</span>}
                      {f.ocr && <span className="pill">OCR</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="sidebar-foot muted small">
          ลงนามแล้ว {prepared}/{data.flags.length} · กด J / K เพื่อเลื่อนรายการ
        </p>
      </aside>

      <section className="paper" aria-label="กระดาษทำการ">
        {!flag && !txn && <p className="muted pad">เลือกรายการทางซ้ายเพื่อดูแผนที่และหลักฐาน</p>}
        {flag && (
          <header className="paper-head">
            <div className="row">
              <span className="ref big">{flag.id}</span>
              <span className={`pill risk-${RISK_KEY[flag.risk]}`}>เสี่ยง{flag.risk}</span>
              <span className="pill">{TYPE_LABEL[flag.type] ?? flag.type}</span>
              {!!flag.at_stake_thb && <span className="pill">{baht(flag.at_stake_thb)}</span>}
            </div>
            <h2>{flag.title}</h2>
            <p className="lead">{flag.summary}</p>
            <p className="muted small">
              สถานะ: {flag.status} · ไม่ใช่ข้อสรุปว่าผิด
              {flag.match === "likely" && " · ธุรกรรมนี้จับคู่โดยอนุมาน (ไม่มีเลขอ้างอิงระหว่างเอกสาร) จึงลดระดับความเสี่ยงลงหนึ่งขั้น"}
              {flag.basis && data.rules.some((r) => r.id === flag.basis) && ` · อ้างกฎ ${flag.basis}`}
            </p>
          </header>
        )}
        {txn && (
          <section className="group" aria-label="แผนที่ธุรกรรม">
            <h3 className="group-title">
              แผนที่ธุรกรรม {txn.id.replace(/^T-/, "")} · {MATCH_LABEL[txn.match]}
            </h3>
            <div className="group-body">
              <TxnChain
                txn={txn}
                docs={docs}
                flags={data.flags}
                highlight={flag}
                selectedDoc={viewerDoc?.id}
                onSelect={(id) => {
                  setDocFocus(id);
                  setPick(null);
                }}
              />
            </div>
          </section>
        )}
        {flag && (
          <>
            <EvidencePanel flag={flag} marks={marks} rules={data.rules} activeKey={activeKey} onPick={pickMark} />
            <section className="group" aria-label="คำถามที่ควรถามต่อ">
              <h3 className="group-title">คำถามที่ควรถามต่อ</h3>
              <ul className="group-body questions">
                {flag.questions.map((qq) => (
                  <li key={qq}>{qq}</li>
                ))}
              </ul>
            </section>
            <DecisionBox flagId={flag.id} trail={trail} />
          </>
        )}
      </section>

      <aside className="viewer-pane" aria-label="เอกสารต้นฉบับ">
        {viewerDoc ? (
          <DocViewer
            doc={viewerDoc}
            siblings={data.documents.filter((d) => d.file === viewerDoc.file)}
            marks={viewerMarks}
            onPick={pickMark}
          />
        ) : (
          <p className="muted pad small">เลือกหลักฐานหรือเอกสารในแผนที่เพื่อเปิดต้นฉบับ</p>
        )}
      </aside>
    </div>
  );
}
