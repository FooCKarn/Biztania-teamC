import ReadProblems from "./components/ReadProblems";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ConflictMap } from "./types";
import { SourceContext, type Source } from "./source";
import { useTrail } from "./decisions";
import FlagsView from "./components/FlagsView";
import PendingView from "./components/PendingView";
import OverviewView from "./components/OverviewView";
import AskBox from "./components/AskBox";
import SignoffBar from "./components/SignoffBar";
import ReportView from "./report/ReportView";
import { exportTrailCsv } from "./export";
import { LangToggle, t } from "./i18n";
import { amount } from "./labels";
import Loading from "./components/Loading";

type Tab = "flags" | "pending" | "overview" | "report";

// The three-pane review workspace for one set of results: the public demo or an engagement's latest run.
export default function Workspace({ source, back }: { source: Source; back?: ReactNode }) {
  const [data, setData] = useState<ConflictMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("flags");
  const [focusTxn, setFocusTxn] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    fetch(`${source.base}conflict_map.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [source.base]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  const trail = useTrail(data?.run_id ?? "none", source, data?.flags.length ?? 0);
  const { decisions } = trail;
  const docs = useMemo(() => new Map((data?.documents ?? []).map((d) => [d.id, d])), [data]);

  if (error && source.engagement) return <div className="empty">{t("โหลดผลการตรวจไม่ได้", "Could not load the results")} ({error})</div>;
  if (error)
    return (
      <div className="empty">
        {t("โหลด conflict_map.json ไม่ได้", "Could not load conflict_map.json")} ({error}) {t("ให้รัน pipeline ก่อน", "Run the pipeline first")}: <code>python -m auditconcierge samples/tg_company --out ../web/public/data</code>
      </div>
    );
  if (!data) return <Loading />;

  const checked = data.flags.filter((f) => decisions[f.id]).length;
  const TABS: [Tab, string, number | null][] = [
    ["flags", t("ควรตรวจ", "To check"), data.flags.length],
    ["pending", t("รอจับคู่", "Unmatched"), data.pending.length],
    ["overview", t("ภาพรวม", "Overview"), null],
    ["report", t("รายงาน", "Report"), null],
  ];

  return (
    <SourceContext.Provider value={source}>
    <div className="app">
      {data.engagement.synthetic && (
        <div className="synthetic" role="note">
          {source.engagement
            ? t("Engagement นี้ใช้ข้อมูลสมมติ (synthetic)", "This engagement uses synthetic data")
            : t("ข้อมูลทั้งหมดในเดโมนี้เป็นข้อมูลสมมติ (synthetic) ไม่มีข้อมูลลูกค้าจริง", "All data in this demo is synthetic. No real client data.")}
        </div>
      )}
      <header className="navbar">
        <div className="brand">
          {back}
          <span className="app-icon" aria-hidden>
            ✓
          </span>
          <div>
            <h1>AI Audit Concierge</h1>
            <p className="sub">
              {data.engagement.client} · {data.coverage.files} {t("ไฟล์", "files")} · {data.documents.length} {t("เอกสาร", "documents")} ·{" "}
              {data.transactions.length} {t("ธุรกรรม", "transactions")}
            </p>
          </div>
        </div>
        <nav className="segmented" role="tablist" aria-label={t("มุมมอง", "View")}>
          {TABS.map(([id, label, n]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
              {n != null && <span className="count">{n}</span>}
            </button>
          ))}
        </nav>
        <div className="nav-actions">
          <button className="btn" disabled={!trail.events.length} onClick={() => exportTrailCsv(data.run_id, trail.events)}>
            Audit Trail
          </button>
          <LangToggle />
        </div>
      </header>
      <p className="principle">{t("ระบบชี้จุดที่ควรตรวจพร้อมหลักฐาน ผู้สอบบัญชีเป็นผู้ตัดสิน", "The system points out what to check, with evidence. The auditor decides.")}</p>
      <SignoffBar trail={trail} total={data.flags.length} checked={checked} />

      <ReadProblems data={data} />
      <main>
        {tab === "flags" && (
          <FlagsView data={data} docs={docs} trail={trail} focusTxn={focusTxn} />
        )}
        {tab === "pending" && <PendingView data={data} docs={docs} trail={trail} />}
        {tab === "overview" && (
          <OverviewView
            data={data}
            docs={docs}
            openTxn={(id) => {
              setFocusTxn(id);
              setTab("flags");
            }}
          />
        )}
        {tab === "report" && <ReportView data={data} decisions={decisions} signoff={trail.signoff} />}
      </main>

      <AskBox run={data.run_id} />
      <footer className="foot">
        {t("รอบประมวลผล", "Run")} {data.run_id} · schema {data.schema_version} · {t("เกณฑ์คลาดเคลื่อน", "Tolerance")} {data.engagement.tolerance_pct}% · {t("เกณฑ์สาระสำคัญ", "Materiality")}{" "}
        {amount(data.engagement.materiality_thb)} ฿
      </footer>
    </div>
    </SourceContext.Provider>
  );
}
