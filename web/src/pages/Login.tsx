import { useState } from "react";
import { api } from "../api";

function useSubmit(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

const Field = ({ label, ...p }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <label className="form-field">
    <span>{label}</span>
    <input {...p} />
  </label>
);

const DEMO_CHOICES = [
  ["preparer", "ผู้จัดทำ", "อัปโหลด ประมวลผล และลงนามจัดทำ"],
  ["reviewer", "ผู้สอบทาน", "สอบทานและลงนามรับรองผลของผู้จัดทำ"],
  ["manager", "Manager", "ทำได้ทุกอย่างในเดโม"],
] as const;

export default function Login({ setupNeeded, demoMode, onDone }: { setupNeeded: boolean; demoMode?: boolean; onDone: () => void }) {
  const [setup, setSetup] = useState(setupNeeded);
  const [f, setF] = useState({ email: "", password: "", token: "", name: "", initials: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const { busy, error, submit } = useSubmit(async () => {
    if (setup) await api("api/auth/setup", { body: f });
    else await api("api/auth/login", { body: { email: f.email, password: f.password } });
    onDone();
  });

  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const enterDemo = async (role: string) => {
    setDemoBusy(role);
    setDemoError(null);
    try {
      await api("api/auth/demo-login", { body: { role } });
      location.hash = "/";
      onDone();
    } catch (x) {
      setDemoError((x as Error).message);
      setDemoBusy(null);
    }
  };

  return (
    <div className="shell narrow">
      <div className="login-head">
        <span className="app-icon big" aria-hidden>
          ✓
        </span>
        <h1>AI Audit Concierge</h1>
        <p className="muted">ระบบชี้จุดที่ควรตรวจพร้อมหลักฐาน ผู้สอบบัญชีเป็นผู้ตัดสิน</p>
      </div>
      {demoMode && (
        <div className="group-body form">
          <h3>เลือกมุมมองเพื่อลองใช้ (ไม่ต้องเข้าสู่ระบบ)</h3>
          <p className="muted small">
            เข้าด้วยบัญชีทดลองตามบทบาทที่เลือก ใช้อัปโหลด ประมวลผล ดูประเด็นที่ควรตรวจ ถามตอบ และลงนามได้ ข้อมูลเป็นข้อมูลสมมติเท่านั้น ห้ามอัปโหลดเอกสารจริง สลับบทบาทได้ภายหลังจากแบนเนอร์
          </p>
          {demoError && (
            <p className="small error" role="alert">
              {demoError}
            </p>
          )}
          {DEMO_CHOICES.map(([role, label, hint]) => (
            <button key={role} type="button" className="btn wide" onClick={() => enterDemo(role)} disabled={demoBusy !== null}>
              {demoBusy === role ? "กำลังเข้า…" : `เข้าเป็น${label}`} <span className="muted small">· {hint}</span>
            </button>
          ))}
        </div>
      )}
      <form className="group-body form" onSubmit={submit}>
        <h3>{setup ? "ตั้งค่าบัญชีผู้ดูแลระบบคนแรก" : "เข้าสู่ระบบ"}</h3>
        {setup && (
          <>
            <p className="muted small">ใช้รหัสตั้งค่า (SETUP_TOKEN) ที่ตั้งไว้ใน Worker ใช้ได้ครั้งเดียวตอนยังไม่มีผู้ใช้</p>
            <Field label="รหัสตั้งค่า" value={f.token} onChange={set("token")} type="password" required autoComplete="off" />
            <Field label="ชื่อ-นามสกุล" value={f.name} onChange={set("name")} required />
            <Field label="ชื่อย่อ (ใช้ลงนาม)" value={f.initials} onChange={set("initials")} maxLength={4} required placeholder="เช่น SK" />
          </>
        )}
        <Field label="อีเมล" value={f.email} onChange={set("email")} type="email" required autoComplete="username" />
        <Field
          label="รหัสผ่าน"
          value={f.password}
          onChange={set("password")}
          type="password"
          required
          minLength={setup ? 10 : undefined}
          autoComplete={setup ? "new-password" : "current-password"}
        />
        {error && (
          <p className="small error" role="alert">
            {error}
          </p>
        )}
        <button className="btn filled wide" disabled={busy}>
          {busy ? "กำลังดำเนินการ…" : setup ? "สร้างบัญชีและเข้าสู่ระบบ" : "เข้าสู่ระบบ"}
        </button>
        {setupNeeded && (
          <button type="button" className="link small" onClick={() => setSetup(!setup)}>
            {setup ? "มีบัญชีแล้ว เข้าสู่ระบบ" : "ตั้งค่าบัญชีแรก"}
          </button>
        )}
        <p className="muted small">ยังไม่มีบัญชี? ให้ผู้ดูแลระบบของสำนักงานสร้างให้ (ไม่มีการสมัครเอง)</p>
      </form>
      <p className="center">
        <a className="btn" href="#/demo">
          ดูเดโมด้วยข้อมูลสมมติ (ไม่ต้องเข้าสู่ระบบ)
        </a>
      </p>
    </div>
  );
}

export function ChangePassword({ first, onDone }: { first?: boolean; onDone: () => void }) {
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const { busy, error, submit } = useSubmit(async () => {
    if (f.next !== f.again) throw new Error("รหัสผ่านใหม่สองช่องไม่ตรงกัน");
    await api("api/auth/password", { body: { current: f.current, next: f.next } });
    onDone();
  });
  return (
    <form className="group-body form" onSubmit={submit}>
      <h3>{first ? "ตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งาน" : "เปลี่ยนรหัสผ่าน"}</h3>
      {first && <p className="muted small">รหัสผ่านที่ได้รับจากผู้ดูแลใช้ได้ครั้งเดียว</p>}
      <Field label="รหัสผ่านปัจจุบัน" value={f.current} onChange={set("current")} type="password" required autoComplete="current-password" />
      <Field label="รหัสผ่านใหม่ (อย่างน้อย 10 ตัวอักษร)" value={f.next} onChange={set("next")} type="password" minLength={10} required autoComplete="new-password" />
      <Field label="ยืนยันรหัสผ่านใหม่" value={f.again} onChange={set("again")} type="password" minLength={10} required autoComplete="new-password" />
      {error && (
        <p className="small error" role="alert">
          {error}
        </p>
      )}
      <button className="btn filled wide" disabled={busy}>
        บันทึก
      </button>
      <p className="muted small">เมื่อเปลี่ยนแล้ว ระบบจะออกจากระบบในอุปกรณ์อื่นทั้งหมด</p>
    </form>
  );
}
