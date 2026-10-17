import Logo from "../components/Logo";
import { useState } from "react";
import { api } from "../api";
import { LangToggle, t } from "../i18n";
import { ThemeToggle } from "../theme";

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

export default function Login({ setupNeeded, demoMode, onDone }: { setupNeeded: boolean; demoMode?: boolean; onDone: () => void }) {
  const [setup, setSetup] = useState(setupNeeded);
  const [f, setF] = useState({ email: "", password: "", token: "", name: "", initials: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const { busy, error, submit } = useSubmit(async () => {
    if (setup) await api("api/auth/setup", { body: f });
    else await api("api/auth/login", { body: { email: f.email, password: f.password } });
    onDone();
  });

  // Demo entry on: only the try-it button shows. The real form is at ?login=1, or while no admin exists.
  const showForm = !demoMode || setupNeeded || new URLSearchParams(location.search).has("login");
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const enterDemo = async () => {
    setDemoBusy(true);
    setDemoError(null);
    try {
      await api("api/auth/demo-login", { method: "POST" });
      location.hash = "/";
      onDone();
    } catch (x) {
      setDemoError((x as Error).message);
      setDemoBusy(false);
    }
  };

  return (
    <div className="login-stack">
      <div className="login-lang">
        <ThemeToggle />
        <LangToggle />
      </div>
      <Logo className="logo-hero" />
      <div className="login-side">
      <p className="muted login-tag">{t("ระบบชี้จุดที่ควรตรวจพร้อมหลักฐาน ผู้สอบบัญชีเป็นผู้ตัดสิน", "The system points out what to check, with evidence. The auditor decides.")}</p>
      {demoMode && (
        <div className="group-body form">
          <h3>{t("ลองใช้งาน (ไม่ต้องเข้าสู่ระบบ)", "Try it out (no sign-in)")}</h3>
          <p className="muted small">
            {t(
              "เข้าด้วยบัญชีทดลองที่ใช้ร่วมกัน ใช้อัปโหลด ประมวลผล ดูประเด็นที่ควรตรวจ ถามตอบ และลงนามได้ ข้อมูลเป็นข้อมูลสมมติเท่านั้น ห้ามอัปโหลดเอกสารจริง",
              "You enter with a shared trial account: upload, process, review flagged items, ask questions and sign off. Synthetic data only, never upload real documents.",
            )}
          </p>
          {demoError && (
            <p className="small error" role="alert">
              {demoError}
            </p>
          )}
          <button type="button" className="btn filled wide" onClick={enterDemo} disabled={demoBusy}>
            {demoBusy ? t("กำลังเข้า…", "Signing in…") : t("เข้าใช้งานเดโม", "Enter the demo")}
          </button>
        </div>
      )}
      {showForm && (
      <form className="group-body form" onSubmit={submit}>
        <h3>{setup ? t("ตั้งค่าบัญชีผู้ดูแลระบบคนแรก", "Set up the first admin account") : t("เข้าสู่ระบบ", "Sign in")}</h3>
        {setup && (
          <>
            <p className="muted small">
              {t(
                "ใช้รหัสตั้งค่า (SETUP_TOKEN) ที่ตั้งไว้ใน Worker ใช้ได้ครั้งเดียวตอนยังไม่มีผู้ใช้",
                "Use the setup token (SETUP_TOKEN) set on the Worker. It works once, while there are no users.",
              )}
            </p>
            <Field label={t("รหัสตั้งค่า", "Setup token")} value={f.token} onChange={set("token")} type="password" required autoComplete="off" />
            <Field label={t("ชื่อ-นามสกุล", "Full name")} value={f.name} onChange={set("name")} required />
            <Field
              label={t("ชื่อย่อ (ใช้ลงนาม)", "Initials (used to sign)")}
              value={f.initials}
              onChange={set("initials")}
              maxLength={4}
              required
              placeholder={t("เช่น SK", "e.g. SK")}
            />
          </>
        )}
        <Field label={t("อีเมล", "Email")} value={f.email} onChange={set("email")} type="email" required autoComplete="username" />
        <Field
          label={t("รหัสผ่าน", "Password")}
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
          {busy ? t("กำลังดำเนินการ…", "Working…") : setup ? t("สร้างบัญชีและเข้าสู่ระบบ", "Create account and sign in") : t("เข้าสู่ระบบ", "Sign in")}
        </button>
        {setupNeeded && (
          <button type="button" className="link small" onClick={() => setSetup(!setup)}>
            {setup ? t("มีบัญชีแล้ว เข้าสู่ระบบ", "I have an account, sign in") : t("ตั้งค่าบัญชีแรก", "Set up the first account")}
          </button>
        )}
        <p className="muted small">
          {t("ยังไม่มีบัญชี? ให้ผู้ดูแลระบบของสำนักงานสร้างให้ (ไม่มีการสมัครเอง)", "No account? Ask your firm's admin to create one (there is no self sign-up).")}
        </p>
      </form>
      )}
      {showForm && (
        <p className="center">
          <a className="btn" href="#/demo">
            {t("ดูเดโมด้วยข้อมูลสมมติ (ไม่ต้องเข้าสู่ระบบ)", "View the demo with synthetic data (no sign-in)")}
          </a>
        </p>
      )}
      </div>
    </div>
  );
}

export function ChangePassword({ first, onDone }: { first?: boolean; onDone: () => void }) {
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const { busy, error, submit } = useSubmit(async () => {
    if (f.next !== f.again) throw new Error(t("รหัสผ่านใหม่สองช่องไม่ตรงกัน", "The two new passwords do not match"));
    await api("api/auth/password", { body: { current: f.current, next: f.next } });
    onDone();
  });
  return (
    <form className="group-body form" onSubmit={submit}>
      <h3>{first ? t("ตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งาน", "Set a new password before you start") : t("เปลี่ยนรหัสผ่าน", "Change password")}</h3>
      {first && <p className="muted small">{t("รหัสผ่านที่ได้รับจากผู้ดูแลใช้ได้ครั้งเดียว", "The password from your admin works only once.")}</p>}
      <Field label={t("รหัสผ่านปัจจุบัน", "Current password")} value={f.current} onChange={set("current")} type="password" required autoComplete="current-password" />
      <Field
        label={t("รหัสผ่านใหม่ (อย่างน้อย 10 ตัวอักษร)", "New password (at least 10 characters)")}
        value={f.next}
        onChange={set("next")}
        type="password"
        minLength={10}
        required
        autoComplete="new-password"
      />
      <Field
        label={t("ยืนยันรหัสผ่านใหม่", "Confirm new password")}
        value={f.again}
        onChange={set("again")}
        type="password"
        minLength={10}
        required
        autoComplete="new-password"
      />
      {error && (
        <p className="small error" role="alert">
          {error}
        </p>
      )}
      <button className="btn filled wide" disabled={busy}>
        {t("บันทึก", "Save")}
      </button>
      <p className="muted small">{t("เมื่อเปลี่ยนแล้ว ระบบจะออกจากระบบในอุปกรณ์อื่นทั้งหมด", "Changing it signs you out on every other device.")}</p>
    </form>
  );
}
