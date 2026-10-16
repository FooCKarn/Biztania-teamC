import type { ConflictMap, Decision } from "./types";
import { TYPE_LABEL } from "./labels";

// Working papers live in Excel: one row per flag with the auditor's sign-off, UTF-8 with BOM so
// Excel opens Thai text correctly.
export function exportCsv(data: ConflictMap, decisions: Record<string, Decision>) {
  const head = ["อ้างอิง", "ความเสี่ยง", "ประเภท", "ประเด็น", "รายละเอียด", "ยอดที่เกี่ยวข้อง (บาท)", "เอกสาร",
    "ผลการพิจารณา", "เหตุผล", "ผู้จัดทำ", "วันที่จัดทำ", "ผู้สอบทาน", "วันที่สอบทาน"];
  const rows = data.flags.map((f) => {
    const d = decisions[f.id];
    return [f.id, f.risk, TYPE_LABEL[f.type] ?? f.type, f.title, f.summary, f.at_stake_thb ?? "", f.docs.join("; "),
      d ? (d.verdict === "issue" ? "เป็นประเด็น" : "ไม่เป็นประเด็น") : "ยังไม่ลงนาม", d?.reason ?? "", d?.by ?? "", d?.at ?? "",
      d?.review?.by ?? "", d?.review?.at ?? ""];
  });
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `working-paper-${data.run_id}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
