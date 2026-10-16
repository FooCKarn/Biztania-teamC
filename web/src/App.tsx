import { useEffect, useMemo, useState } from "react";
import type { ConflictMap } from "./types";
import { useDecisions } from "./decisions";
import FlagsView from "./components/FlagsView";
import PendingView from "./components/PendingView";
import OverviewView from "./components/OverviewView";
import AskBox from "./components/AskBox";

type Tab = "flags" | "pending" | "overview";

export default function App() {
  const [data, setData] = useState<ConflictMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("flags");
  const [focusTxn, setFocusTxn] = useState<string | null>(null);

  useEffect(() => {
    fetch("data/conflict_map.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  const { decisions, decide } = useDecisions(data?.run_id ?? "none");
  const docs = useMemo(() => new Map((data?.documents ?? []).map((d) => [d.id, d])), [data]);

  if (error)
    return (
      <div className="empty">
        โหลด conflict_map.json ไม่ได้ ({error}) ให้รัน pipeline ก่อน: <code>python -m auditconcierge samples/tg_company --out ../web/public/data</code>
      </div>
    );
  if (!data) return <div className="empty">กำลังโหลด…</div>;

  const decided = data.flags.filter((f) => decisions[f.id]).length;

  return (
    <div className="app">
      <div className="synthetic" role="note">
        ข้อมูลทั้งหมดในเดโมนี้เป็นข้อมูลสมมติ (synthetic) ไม่มีข้อมูลลูกค้าจริง
      </div>
      <header className="top">
        <div>
          <h1>AI Audit Concierge</h1>
          <p className="sub">
            {data.engagement.client} · ไฟล์ {data.coverage.files} · เอกสาร {data.documents.length} · ธุรกรรม{" "}
            {data.transactions.length}
          </p>
        </div>
        <p className="principle">ระบบชี้จุดที่ควรตรวจพร้อมหลักฐาน ผู้สอบบัญชีเป็นผู้ตัดสิน</p>
      </header>

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "flags"} onClick={() => setTab("flags")}>
          ควรตรวจ <span className="count">{data.flags.length}</span>
          {decided > 0 && <span className="muted"> · ตัดสินแล้ว {decided}</span>}
        </button>
        <button role="tab" aria-selected={tab === "pending"} onClick={() => setTab("pending")}>
          รอจับคู่ <span className="count">{data.pending.length}</span>
        </button>
        <button role="tab" aria-selected={tab === "overview"} onClick={() => setTab("overview")}>
          ภาพรวม
        </button>
      </nav>

      <main>
        {tab === "flags" && (
          <FlagsView data={data} docs={docs} decisions={decisions} decide={decide} focusTxn={focusTxn} />
        )}
        {tab === "pending" && <PendingView data={data} docs={docs} runId={data.run_id} />}
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

      <AskBox />
      <footer className="foot">
        run {data.run_id} · schema {data.schema_version} · tolerance {data.engagement.tolerance_pct}% · materiality{" "}
        {data.engagement.materiality_thb.toLocaleString("th-TH")} ฿
      </footer>
    </div>
  );
}
