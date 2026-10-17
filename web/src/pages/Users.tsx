import { useEffect, useState } from "react";
import { api, ROLE_LABEL, type Role, type User } from "../api";
import { t } from "../i18n";

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
        ‹ {t("Engagement ทั้งหมด", "All engagements")}
      </a>
      <h2 className="page-head">{t("ผู้ใช้ของสำนักงาน", "Firm users")}</h2>
      {error && (
        <p className="small error" role="alert">
          {error}
        </p>
      )}
      {secret && (
        <div className="banner" role="status">
          {t("รหัสผ่านชั่วคราวของ", "Temporary password for")} {secret.who}: <code className="mono">{secret.pw}</code> ·{" "}
          {t(
            "แสดงครั้งเดียว ให้ส่งถึงเจ้าตัวโดยตรง ระบบจะบังคับเปลี่ยนรหัสตอนเข้าใช้ครั้งแรก",
            "Shown once. Hand it to the person directly; they must change it at first sign-in.",
          )}{" "}
          <button className="link" onClick={() => setSecret(null)}>
            {t("ปิด", "Close")}
          </button>
        </div>
      )}
      <DemoSetup onDone={load} />

      <form className="group-body form" onSubmit={create}>
        <h3>{t("เพิ่มผู้ใช้", "Add user")}</h3>
        <div className="row wrap">
          <label className="form-field">
            <span>{t("ชื่อ-นามสกุล", "Full name")}</span>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} />
          </label>
          <label className="form-field">
            <span>{t("อีเมล", "Email")}</span>
            <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
          </label>
          <label className="form-field short">
            <span>{t("ชื่อย่อ", "Initials")}</span>
            <input value={f.initials} onChange={(e) => setF({ ...f, initials: e.target.value })} required maxLength={4} placeholder="SK" />
          </label>
          <label className="form-field">
            <span>{t("สิทธิ์ในสำนักงาน", "Firm role")}</span>
            <select value={f.firm_role} onChange={(e) => setF({ ...f, firm_role: e.target.value })}>
              <option value="member">{t("ผู้ใช้ทั่วไป", "Member")}</option>
              <option value="admin">{t("ผู้ดูแลระบบ (สร้าง Engagement และผู้ใช้)", "Admin (creates engagements and users)")}</option>
            </select>
          </label>
        </div>
        <button className="btn filled">{t("เพิ่มผู้ใช้", "Add user")}</button>
        <p className="muted small">
          {t(
            "บทบาทผู้จัดทำ / ผู้สอบทาน / Manager กำหนดแยกในแต่ละ Engagement · ผู้ดูแลระบบไม่เห็นข้อมูลของ Engagement ที่ตนไม่ได้อยู่ในทีม",
            "Preparer / reviewer / manager roles are set per engagement · Admins cannot see engagements they are not on.",
          )}
        </p>
      </form>

      <div className="group-body list">
        {users.map((u) => (
          <div key={u.id} className="list-row">
            <div>
              <strong>
                {u.initials} · {u.name}
              </strong>
              <p className="muted small">
                {u.email} · {u.firm_role === "admin" ? t("ผู้ดูแลระบบ", "Admin") : t("ผู้ใช้ทั่วไป", "Member")}
                {u.must_change && ` · ${t("รอเปลี่ยนรหัสผ่าน", "Password change pending")}`}
                {u.disabled && ` · ${t("ปิดใช้งาน", "Disabled")}`}
              </p>
            </div>
            {u.id !== me.id && (
              <div className="row">
                <button className="link small" onClick={() => op(u, "reset")}>
                  {t("รีเซ็ตรหัสผ่าน", "Reset password")}
                </button>
                <button className="link small destructive" onClick={() => op(u, u.disabled ? "enable" : "disable")}>
                  {u.disabled ? t("เปิดใช้งาน", "Enable") : t("ปิดใช้งาน", "Disable")}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type DemoLogin = { role: Role; email: string; password: string };

// Shared demo logins plus a synthetic engagement with the sample documents (worker/src/demo.js).
// One request per step: three accounts, the engagement, each sample file, then a pipeline run.
function DemoSetup({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logins, setLogins] = useState<DemoLogin[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const start = async () => {
    if (!confirm(t("สร้างหรือรีเซ็ตบัญชีทดลอง 3 บัญชี? ถ้ามีอยู่แล้ว รหัสผ่านเดิมจะใช้ไม่ได้อีก", "Create or reset the 3 trial accounts? Existing passwords will stop working."))) return;
    setError(null);
    setLogins(null);
    setNote(null);
    try {
      const out: DemoLogin[] = [];
      for (const role of ["preparer", "reviewer", "manager"] as Role[]) {
        setBusy(t(`สร้างบัญชี${ROLE_LABEL[role]}`, `Creating ${ROLE_LABEL[role]} account`));
        const r = await api<{ user: User; password: string }>(`api/users/demo/account/${role}`, { method: "POST" });
        out.push({ role, email: r.user.email, password: r.password });
      }
      setLogins(out);
      setBusy(t("เตรียม Engagement ทดลอง", "Preparing the trial engagement"));
      const d = await api<{ engagement: { id: string }; files: string[]; has_run: boolean }>("api/users/demo/engagement", { method: "POST" });
      const id = d.engagement.id;
      const manifest: string[] = await fetch("demo/tg_company/manifest.json").then((r) => {
        if (!r.ok) throw new Error(t("ไม่พบชุดเอกสารตัวอย่างใน build (demo/tg_company)", "Sample documents missing from the build (demo/tg_company)"));
        return r.json();
      });
      const have = new Set(d.files);
      const todo = manifest.filter((p) => !have.has(p.split("/").pop()!));
      for (const [i, p] of todo.entries()) {
        const name = p.split("/").pop()!;
        setBusy(t(`อัปโหลดเอกสารตัวอย่าง ${i + 1}/${todo.length}`, `Uploading sample ${i + 1}/${todo.length}`));
        const bytes = await fetch(`demo/tg_company/${p}`).then((r) => r.blob());
        await api(`api/engagements/${id}/files?name=${encodeURIComponent(name)}`, { bytes });
      }
      if (!d.has_run || todo.length) {
        setBusy(t("สั่งประมวลผล (เครื่องประมวลผลอาจใช้เวลาตื่นราว 1 นาที)", "Starting processing (the processor may take about a minute to wake)"));
        try {
          await api(`api/engagements/${id}/runs`, { method: "POST" });
          setNote(t("สั่งประมวลผลแล้ว ผลการตรวจจะขึ้นในหน้า Engagement เมื่อเสร็จ", "Processing started. Results appear on the engagement page when done."));
        } catch (x) {
          setNote(
            t(
              `อัปโหลดเอกสารครบแล้ว แต่ยังสั่งประมวลผลไม่ได้: ${(x as Error).message} · กดประมวลผลในหน้า Engagement ได้ภายหลัง`,
              `All documents uploaded, but processing could not start: ${(x as Error).message} · Run it later from the engagement page.`,
            ),
          );
        }
      } else setNote(t("Engagement ทดลองมีเอกสารและผลการตรวจอยู่แล้ว", "The trial engagement already has its documents and results."));
      onDone();
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const text = logins?.map((l) => `${ROLE_LABEL[l.role]}: ${l.email} / ${l.password}`).join("\n") ?? "";
  return (
    <div className="group-body form">
      <h3>{t("บัญชีทดลองสำหรับ demo", "Demo trial accounts")}</h3>
      <p className="muted small">
        {t(
          "สร้างบัญชีผู้จัดทำ / ผู้สอบทาน / Manager ที่ใช้ร่วมกันได้ และ Engagement ข้อมูลสมมติพร้อมเอกสารตัวอย่าง · กดซ้ำเพื่อรีเซ็ตรหัสผ่านและเติมเอกสารที่ถูกลบ",
          "Creates shared preparer / reviewer / manager accounts and a synthetic engagement with sample documents · Press again to reset passwords and restore deleted documents.",
        )}
      </p>
      {error && (
        <p className="small error" role="alert">
          {error}
        </p>
      )}
      {logins && (
        <div className="banner" role="status">
          <p>{t("รหัสผ่านแสดงครั้งเดียว คัดลอกเก็บไว้ก่อนปิดหน้านี้", "Passwords are shown once. Copy them before leaving this page.")}</p>
          <pre className="mono small">{text}</pre>
          <button className="link" onClick={() => navigator.clipboard?.writeText(`${location.origin}${location.pathname}\n${text}`)}>
            {t("คัดลอก", "Copy")}
          </button>
        </div>
      )}
      {note && <p className="small">{note}</p>}
      <button className="btn filled" onClick={start} disabled={!!busy}>
        {busy ?? t("สร้าง / รีเซ็ตบัญชีทดลอง", "Create / reset trial accounts")}
      </button>
    </div>
  );
}
