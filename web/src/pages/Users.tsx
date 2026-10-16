import { useEffect, useState } from "react";
import { api, type User } from "../api";

// Firm admin: create accounts (each gets a one-time password to hand over in person), disable, reset.
export default function Users({ me }: { me: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [f, setF] = useState({ email: "", name: "", initials: "", firm_role: "member" });
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ who: string; pw: string } | null>(null);
  const load = () =>
    api<{ users: User[] }>("api/users")
      .then((r) => setUsers(r.users))
      .catch((e) => setError(e.message));
  useEffect(() => void load(), []);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (x) {
      setError((x as Error).message);
    }
  };
  const create = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api<{ user: User; temp_password: string }>("api/users", { body: f });
      setSecret({ who: `${r.user.name} (${r.user.email})`, pw: r.temp_password });
      setF({ email: "", name: "", initials: "", firm_role: "member" });
    });
  };
  const op = (u: User, what: "disable" | "enable" | "reset") =>
    run(async () => {
      const r = await api<{ temp_password?: string }>(`api/users/${u.id}/${what}`, { method: "POST" });
      if (r.temp_password) setSecret({ who: `${u.name} (${u.email})`, pw: r.temp_password });
    });

  return (
    <div>
      <a className="back" href="#/">
        ‹ Engagement ทั้งหมด
      </a>
      <h2 className="page-head">ผู้ใช้ของสำนักงาน</h2>
      {error && (
        <p className="small error" role="alert">
          {error}
        </p>
      )}
      {secret && (
        <div className="banner" role="status">
          รหัสผ่านชั่วคราวของ {secret.who}: <code className="mono">{secret.pw}</code> · แสดงครั้งเดียว ให้ส่งถึงเจ้าตัวโดยตรง
          ระบบจะบังคับเปลี่ยนรหัสตอนเข้าใช้ครั้งแรก{" "}
          <button className="link" onClick={() => setSecret(null)}>
            ปิด
          </button>
        </div>
      )}
      <form className="group-body form" onSubmit={create}>
        <h3>เพิ่มผู้ใช้</h3>
        <div className="row wrap">
          <label className="form-field">
            <span>ชื่อ-นามสกุล</span>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} />
          </label>
          <label className="form-field">
            <span>อีเมล</span>
            <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
          </label>
          <label className="form-field short">
            <span>ชื่อย่อ</span>
            <input value={f.initials} onChange={(e) => setF({ ...f, initials: e.target.value })} required maxLength={4} placeholder="SK" />
          </label>
          <label className="form-field">
            <span>สิทธิ์ในสำนักงาน</span>
            <select value={f.firm_role} onChange={(e) => setF({ ...f, firm_role: e.target.value })}>
              <option value="member">ผู้ใช้ทั่วไป</option>
              <option value="admin">ผู้ดูแลระบบ (สร้าง Engagement และผู้ใช้)</option>
            </select>
          </label>
        </div>
        <button className="btn filled">เพิ่มผู้ใช้</button>
        <p className="muted small">บทบาทผู้จัดทำ / ผู้สอบทาน / Manager กำหนดแยกในแต่ละ Engagement · ผู้ดูแลระบบไม่เห็นข้อมูลของ Engagement ที่ตนไม่ได้อยู่ในทีม</p>
      </form>

      <div className="group-body list">
        {users.map((u) => (
          <div key={u.id} className="list-row">
            <div>
              <strong>
                {u.initials} · {u.name}
              </strong>
              <p className="muted small">
                {u.email} · {u.firm_role === "admin" ? "ผู้ดูแลระบบ" : "ผู้ใช้ทั่วไป"}
                {u.must_change && " · รอเปลี่ยนรหัสผ่าน"}
                {u.disabled && " · ปิดใช้งาน"}
              </p>
            </div>
            {u.id !== me.id && (
              <div className="row">
                <button className="link small" onClick={() => op(u, "reset")}>
                  รีเซ็ตรหัสผ่าน
                </button>
                <button className="link small destructive" onClick={() => op(u, u.disabled ? "enable" : "disable")}>
                  {u.disabled ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
