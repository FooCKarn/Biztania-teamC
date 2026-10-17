import { useEffect, useState } from "react";
import { api, ROLE_LABEL, when, type Engagement } from "../api";
import { t } from "../i18n";
import Loading from "../components/Loading";

interface List {
  engagements: Engagement[];
  can_create: boolean;
  real_data_allowed: boolean;
}

export default function Engagements() {
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ client: "", period: "", tolerance_pct: "1", materiality_thb: "10000", synthetic: true });
  const load = () =>
    api<List>("api/engagements")
      .then(setList)
      .catch((e) => setError(e.message));
  useEffect(() => void load(), []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return; // no double submit
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ engagement: Engagement }>("api/engagements", {
        body: { ...f, tolerance_pct: Number(f.tolerance_pct), materiality_thb: Number(f.materiality_thb) },
      });
      location.hash = `/e/${r.engagement.id}`;
    } catch (x) {
      setError((x as Error).message);
      setBusy(false);
    }
  };

  if (!list) return error ? <p className="empty error">{error}</p> : <Loading />;
  return (
    <div>
      <div className="row row between page-head">
        <h2>{t("บริษัทของฉัน", "My companies")}</h2>
        {list.can_create && (
          <button className="btn filled" onClick={() => setCreating(!creating)}>
            {creating ? t("ยกเลิก", "Cancel") : t("สร้างบริษัท", "New company")}
          </button>
        )}
      </div>
      {error && (
        <p className="small error" role="alert">
          {error}
        </p>
      )}

      {creating && (
        <form className="group-body form" onSubmit={create}>
          <h3>{t("บริษัทใหม่", "New company")}</h3>
          <label className="form-field">
            <span>{t("ชื่อลูกค้า", "Client name")}</span>
            <input value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} required minLength={2} maxLength={120} />
          </label>
          <label className="form-field">
            <span>{t("งวดที่ตรวจ", "Period")}</span>
            <input value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} placeholder={t("เช่น ปี 2026", "e.g. FY2026")} maxLength={40} />
          </label>
          <div className="row">
            <label className="form-field">
              <span>Tolerance (%)</span>
              <input type="number" step="0.1" min="0" max="20" value={f.tolerance_pct} onChange={(e) => setF({ ...f, tolerance_pct: e.target.value })} />
            </label>
            <label className="form-field">
              <span>Materiality (฿)</span>
              <input type="number" min="0" value={f.materiality_thb} onChange={(e) => setF({ ...f, materiality_thb: e.target.value })} />
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={list.real_data_allowed ? f.synthetic : true}
              disabled={!list.real_data_allowed}
              onChange={(e) => setF({ ...f, synthetic: e.target.checked })}
            />
            {t("ข้อมูลสมมติ (synthetic)", "Synthetic data")}
          </label>
          {!list.real_data_allowed && (
            <p className="muted small">
              {t(
                "ระบบยังรับเฉพาะข้อมูลสมมติ จนกว่าจะเปลี่ยนผู้ให้บริการ AI ตามสัญญาข้อมูล (ALLOW_REAL_DATA)",
                "Only synthetic data is accepted until the AI provider is switched under a data agreement (ALLOW_REAL_DATA).",
              )}
            </p>
          )}
          <p className="muted small">
            {t("คุณจะอยู่ในทีมของบริษัทนี้โดยอัตโนมัติ", "You will be on this company's team automatically.")}
          </p>
          <button className="btn filled" disabled={busy}>
            {busy ? t("กำลังสร้าง…", "Creating…") : t("สร้าง", "Create")}
          </button>
        </form>
      )}

      {list.engagements.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden>
            ▤
          </span>
          <strong>{t("ยังไม่มีบริษัทที่คุณอยู่ในทีม", "You are not on any company yet")}</strong>
          <p className="muted small">
            {list.can_create ? t("กด สร้างบริษัทเพื่อเริ่ม", "Press New company to start.") : t("ให้คนในทีมเพิ่มคุณเข้าบริษัท", "Ask someone on the team to add you.")}
          </p>
        </div>
      ) : (
        <div className="group-body list">
          {list.engagements.map((e) => (
            <a key={e.id} className="list-row" href={`#/e/${e.id}`}>
              <div>
                <strong>{e.client}</strong>
                <p className="muted small">
                  {e.period ? `${e.period} · ` : ""}
                  {t("สร้าง", "Created")} {when(e.created_at)}
                  {e.synthetic && ` · ${t("ข้อมูลสมมติ", "Synthetic")}`}
                </p>
              </div>
              <div className="row">
                <span className="pill">{ROLE_LABEL[e.my_role]}</span>
                {e.signoff && <span className="pill ok">{t("ลงนามยืนยันผลแล้ว", "Signed off")}</span>}
                <span className={"pill " + (e.status === "open" ? "ok" : "")}>{e.status === "open" ? t("เปิดอยู่", "Open") : t("ปิดแล้ว", "Closed")}</span>
                <span className="chev" aria-hidden>
                  ›
                </span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
