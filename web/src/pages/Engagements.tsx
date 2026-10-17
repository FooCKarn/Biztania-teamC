import { useEffect, useState } from "react";
import { api, ROLE_LABEL, when, type Engagement } from "../api";

interface List {
  engagements: Engagement[];
  can_create: boolean;
  real_data_allowed: boolean;
}

export default function Engagements() {
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ client: "", period: "", tolerance_pct: "1", materiality_thb: "10000", synthetic: true });
  const load = () =>
    api<List>("api/engagements")
      .then(setList)
      .catch((e) => setError(e.message));
  useEffect(() => void load(), []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ engagement: Engagement }>("api/engagements", {
        body: { ...f, tolerance_pct: Number(f.tolerance_pct), materiality_thb: Number(f.materiality_thb) },
      });
      location.hash = `/e/${r.engagement.id}`;
    } catch (x) {
      setError((x as Error).message);
    }
  };

  if (!list) return <p className="empty">{error ?? "กำลังโหลด…"}</p>;
  return (
    <div>
      <div className="between page-head">
        <h2>Engagement ของฉัน</h2>
        {list.can_create && (
          <button className="btn filled" onClick={() => setCreating(!creating)}>
            {creating ? "ยกเลิก" : "สร้าง Engagement"}
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
          <h3>Engagement ใหม่</h3>
          <label className="form-field">
            <span>ชื่อลูกค้า</span>
            <input value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} required minLength={2} maxLength={120} />
          </label>
          <label className="form-field">
            <span>งวดที่ตรวจ</span>
            <input value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} placeholder="เช่น ปี 2026" maxLength={40} />
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
            ข้อมูลสมมติ (synthetic)
          </label>
          {!list.real_data_allowed && (
            <p className="muted small">ระบบยังรับเฉพาะข้อมูลสมมติ จนกว่าจะเปลี่ยนผู้ให้บริการ AI ตามสัญญาข้อมูล (ALLOW_REAL_DATA)</p>
          )}
          <p className="muted small">คุณจะเป็น Manager ของ Engagement นี้ แล้วเพิ่มทีมได้ในหน้าถัดไป</p>
          <button className="btn filled">สร้าง</button>
        </form>
      )}

      {list.engagements.length === 0 ? (
        <p className="muted pad">
          ยังไม่มี Engagement ที่คุณอยู่ในทีม {list.can_create ? "กด สร้าง Engagement เพื่อเริ่ม" : "ให้ Manager เพิ่มคุณเข้าทีม"}
        </p>
      ) : (
        <div className="group-body list">
          {list.engagements.map((e) => (
            <a key={e.id} className="list-row" href={`#/e/${e.id}`}>
              <div>
                <strong>{e.client}</strong>
                <p className="muted small">
                  {e.period ? `${e.period} · ` : ""}สร้าง {when(e.created_at)}
                  {e.synthetic && " · ข้อมูลสมมติ"}
                </p>
              </div>
              <div className="row">
                <span className="pill">{ROLE_LABEL[e.my_role]}</span>
                <span className={"pill " + (e.status === "open" ? "ok" : "")}>{e.status === "open" ? "เปิดอยู่" : "ปิดแล้ว"}</span>
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
