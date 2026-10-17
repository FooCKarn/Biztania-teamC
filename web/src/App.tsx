import { useCallback, useEffect, useState } from "react";
import Workspace from "./Workspace";
import { DEMO, engagementSource, type Source } from "./source";
import { api, type User, type EngagementDetail } from "./api";
import Login, { ChangePassword } from "./pages/Login";
import Engagements from "./pages/Engagements";
import EngagementPage from "./pages/EngagementPage";
import Users from "./pages/Users";

// Hash routes, so the static build works on any host:
//   #/demo                 public demo (synthetic sample, no login)
//   #/                     engagements of the signed-in user (or the login page)
//   #/e/<id>               one engagement: files, runs, team, activity
//   #/e/<id>/review        the review workspace on that engagement's latest results
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

type Me = { state: "loading" } | { state: "no-server" } | { state: "out"; setupNeeded: boolean } | { state: "in"; user: User };

const Back = ({ to, label }: { to: string; label: string }) => (
  <a className="back" href={to}>
    ‹ {label}
  </a>
);

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
        setMe(b.user ? { state: "in", user: b.user } : { state: "out", setupNeeded: b.setup_needed });
      })
      .catch(() => setMe({ state: "no-server" }));
  }, []);
  useEffect(refresh, [refresh]);

  // The public demo needs no account; old shared links (?ws=…) still open it.
  if (hash === "/demo" || new URLSearchParams(location.search).has("ws")) return <Workspace source={DEMO} back={<Back to="#/" label="หน้าหลัก" />} />;
  if (me.state === "loading") return <div className="empty">กำลังโหลด…</div>;
  if (me.state === "no-server") return <Workspace source={DEMO} />; // static hosting: demo only
  if (me.state === "out") return <Login setupNeeded={me.setupNeeded} onDone={refresh} />;

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
        {user.firm_role === "admin" && (
          <a className="btn" href="#/users">
            ผู้ใช้
          </a>
        )}
        <a className="btn" href="#/account">
          รหัสผ่าน
        </a>
        <button className="btn" onClick={logout}>
          ออกจากระบบ
        </button>
      </div>
    </div>
  );

  const review = hash.match(/^\/e\/([a-f0-9]{12})\/review$/);
  if (review) return <EngagementReview id={review[1]} />;
  const eng = hash.match(/^\/e\/([a-f0-9]{12})$/);
  let page;
  if (eng) page = <EngagementPage id={eng[1]} me={user} />;
  else if (hash === "/users" && user.firm_role === "admin") page = <Users me={user} />;
  else if (hash === "/account") page = <ChangePassword onDone={() => (location.hash = "/")} />;
  else page = <Engagements />;
  return (
    <div className="shell">
      {bar}
      {page}
    </div>
  );
}
