import { useState } from "react";
import type { Trail } from "../decisions";
import { SIGNOFF_TARGET } from "../decisions";
import { when } from "../api";
import { t } from "../i18n";

interface Props {
  trail: Trail;
  total: number;
  checked: number;
}

const INITIALS_KEY = "ac-initials";
function loadInitials() {
  try {
    return localStorage.getItem(INITIALS_KEY) ?? "";
  } catch {
    return "";
  }
}

// The one engagement-level sign-off: once every flagged item has been checked, the auditor signs
// off the whole set in a single step (no separate preparer/reviewer pass per item).
export default function SignoffBar({ trail, total, checked }: Props) {
  const [initials, setInitials] = useState(loadInitials);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = !!trail.actor;
  const who = (trail.actor ?? initials).trim().toUpperCase();
  const locked = !!trail.readOnly;
  const ready = checked >= total && total > 0;

  const remember = (v: string) => {
    setInitials(v);
    try {
      localStorage.setItem(INITIALS_KEY, v);
    } catch {
      /* storage blocked: initials last for this page view */
    }
  };
  const run = async (action: "signoff" | "unsignoff") => {
    setBusy(true);
    setError(await trail.act({ action, target: SIGNOFF_TARGET, actor: who }));
    setBusy(false);
  };

  if (trail.signoff)
    return (
      <div className="signoff-bar done">
        <span className="pill ok">{t("ลงนามยืนยันผลแล้ว", "Signed off")}</span>
        <span className="muted small">
          {trail.signoff.by} · {when(trail.signoff.at)}
        </span>
        <button className="link" disabled={busy || locked} onClick={() => run("unsignoff")}>
          {t("ยกเลิก", "Undo")}
        </button>
        {error && <span className="small error">{error}</span>}
      </div>
    );

  return (
    <div className="signoff-bar">
      <span className="meter" title={t("ตรวจสอบแล้ว", "Checked")}>
        <span>
          {t("ตรวจสอบแล้ว", "Checked")} <b>{checked}</b>/{total}
        </span>
        <span className="meter-track" aria-hidden>
          <span className="meter-fill" style={{ width: `${total ? (checked / total) * 100 : 0}%` }} />
        </span>
      </span>
      {!signedIn && (
        <input
          value={initials}
          onChange={(e) => remember(e.target.value)}
          maxLength={4}
          placeholder={t("ชื่อย่อ", "Initials")}
          aria-label={t("ชื่อย่อผู้ลงนาม", "Signer initials")}
          className="signoff-initials"
        />
      )}
      <button className="btn filled" disabled={!ready || who.length < 2 || busy || locked} onClick={() => run("signoff")}>
        {t("ลงนามยืนยันผล", "Sign off")}
      </button>
      {!ready && <span className="muted small">{t("ตรวจสอบให้ครบทุกจุดก่อนลงนาม", "Check every item before signing off")}</span>}
      {error && <span className="small error">{error}</span>}
    </div>
  );
}
