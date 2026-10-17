import { useCallback, useEffect, useState } from "react";
import type { Decision, Signoff, TrailEvent } from "./types";
import type { Source } from "./source";
import { t } from "./i18n";

// The auditor's sign-offs and pair confirmations as an append-only Audit Trail.
// With the Worker's D1 store bound, /api/trail is the record and the server stamps time and evidence.
// Without it (e.g. `npm run dev` alone or static hosting) the same log is kept in this browser.
// In an engagement the signer is the signed-in account (the server ignores any typed name). Every
// item just needs one "check"; once every item is checked, the whole run is signed off once.

/** Fixed target for the one engagement-level sign-off; never collides with a flag id. */
export const SIGNOFF_TARGET = "__engagement__";

export type TrailAction =
  | { action: "check"; target: string; value: Decision["verdict"]; reason: string; actor: string }
  | { action: "reopen"; target: string; actor: string; reason?: string }
  | { action: "pair"; target: string; value: string; actor: string }
  | { action: "signoff" | "unsignoff"; target: typeof SIGNOFF_TARGET; actor: string };

export interface Trail {
  mode: "loading" | "server" | "local";
  workspace: string;
  events: TrailEvent[];
  decisions: Record<string, Decision>;
  pairs: Record<string, string>;
  signoff: Signoff | null;
  chainOk: boolean | null;
  /** Engagements: the signed-in user's initials and role; the demo uses typed initials instead. */
  actor?: string;
  role?: string;
  readOnly?: boolean;
  /** Resolves to an error message, or null when the event was recorded. */
  act: (a: TrailAction) => Promise<string | null>;
}

// Each browser gets its own workspace so demo visitors do not see each other's sign-offs;
// open the page with ?ws=<name> to share one trail across devices.
function workspaceId() {
  const fromUrl = new URLSearchParams(location.search).get("ws")?.toLowerCase() ?? "";
  if (/^[a-z0-9-]{4,40}$/.test(fromUrl)) return fromUrl;
  try {
    let id = localStorage.getItem("ac-workspace");
    if (!id) {
      id = "demo-" + crypto.randomUUID().slice(0, 8);
      localStorage.setItem("ac-workspace", id);
    }
    return id;
  } catch {
    return "demo-" + crypto.randomUUID().slice(0, 8);
  }
}

export function replay(events: TrailEvent[]) {
  const decisions: Record<string, Decision> = {};
  const pairs: Record<string, string> = {};
  let signoff: Signoff | null = null;
  for (const e of events) {
    if (e.action === "pair") pairs[e.target.replace(/^pair:/, "")] = e.value ?? "";
    else if (e.action === "check") decisions[e.target] = { verdict: e.value as Decision["verdict"], reason: e.reason ?? "", at: e.at, by: e.actor };
    else if (e.action === "reopen") delete decisions[e.target];
    else if (e.action === "signoff") signoff = { by: e.actor, at: e.at };
    else if (e.action === "unsignoff") signoff = null;
  }
  return { decisions, pairs, signoff };
}

// Same state rules as the Worker, for the browser-only fallback.
function localCheck(a: TrailAction, decisions: Record<string, Decision>, signoff: Signoff | null, totalFlags: number): string | null {
  const cur = decisions[a.target];
  if (a.action === "signoff") {
    if (signoff) return t("ลงนามยืนยันผลแล้ว", "Already signed off");
    if (Object.keys(decisions).length < totalFlags) return t("ยังตรวจสอบไม่ครบทุกจุด", "Not every item has been checked yet");
    return null;
  }
  if (a.action === "unsignoff") return signoff ? null : t("ยังไม่ได้ลงนามยืนยันผล", "Not signed off yet");
  if (signoff) return t("ลงนามยืนยันผลแล้ว ต้องยกเลิกการลงนามก่อนจึงจะแก้ไขรายการได้", "Already signed off; undo the sign-off before editing items");
  if (a.action === "check" && cur) return t("รายการนี้ตรวจสอบแล้ว", "This item is already checked");
  return null;
}

export function useTrail(runId: string, source?: Source, totalFlags = 0): Trail {
  const eng = source?.engagement;
  const isEng = !!eng;
  const [demoWorkspace] = useState(workspaceId);
  const workspace = eng ? `eng-${eng.id}` : demoWorkspace;
  const [mode, setMode] = useState<Trail["mode"]>("loading");
  const [events, setEvents] = useState<TrailEvent[]>([]);
  const [chainOk, setChainOk] = useState<boolean | null>(null);
  const [who, setWho] = useState<{ actor?: string; role?: string }>({});
  const localKey = `ac-trail-${workspace}-${runId}`;
  const url = eng
    ? `api/engagements/${eng.id}/trail?run=${encodeURIComponent(runId)}`
    : `api/trail?ws=${encodeURIComponent(workspace)}&run=${encodeURIComponent(runId)}`;

  useEffect(() => {
    if (runId === "none") return;
    let live = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (!live) return;
        setEvents(b.events);
        setChainOk(b.chain_ok);
        setWho({ actor: b.actor, role: b.role });
        setMode("server");
      })
      .catch(() => {
        if (!live) return;
        if (isEng) {
          // Never fall back to browser storage for a real engagement: the server is the record.
          setEvents([]);
          setMode("local");
          return;
        }
        try {
          setEvents(JSON.parse(localStorage.getItem(localKey) || "[]"));
        } catch {
          setEvents([]);
        }
        setMode("local");
      });
    return () => {
      live = false;
    };
  }, [url, runId, localKey, isEng]);

  const act = useCallback(
    async (a: TrailAction): Promise<string | null> => {
      if (mode === "server") {
        try {
          const r = await fetch(isEng ? url : "api/trail", {
            method: "POST",
            headers: { "content-type": "application/json", ...(isEng && { "x-ac-csrf": "1" }) },
            body: JSON.stringify({ ws: workspace, run: runId, ...a }),
          });
          const b = await r.json();
          if (!r.ok) return b.error ?? `${t("บันทึกไม่สำเร็จ", "Not saved")} (${r.status})`;
          setEvents((prev) => [...prev, b.event]);
          setChainOk(b.chain_ok);
          return null;
        } catch {
          return t("เชื่อมต่อ server ไม่ได้ ยังไม่ได้บันทึก", "Cannot reach the server, nothing was saved");
        }
      }
      if (isEng) return t("ยังเชื่อมต่อ Audit Trail ไม่ได้ จึงยังไม่ได้บันทึก", "The Audit Trail is not reachable yet, nothing was saved");
      const replayed = replay(events);
      const err = localCheck(a, replayed.decisions, replayed.signoff, totalFlags);
      if (err) return err;
      const e: TrailEvent = {
        run_id: runId,
        seq: events.length + 1,
        at: new Date().toISOString(),
        actor: a.actor,
        action: a.action,
        target: a.target,
        value: "value" in a ? a.value : null,
        reason: ("reason" in a && a.reason) || null,
        evidence: [],
        prev_hash: "",
        hash: "",
      };
      const next = [...events, e];
      setEvents(next);
      try {
        localStorage.setItem(localKey, JSON.stringify(next));
      } catch {
        /* storage blocked: the log lives only for this page view */
      }
      return null;
    },
    [mode, workspace, runId, events, localKey, isEng, url, totalFlags],
  );

  const { decisions, pairs, signoff } = replay(events);
  return { mode, workspace, events, decisions, pairs, signoff, chainOk, act, ...who, readOnly: !!eng?.closed };
}
