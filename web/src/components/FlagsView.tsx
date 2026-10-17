import { setAskFlag } from "../askContext";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ConflictMap, Doc, Flag } from "../types";
import type { Trail } from "../decisions";
import { fieldLabel, MATCH_LABEL, RISK_ORDER, TYPE_LABEL, baht, riskText } from "../labels";
import { t } from "../i18n";
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

  // After a check, move on to the highest-risk item still open instead of leaving a finished one on screen.
  const decidedBefore = useRef<Set<string> | null>(null);
  const flag = data.flags.find((f) => f.id === selected) ?? (txnOnly ? undefined : list[0]);
  const txnId = flag?.transaction ?? txnOnly;
  const txn = data.transactions.find((t) => t.id === txnId);

  const flagId = flag?.id;
  useEffect(() => {
    setAskFlag(flag ? { id: flag.id, title: flag.title, questions: flag.questions } : null);
    return () => setAskFlag(null);
  }, [flagId]);

  useEffect(() => {
    const now = new Set(data.flags.filter((f) => decisions[f.id]).map((f) => f.id));
    const justChecked = flag && now.has(flag.id) && decidedBefore.current && !decidedBefore.current.has(flag.id);
    decidedBefore.current = now;
    if (justChecked && state === "open" && list[0] && list[0].id !== flag.id) select(list[0].id);
  });

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
    label: fieldLabel(e.field),
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
          label: fieldLabel(f.name),
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

  const highOpen = data.flags.filter((f) => f.risk === "สูง" && !decisions[f.id]).length;
  const atStake = list.reduce((s, f) => s + (f.at_stake_thb ?? 0), 0);
  const checkedCount = data.flags.filter((f) => decisions[f.id]).length;

  return (
    <div className="workspace">
      <aside className="sidebar" aria-label={t("รายการที่ควรตรวจ", "Items to check")}>
        <div className="sidebar-head">
          <input
            className="search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("ค้นหา เลขเอกสาร หรือ ประเด็น", "Search document no. or issue")}
            aria-label={t("ค้นหา", "Search")}
          />
          <div className="segmented small-seg" role="radiogroup" aria-label={t("สถานะ", "Status")}>
            {[
              ["open", t("ยังไม่ตรวจ", "Open")],
              ["done", t("ตรวจแล้ว", "Checked")],
              ["all", t("ทั้งหมด", "All")],
            ].map(([v, l]) => (
              <button key={v} role="radio" aria-checked={state === v} onClick={() => setState(v)}>
                {l}
              </button>
            ))}
          </div>
          <div className="row">
            <select value={risk} onChange={(e) => setRisk(e.target.value)} aria-label={t("ระดับความเสี่ยง", "Risk level")}>
              <option value="all">{t("ทุกระดับความเสี่ยง", "All risk levels")}</option>
              {RISK_ORDER.map((r) => (
                <option key={r} value={r}>
                  {riskText(r)}
                </option>
              ))}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t("ประเภท", "Type")}>
              <option value="all">{t("ทุกประเภท", "All types")}</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t] ?? t}
                </option>
              ))}
            </select>
          </div>
        </div>
        {list.length === 0 && <p className="muted pad small">{t("ไม่มีรายการตามตัวกรองนี้", "Nothing matches these filters")}</p>}
        <ul className="flag-list">
          {list.map((f) => {
            const d = decisions[f.id];
            return (
              <li key={f.id}>
                <button className={"flag-row" + (flag?.id === f.id ? " active" : "")} onClick={() => select(f.id)} aria-current={flag?.id === f.id ? "true" : undefined}>
                  <span className={`dot risk-${RISK_KEY[f.risk]}`} role="img" aria-label={riskText(f.risk)} />
                  <span className="flag-main">
                    <span className="flag-top">
                      <span className="ref">{f.id}</span>
                      <strong>{f.title}</strong>
                      <span className="amt">{f.at_stake_thb ? baht(f.at_stake_thb) : ""}</span>
                    </span>
                    <span className="flag-sum">{f.summary}</span>
                    <span className="flag-meta">
                      <span className={"so" + (d ? " done" : "")} title={t("ตรวจสอบแล้ว", "Checked")}>
                        ✓{d ? ` ${d.by ?? ""} · ${d.verdict === "issue" ? t("เป็นประเด็น", "Issue") : t("ไม่เป็นประเด็น", "Not an issue")}` : ""}
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
          {t("ตรวจสอบแล้ว", "Checked")} {checkedCount}/{data.flags.length} · {t("ความเสี่ยงสูงที่ยังไม่ตรวจ", "High risk still open")} {highOpen} ·{" "}
          {t("ยอดที่เกี่ยวข้องในรายการ", "At stake in list")} {baht(atStake)} · {t("กด", "Press")} <kbd>J</kbd> / <kbd>K</kbd>{" "}
          {t("เพื่อเลื่อนรายการ", "to move through the list")}
        </p>
      </aside>

      <section className="paper" aria-label={t("กระดาษทำการ", "Working paper")}>
        {!flag && !txn && <p className="muted pad">{t("เลือกรายการทางซ้ายเพื่อดูแผนที่และหลักฐาน", "Pick an item on the left to see its map and evidence")}</p>}
        {flag && (
          <header className="paper-head">
            <div className="row">
              <span className="ref big">{flag.id}</span>
              <span className={`pill risk-${RISK_KEY[flag.risk]}`}>{riskText(flag.risk)}</span>
              <span className="pill">{TYPE_LABEL[flag.type] ?? flag.type}</span>
              {!!flag.at_stake_thb && <span className="pill">{baht(flag.at_stake_thb)}</span>}
            </div>
            <h2>{flag.title}</h2>
            <p className="lead">{flag.summary}</p>
            <p className="muted small">
              {t("สถานะ", "Status")}: {flag.status === "ควรตรวจ" ? t("ควรตรวจ", "to check") : flag.status} · {t("ไม่ใช่ข้อสรุปว่าผิด", "not a conclusion that anything is wrong")}
              {flag.match === "likely" &&
                ` · ${t(
                  "ธุรกรรมนี้จับคู่โดยอนุมาน (ไม่มีเลขอ้างอิงระหว่างเอกสาร) จึงลดระดับความเสี่ยงลงหนึ่งขั้น",
                  "this transaction was matched by inference (no cross-reference between documents), so the risk is lowered one level",
                )}`}
              {flag.basis && data.rules.some((r) => r.id === flag.basis) && ` · ${t("อ้างกฎ", "rule")} ${flag.basis}`}
            </p>
          </header>
        )}
        {txn && (
          <section className="group" aria-label={t("แผนที่ธุรกรรม", "Transaction map")}>
            <h3 className="group-title">
              {t("แผนที่ธุรกรรม", "Transaction map")} {txn.id.replace(/^T-/, "")} · {MATCH_LABEL[txn.match]}
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
            <DecisionBox flagId={flag.id} trail={trail} />
          </>
        )}
      </section>

      <aside className="viewer-pane" aria-label={t("เอกสารต้นฉบับ", "Source document")}>
        {viewerDoc ? (
          <DocViewer
            doc={viewerDoc}
            siblings={data.documents.filter((d) => d.file === viewerDoc.file)}
            marks={viewerMarks}
            onPick={pickMark}
          />
        ) : (
          <p className="muted pad small">{t("เลือกหลักฐานหรือเอกสารในแผนที่เพื่อเปิดต้นฉบับ", "Pick evidence or a document on the map to open the source")}</p>
        )}
      </aside>
    </div>
  );
}
