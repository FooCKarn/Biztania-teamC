import { useCallback, useEffect, useState } from "react";
import Workspace from "./Workspace";
import { DEMO, engagementSource, type Source } from "./source";
import { api, type User, type EngagementDetail } from "./api";
import Login, { ChangePassword } from "./pages/Login";
import Engagements from "./pages/Engagements";
import EngagementPage from "./pages/EngagementPage";
import Users from "./pages/Users";
import Files from "./pages/Files";
import { LangToggle, t, useLang } from "./i18n";
import Loading from "./components/Loading";

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
    const on = () => {
      setHash(location.hash.replace(/^#/, "") || "/");
      window.scrollTo(0, 0); // a new page should start at its top, not wherever the last one left off
    };
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

// Shown for the shared demo account (DEMO_MODE): synthetic data only, and a way to wipe the demo engagement.
function DemoBanner({ onChange }: { onChange: () => void }) {
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
  const reset = () => {
    if (
      !confirm(
        t(
          "รีเซ็ตเดโม: ลบไฟล์และผลการตรวจของ Engagement เดโมทั้งหมดแล้วเริ่มใหม่ ทุกคนที่ใช้เดโมร่วมกันจะเห็นผลนี้ ต้องการดำเนินการต่อหรือไม่?",
          "Reset the demo: delete every file and result in the demo engagement and start over. Everyone sharing the demo will see this. Continue?",
        ),
      )
    )
      return;
    return run(async () => {
      const r = await api<{ engagement: { id: string } }>("api/auth/demo-reset", { method: "POST" });
      location.hash = `/e/${r.engagement.id}`;
    });
  };
  return (
    <div className="banner demo-banner" role="status">
      <p>
        <strong>{t("โหมดเดโม", "Demo mode")}</strong> ·{" "}
        {t(
          "ข้อมูลสมมติเท่านั้น ห้ามอัปโหลดเอกสารจริง ทุกคนที่เข้าเดโมใช้ Engagement เดียวกัน",
          "Synthetic data only, never upload real documents. Everyone in the demo shares one engagement.",
        )}
      </p>
      <div className="row">
        <button className="btn" disabled={busy} onClick={reset}>
          {t("รีเซ็ตเดโม", "Reset demo")}
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
        if (!d.current_run) return setError(t("ยังไม่มีผลการตรวจ ให้อัปโหลดเอกสารแล้วกดประมวลผลก่อน", "No results yet. Upload documents and run processing first."));
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
  if (!src) return <Loading />;
  return <Workspace source={src} back={<Back to={`#/e/${id}`} label="Engagement" />} />;
}

export default function App() {
  useLang(); // re-render everything when the language changes
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
  if (hash === "/demo" || new URLSearchParams(location.search).has("ws")) return <Workspace source={DEMO} back={<Back to="#/" label={t("หน้าหลัก", "Home")} />} />;
  if (me.state === "loading") return <Loading />;
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
    <header className="topbar">
      <a className="brand-link" href="#/">
        <span className="app-icon" aria-hidden>
          ✓
        </span>
        <span className="brand-name">AI Audit Concierge</span>
      </a>
      <nav className="topnav" aria-label={t("เมนู", "Menu")}>
        <a href="#/" aria-current={hash === "/" || hash.startsWith("/e/") ? "page" : undefined}>
          Engagement
        </a>
        <a href="#/files" aria-current={hash.startsWith("/files") ? "page" : undefined}>
          {t("ไฟล์", "Files")}
        </a>
        {user.firm_role === "admin" && (
          <a href="#/users" aria-current={hash === "/users" ? "page" : undefined}>
            {t("ผู้ใช้", "Users")}
          </a>
        )}
        {!user.demo && (
          <a href="#/account" aria-current={hash === "/account" ? "page" : undefined}>
            {t("รหัสผ่าน", "Password")}
          </a>
        )}
      </nav>
      <div className="row topbar-end">
        <LangToggle />
        <span className="avatar" title={user.name} aria-hidden>
          {user.initials}
        </span>
        <span className="who small">{user.name}</span>
        <button className="btn" onClick={logout}>
          {t("ออกจากระบบ", "Sign out")}
        </button>
      </div>
    </header>
  );

  const review = hash.match(/^\/e\/([a-f0-9]{12})\/review$/);
  if (review)
    return (
      <>
        {user.demo && <DemoBanner onChange={refresh} />}
        <EngagementReview id={review[1]} />
      </>
    );
  const eng = hash.match(/^\/e\/([a-f0-9]{12})$/);
  const files = hash.match(/^\/files(?:\/([a-f0-9]{12}))?$/);
  let page;
  if (eng) page = <EngagementPage id={eng[1]} />;
  else if (files) page = <Files engagement={files[1]} />;
  else if (hash === "/users" && user.firm_role === "admin") page = <Users me={user} />;
  else if (hash === "/account") page = <ChangePassword onDone={() => (location.hash = "/")} />;
  else page = <Engagements />;
  return (
    <div className="shell">
      {bar}
      {user.demo && <DemoBanner onChange={refresh} />}
      {page}
    </div>
  );
}
