import { useCallback, useEffect, useState } from "react";
import type { Decision, TrailEvent } from "./types";

// The auditor's sign-offs and pair confirmations as an append-only Audit Trail.
// With the Worker's D1 store bound, /api/trail is the record and the server stamps time and evidence.
// Without it (e.g. `npm run dev` alone or static hosting) the same log is kept in this browser.

export type TrailAction =
  | { action: "prepare"; target: string; value: Decision["verdict"]; reason: string; actor: string }
  | { action: "review" | "unreview" | "reopen"; target: string; actor: string; reason?: string }
  | { action: "pair"; target: string; value: string; actor: string };

export interface Trail {
  mode: "loading" | "server" | "local";
  workspace: string;
  events: TrailEvent[];
  decisions: Record<string, Decision>;
  pairs: Record<string, string>;
  chainOk: boolean | null;
  /** Resolves to an error message, or null when the event was recorded. */
  act: (a: TrailAction) => Promise<string | null>;
}

// Each browser gets its own workspace so demo visitors do not see each other's sign-offs;
// open the page with ?ws=<name> to share one trail (e.g. preparer and reviewer on two laptops).
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
  for (const e of events) {
    if (e.action === "pair") pairs[e.target.replace(/^pair:/, "")] = e.value ?? "";
    else if (e.action === "prepare")
      decisions[e.target] = { verdict: e.value as Decision["verdict"], reason: e.reason ?? "", at: e.at, by: e.actor };
    else if (e.action === "review" && decisions[e.target]) decisions[e.target] = { ...decisions[e.target], review: { by: e.actor, at: e.at } };
    else if (e.action === "unreview" && decisions[e.target]) decisions[e.target] = { ...decisions[e.target], review: undefined };
    else if (e.action === "reopen") delete decisions[e.target];
  }
  return { decisions, pairs };
}

// Same state rules as the Worker, for the browser-only fallback.
function localCheck(a: TrailAction, decisions: Record<string, Decision>): string | null {
  const cur = decisions[a.target];
  if (a.action === "prepare" && cur) return "รายการนี้ลงนามผู้จัดทำแล้ว";
  if (a.action === "review" && !cur) return "ต้องให้ผู้จัดทำลงนามก่อน";
  if (a.action === "review" && cur.by === a.actor) return "ผู้สอบทานต้องไม่ใช่คนเดียวกับผู้จัดทำ";
  return null;
}

export function useTrail(runId: string): Trail {
  const [workspace] = useState(workspaceId);
  const [mode, setMode] = useState<Trail["mode"]>("loading");
  const [events, setEvents] = useState<TrailEvent[]>([]);
  const [chainOk, setChainOk] = useState<boolean | null>(null);
  const localKey = `ac-trail-${workspace}-${runId}`;

  useEffect(() => {
    if (runId === "none") return;
    let live = true;
    fetch(`api/trail?ws=${encodeURIComponent(workspace)}&run=${encodeURIComponent(runId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (!live) return;
        setEvents(b.events);
        setChainOk(b.chain_ok);
        setMode("server");
      })
      .catch(() => {
        if (!live) return;
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
  }, [workspace, runId, localKey]);

  const act = useCallback(
    async (a: TrailAction): Promise<string | null> => {
      if (mode === "server") {
        try {
          const r = await fetch("api/trail", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ws: workspace, run: runId, ...a }),
          });
          const b = await r.json();
          if (!r.ok) return b.error ?? `บันทึกไม่สำเร็จ (${r.status})`;
          setEvents((prev) => [...prev, b.event]);
          setChainOk(b.chain_ok);
          return null;
        } catch {
          return "เชื่อมต่อ server ไม่ได้ ยังไม่ได้บันทึก";
        }
      }
      const err = localCheck(a, replay(events).decisions);
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
    [mode, workspace, runId, events, localKey],
  );

  const { decisions, pairs } = replay(events);
  return { mode, workspace, events, decisions, pairs, chainOk, act };
}
