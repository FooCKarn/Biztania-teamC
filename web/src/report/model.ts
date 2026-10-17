import type { ConflictMap, Decision, Flag, Risk, Signoff } from "../types";
import { RISK_ORDER, TYPE_LABEL, fieldLabel } from "../labels";
import { bi, locale, t } from "../i18n";

// One model feeds both the printable report (PDF) and the Word export, so the two never disagree.

/** manager: every flag with its sign-off state. client: only flags from a signed-off run, checked as an issue, no internal notes. */
export type Audience = "manager" | "client";

export type FlagState = "open" | "checked";

export interface ReportFlag {
  ref: string;
  flag: Flag;
  typeLabel: string;
  state: FlagState;
  stateLabel: string;
  verdictLabel: string;
  decision?: Decision;
  evidence: string[];
}

export interface Report {
  audience: Audience;
  title: string;
  client: string;
  runId: string;
  synthetic: boolean;
  generatedAt: string;
  materiality: number;
  tolerancePct: number;
  totals: { flags: number; checked: number; issues: number; notIssues: number; pending: number };
  byRisk: { risk: Risk; total: number; checked: number; issues: number; atStake: number }[];
  flags: ReportFlag[];
  /** Initials gathered from the flags, of whoever checked each one. */
  checkedBy: string[];
  /** The one engagement-level sign-off, if it has happened yet. */
  signoff: Signoff | null;
}

const STATE_LABEL = bi<FlagState>({
  open: ["ยังไม่ตรวจสอบ", "Not yet checked"],
  checked: ["ตรวจสอบแล้ว", "Checked"],
});

export const verdictLabel = (d?: Decision) =>
  !d ? "-" : d.verdict === "issue" ? t("เป็นประเด็น", "Issue") : t("ไม่เป็นประเด็น", "Not an issue");

export const evidenceRef = (e: Flag["evidence"][number]) =>
  `${e.doc} · ${fieldLabel(e.field)}: “${e.quote}” (${e.file}, ${e.locator})`;

export const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }) : "-";

const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();

export function buildReport(data: ConflictMap, decisions: Record<string, Decision>, signoff: Signoff | null, audience: Audience): Report {
  const all: ReportFlag[] = [...data.flags]
    .sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk) || b.severity - a.severity || a.id.localeCompare(b.id))
    .map((f) => {
      const d = decisions[f.id];
      const state: FlagState = d ? "checked" : "open";
      return {
        ref: f.id,
        flag: f,
        typeLabel: TYPE_LABEL[f.type] ?? f.type,
        state,
        stateLabel: STATE_LABEL[state],
        verdictLabel: verdictLabel(d),
        decision: d,
        evidence: f.evidence.map(evidenceRef),
      };
    });

  // The client only sees findings from a signed-off run, checked as an issue: an unsigned-off
  // "ควรตรวจ" is not a conclusion yet and must not leave the firm.
  const flags = audience === "client" ? (signoff ? all.filter((r) => r.state === "checked" && r.decision?.verdict === "issue") : []) : all;

  const byRisk = RISK_ORDER.map((risk) => {
    const xs = flags.filter((r) => r.flag.risk === risk);
    return {
      risk,
      total: xs.length,
      checked: xs.filter((r) => r.state === "checked").length,
      issues: xs.filter((r) => r.decision?.verdict === "issue").length,
      atStake: xs.reduce((s, r) => s + (r.flag.at_stake_thb ?? 0), 0),
    };
  });

  return {
    audience,
    title:
      audience === "client"
        ? t("รายงานประเด็นจากการตรวจสอบ", "Audit findings report")
        : t("สรุปกระดาษทำการ: รายการที่ควรตรวจ", "Working paper summary: items to check"),
    client: data.engagement.client,
    runId: data.run_id,
    synthetic: data.engagement.synthetic,
    generatedAt: new Date().toISOString(),
    materiality: data.engagement.materiality_thb,
    tolerancePct: data.engagement.tolerance_pct,
    totals: {
      flags: flags.length,
      checked: flags.filter((r) => r.state === "checked").length,
      issues: flags.filter((r) => r.decision?.verdict === "issue").length,
      notIssues: flags.filter((r) => r.decision?.verdict === "not_issue").length,
      pending: data.pending.length,
    },
    byRisk,
    flags,
    checkedBy: uniq(flags.map((r) => r.decision?.by)),
    signoff,
  };
}
