import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ConflictMap } from "./types";
import { SourceContext, type Source } from "./source";
import { useTrail } from "./decisions";
import FlagsView from "./components/FlagsView";
import PendingView from "./components/PendingView";
import OverviewView from "./components/OverviewView";
import AskBox from "./components/AskBox";
import { exportCsv, exportTrailCsv } from "./export";

type Tab = "flags" | "pending" | "overview";

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

  const trail = useTrail(data?.run_id ?? "none", source);
  const { decisions } = trail;
  const docs = useMemo(() => new Map((data?.documents ?? []).map((d) => [d.id, d])), [data]);

  if (error && source.engagement) return <div className="empty">โหลดผลการตรวจไม่ได้ ({error})</div>;
  if (error)
    return (
      <div className="empty">
        โหลด conflict_map.json ไม่ได้ ({error}) ให้รัน pipeline ก่อน: <code>python -m auditconcierge samples/tg_company --out ../web/public/data</code>
      </div>
    );
  if (!data) return <div className="empty">กำลังโหลด…</div>;

  const prepared = data.flags.filter((f) => decisions[f.id]).length;
  const reviewed = data.flags.filter((f) => decisions[f.id]?.review).length;
  const TABS: [Tab, string, number | null][] = [
    ["flags", "ควรตรวจ", data.flags.length],
    ["pending", "รอจับคู่", data.pending.length],
    ["overview", "ภาพรวม", null],
  ];

  return (
    <SourceContext.Provider value={source}>
    <div className="app">
      {data.engagement.synthetic && (
        <div className="synthetic" role="note">
          {source.engagement
            ? "Engagement นี้ใช้ข้อมูลสมมติ (synthetic)"
            : "ข้อมูลทั้งหมดในเดโมนี้เป็นข้อมูลสมมติ (synthetic) ไม่มีข้อมูลลูกค้าจริง"}
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
              {data.engagement.client} · {data.coverage.files} ไฟล์ · {data.documents.length} เอกสาร · {data.transactions.length} ธุรกรรม
            </p>
          </div>
        </div>
        <nav className="segmented" role="tablist" aria-label="มุมมอง">
          {TABS.map(([id, label, n]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
              {n != null && <span className="count">{n}</span>}
            </button>
          ))}
        </nav>
        <div className="nav-actions">
          <div className="progress" title="ลงนามผู้จัดทำ / ผู้สอบทาน">
            <span>
              จัดทำ <b>{prepared}</b>/{data.flags.length}
            </span>
            <span>
              สอบทาน <b>{reviewed}</b>/{data.flags.length}
            </span>
          </div>
          <button className="btn" onClick={() => exportCsv(data, decisions)}>
            Export Excel
          </button>
          <button className="btn" disabled={!trail.events.length} onClick={() => exportTrailCsv(data.run_id, trail.events)}>
            Audit Trail
          </button>
        </div>
      </header>
      <p className="principle">ระบบชี้จุดที่ควรตรวจพร้อมหลักฐาน ผู้สอบบัญชีเป็นผู้ตัดสิน</p>

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
      </main>

      <AskBox run={data.run_id} />
      <footer className="foot">
        run {data.run_id} · schema {data.schema_version} · tolerance {data.engagement.tolerance_pct}% · materiality{" "}
        {data.engagement.materiality_thb.toLocaleString("th-TH")} ฿
      </footer>
    </div>
    </SourceContext.Provider>
  );
}
