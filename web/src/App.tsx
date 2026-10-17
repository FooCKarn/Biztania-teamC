import { useCallback, useEffect, useState } from "react";
import Workspace from "./Workspace";
import { DEMO, engagementSource, type Source } from "./source";
import { api, type User, type EngagementDetail } from "./api";
import Login, { ChangePassword } from "./pages/Login";
import Engagements from "./pages/Engagements";
import EngagementPage from "./pages/EngagementPage";
import Users from "./pages/Users";
import Files from "./pages/Files";

// Hash routes, so the static build works on any host:
//   #/demo                 public demo (synthetic sample, no login)
//   #/                     engagements of the signed-in user (or the login page)
//   #/e/<id>               one engagement: files, runs, team, activity
//   #/e/<id>/review        the review workspace on that engagement's latest results
//   #/files[/<id>]         file manager and storage used (optionally opened on one engagement)
//   #/users                accounts (firm admin)
//   #/account              change password
function useHash() {
  const [hash, setHash] = useState(location.hash.replace(/^#/, "") || "/");
  useEffect(() => {
    const on = () => setHash(location.hash.replace(/^#/, "") || "/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

type Me = { state: "loading" } | { state: "no-server" } | { state: "out"; setupNeeded: boolean; demoMode: boolean } | { state: "in"; user: User };

const Back = ({ to, label }: { to: string; label: string }) => (
  <a className="back" href={to}>
    ‹ {label}
  </a>
);

const DEMO_ROLES = [
  ["preparer", "ผู้จัดทำ"],
  ["reviewer", "ผู้สอบทาน"],
  ["manager", "Manager"],
] as const;

// Shown for the shared demo accounts (DEMO_MODE): synthetic data only, switch role (a review needs someone
// other than the preparer), and wipe the demo engagement.
function DemoBanner({ user, onChange }: { user: User; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const switchTo = (role: string) =>
    run(async () => {
      await api("api/auth/demo-login", { body: { role } });
      location.hash = "/";
    });
  const reset = () => {
    if (!confirm("รีเซ็ตเดโม: ลบไฟล์และผลการตรวจของ Engagement เดโมทั้งหมดแล้วเริ่มใหม่ ทุกคนที่ใช้เดโมร่วมกันจะเห็นผลนี้ ต้องการดำเนินการต่อหรือไม่?")) return;
    return run(async () => {
      const r = await api<{ engagement: { id: string } }>("api/auth/demo-reset", { method: "POST" });
      location.hash = `/e/${r.engagement.id}`;
    });
  };
  const current = user.initials === "DP" ? "preparer" : user.initials === "DR" ? "reviewer" : "manager";
  return (
    <div className="banner" role="status">
      <strong>โหมดเดโม</strong> · ข้อมูลสมมติเท่านั้น ห้ามอัปโหลดเอกสารจริง ทุกคนที่เข้าเดโมใช้ Engagement เดียวกัน
      <div className="row" style={{ marginTop: 8 }}>
        <span className="muted small">สลับบทบาท:</span>
        {DEMO_ROLES.map(([r, label]) => (
          <button key={r} className={`btn${r === current ? " filled" : ""}`} disabled={busy || r === current} onClick={() => switchTo(r)}>
            {label}
          </button>
        ))}
        <button className="btn" disabled={busy} onClick={reset}>
          รีเซ็ตเดโม
        </button>
      </div>
      {error && (
        <p className="small error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function EngagementReview({ id }: { id: string }) {
  const [src, setSrc] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<EngagementDetail>(`api/engagements/${id}`)
      .then((d) => {
        if (!d.current_run) return setError("ยังไม่มีผลการตรวจ ให้อัปโหลดเอกสารแล้วกดประมวลผลก่อน");
        setSrc(engagementSource(id, d.current_run, d.engagement));
      })
      .catch((e) => setError(e.message));
  }, [id]);
  if (error)
    return (
      <div className="shell">
        <Back to={`#/e/${id}`} label="Engagement" />
        <p className="empty">{error}</p>
      </div>
    );
  if (!src) return <div className="empty">กำลังโหลด…</div>;
  return <Workspace source={src} back={<Back to={`#/e/${id}`} label="Engagement" />} />;
}

export default function App() {
  const hash = useHash();
  const [me, setMe] = useState<Me>({ state: "loading" });
  const refresh = useCallback(() => {
    fetch("api/auth/me")
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const b = await r.json();
        setMe(b.user ? { state: "in", user: b.user } : { state: "out", setupNeeded: b.setup_needed, demoMode: !!b.demo_mode });
      })
      .catch(() => setMe({ state: "no-server" }));
  }, []);
  useEffect(refresh, [refresh]);

  // The public demo needs no account; old shared links (?ws=…) still open it.
  if (hash === "/demo" || new URLSearchParams(location.search).has("ws")) return <Workspace source={DEMO} back={<Back to="#/" label="หน้าหลัก" />} />;
  if (me.state === "loading") return <div className="empty">กำลังโหลด…</div>;
  if (me.state === "no-server") return <Workspace source={DEMO} />; // static hosting: demo only
  if (me.state === "out") return <Login setupNeeded={me.setupNeeded} demoMode={me.demoMode} onDone={refresh} />;

  const user = me.user;
  if (user.must_change)
    return (
      <div className="shell narrow">
        <ChangePassword first onDone={refresh} />
      </div>
    );
  const logout = async () => {
    await api("api/auth/logout", { method: "POST" }).catch(() => undefined);
    location.hash = "/";
    refresh();
  };
  const bar = (
    <div className="topbar">
      <a className="brand-link" href="#/">
        <span className="app-icon" aria-hidden>
          ✓
        </span>
        AI Audit Concierge
      </a>
      <div className="row">
        <span className="muted small">
          {user.name} ({user.initials})
        </span>
        <a className="btn" href="#/files">
          ไฟล์
        </a>
        {user.firm_role === "admin" && (
          <a className="btn" href="#/users">
            ผู้ใช้
          </a>
        )}
        {!user.demo && (
          <a className="btn" href="#/account">
            รหัสผ่าน
          </a>
        )}
        <button className="btn" onClick={logout}>
          ออกจากระบบ
        </button>
      </div>
    </div>
  );

  const review = hash.match(/^\/e\/([a-f0-9]{12})\/review$/);
  if (review)
    return (
      <>
        {user.demo && <DemoBanner user={user} onChange={refresh} />}
        <EngagementReview id={review[1]} />
      </>
    );
  const eng = hash.match(/^\/e\/([a-f0-9]{12})$/);
  const files = hash.match(/^\/files(?:\/([a-f0-9]{12}))?$/);
  let page;
  if (eng) page = <EngagementPage id={eng[1]} me={user} />;
  else if (files) page = <Files engagement={files[1]} />;
  else if (hash === "/users" && user.firm_role === "admin") page = <Users me={user} />;
  else if (hash === "/account") page = <ChangePassword onDone={() => (location.hash = "/")} />;
  else page = <Engagements />;
  return (
    <div className="shell">
      {bar}
      {user.demo && <DemoBanner user={user} onChange={refresh} />}
      {page}
    </div>
  );
}
