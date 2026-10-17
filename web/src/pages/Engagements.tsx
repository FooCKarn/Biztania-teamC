import { useEffect, useState } from "react";
import { api, when, type Engagement } from "../api";
import { t } from "../i18n";
import Loading from "../components/Loading";

interface List {
  engagements: Engagement[];
  can_create: boolean;
  can_delete?: boolean;
  real_data_allowed: boolean;
}

export default function Engagements() {
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ client: "", period: "", tolerance_pct: "1", materiality_thb: "10000", synthetic: true });
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState({ client: "", period: "", tolerance_pct: "1", materiality_thb: "10000" });
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

  const startEdit = (e: Engagement) => {
    setError(null);
    setEf({ client: e.client, period: e.period ?? "", tolerance_pct: String(e.tolerance_pct), materiality_thb: String(e.materiality_thb) });
    setEditId(e.id);
  };
  const saveEdit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy || !editId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`api/engagements/${editId}/update`, {
        body: { ...ef, tolerance_pct: Number(ef.tolerance_pct), materiality_thb: Number(ef.materiality_thb) },
      });
      setEditId(null);
      await load();
    } catch (x) {
      setError((x as Error).message);
    }
    setBusy(false);
  };
  const remove = async (e: Engagement) => {
    if (busy) return;
    const ok = window.confirm(
      t(
        `ลบบริษัท "${e.client}"? ไฟล์และผลการตรวจจะถูกลบ ส่วนประวัติการทำงานและ Audit Trail ยังเก็บไว้ ย้อนกลับไม่ได้`,
        `Delete "${e.client}"? Its files and results are removed; the activity log and Audit Trail are kept. This cannot be undone.`,
      ),
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api(`api/engagements/${e.id}/delete`, { body: {} });
      await load();
    } catch (x) {
      setError((x as Error).message);
    }
    setBusy(false);
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
          {list.engagements.map((e) =>
            editId === e.id ? (
              <form key={e.id} className="list-row edit-row" onSubmit={saveEdit}>
                <div className="row wrap grow">
                  <label className="form-field">
                    <span>{t("ชื่อลูกค้า", "Client name")}</span>
                    <input value={ef.client} onChange={(x) => setEf({ ...ef, client: x.target.value })} required minLength={2} maxLength={120} autoFocus />
                  </label>
                  <label className="form-field">
                    <span>{t("งวดที่ตรวจ", "Period")}</span>
                    <input value={ef.period} onChange={(x) => setEf({ ...ef, period: x.target.value })} maxLength={40} />
                  </label>
                  <label className="form-field short">
                    <span>Tolerance (%)</span>
                    <input type="number" step="0.1" min="0" max="20" value={ef.tolerance_pct} onChange={(x) => setEf({ ...ef, tolerance_pct: x.target.value })} />
                  </label>
                  <label className="form-field short">
                    <span>Materiality (฿)</span>
                    <input type="number" min="0" value={ef.materiality_thb} onChange={(x) => setEf({ ...ef, materiality_thb: x.target.value })} />
                  </label>
                </div>
                <div className="row">
                  <button className="btn filled" disabled={busy}>
                    {t("บันทึก", "Save")}
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => setEditId(null)}>
                    {t("ยกเลิก", "Cancel")}
                  </button>
                </div>
              </form>
            ) : (
              <div key={e.id} className="list-row">
                <a className="list-main" href={`#/e/${e.id}`}>
                  <div>
                    <strong>{e.client}</strong>
                    <p className="muted small">
                      {e.period ? `${e.period} · ` : ""}
                      {t("สร้าง", "Created")} {when(e.created_at)}
                      {e.synthetic && ` · ${t("ข้อมูลสมมติ", "Synthetic")}`}
                    </p>
                  </div>
                  <div className="row">
                    {e.signoff && <span className="pill ok">{t("ลงนามยืนยันผลแล้ว", "Signed off")}</span>}
                    <span className={"pill " + (e.status === "open" ? "ok" : "")}>{e.status === "open" ? t("เปิดอยู่", "Open") : t("ปิดแล้ว", "Closed")}</span>
                    <span className="chev" aria-hidden>
                      ›
                    </span>
                  </div>
                </a>
                <div className="row icon-actions">
                  {e.status === "open" && (
                    <button className="icon-btn" title={t("แก้ไข", "Edit")} aria-label={t("แก้ไขบริษัท", "Edit company")} disabled={busy} onClick={() => startEdit(e)}>
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                  )}
                  {list.can_delete && (
                    <button className="icon-btn danger" title={t("ลบ", "Delete")} aria-label={t("ลบบริษัท", "Delete company")} disabled={busy} onClick={() => remove(e)}>
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v5M14 11v5" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
