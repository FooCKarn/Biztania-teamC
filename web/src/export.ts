import type { TrailEvent } from "./types";

// The full append-only log, one row per event, for the engagement file.
export function exportTrailCsv(runId: string, events: TrailEvent[]) {
  const head = ["ลำดับ", "เวลา (UTC)", "ผู้ลงนาม", "การกระทำ", "รายการ", "ผล", "เหตุผล", "หลักฐาน", "แฮชก่อนหน้า", "แฮช"];
  const rows = events.map((e) => [e.seq, e.at, e.actor, e.action, e.target, e.value ?? "", e.reason ?? "",
    e.evidence.map((x) => [x.doc, x.file, x.locator, x.sha256].filter(Boolean).join(" ")).join("; "), e.prev_hash, e.hash]);
  download([head, ...rows], `audit-trail-${runId}.csv`);
}

function download(table: (string | number)[][], name: string) {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = "﻿" + table.map((r) => r.map(cell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
