import type { ConflictMap } from "../types";
import { MATCH_LABEL, KIND_LABEL, fieldLabel } from "../labels";
import { buildXlsx, type Sheet } from "./xlsx";
import { when, type Report } from "./model";

// Working-paper workbook: a lead sheet, the flag schedule with sign-offs, an evidence index that
// ties every flag back to file + locator + quote, and (manager copy) pending matches and file hashes.
export function reportSheets(report: Report, data: ConflictMap): Sheet[] {
  const head = [
    report.title,
    `ลูกค้า: ${report.client}`,
    `Run: ${report.runId} · จัดทำรายงาน: ${when(report.generatedAt)} · Materiality ${report.materiality.toLocaleString("th-TH")} ฿ · Tolerance ${report.tolerancePct}%`,
    ...(report.synthetic ? ["ข้อมูลสมมติ (synthetic) ไม่มีข้อมูลลูกค้าจริง"] : []),
    "ระบบชี้จุดที่ควรตรวจพร้อมหลักฐาน ผู้สอบบัญชีเป็นผู้ตัดสิน",
  ];
  const client = report.audience === "client";
  const t = report.totals;

  const lead: Sheet = {
    name: "สรุป",
    preamble: head,
    columns: [
      { header: "รายการ", width: 34 },
      { header: "สูง", width: 14 },
      { header: "กลาง", width: 14 },
      { header: "ต่ำ", width: 14 },
      { header: "รวม", width: 16 },
    ],
    rows: [
      [client ? "ประเด็นที่พบ" : "รายการที่ควรตรวจ", ...report.byRisk.map((r) => r.total), t.flags],
      ...(client
        ? []
        : [
            ["สอบทานแล้ว", ...report.byRisk.map((r) => r.reviewed), t.reviewed],
            ["สรุปว่าเป็นประเด็น", ...report.byRisk.map((r) => r.issues), t.issues],
          ]),
      ["ยอดที่เกี่ยวข้อง (บาท)", ...report.byRisk.map((r) => r.atStake), report.byRisk.reduce((s, r) => s + r.atStake, 0)],
      ...(client
        ? []
        : [
            ["จัดทำแล้ว", "", "", "", t.prepared],
            ["สรุปว่าไม่เป็นประเด็น", "", "", "", t.notIssues],
            ["รอจับคู่ (ยังไม่นำไปตรวจ)", "", "", "", t.pending],
            ["ผู้จัดทำ", "", "", "", report.preparers.join(", ") || "-"],
            ["ผู้สอบทาน", "", "", "", report.reviewers.join(", ") || "-"],
          ]),
    ],
  };

  const schedule: Sheet = {
    name: client ? "ประเด็น" : "รายการควรตรวจ",
    preamble: head.slice(0, 2),
    columns: [
      { header: "อ้างอิง", width: 9 },
      { header: "ความเสี่ยง", width: 10 },
      { header: "ประเภท", width: 18 },
      { header: "ประเด็น", width: 34 },
      { header: "รายละเอียด", width: 60 },
      { header: "ยอดที่เกี่ยวข้อง (บาท)", width: 16, money: true },
      { header: "เอกสาร", width: 24 },
      ...(client
        ? [{ header: "คำถามที่ขอคำชี้แจง", width: 50 }]
        : [
            { header: "สถานะ", width: 18 },
            { header: "ผลการพิจารณา", width: 14 },
            { header: "เหตุผล", width: 44 },
            { header: "ผู้จัดทำ", width: 9 },
            { header: "วันที่จัดทำ", width: 18 },
            { header: "ผู้สอบทาน", width: 9 },
            { header: "วันที่สอบทาน", width: 18 },
          ]),
    ],
    rows: report.flags.map((r) => [
      r.ref,
      r.flag.risk,
      r.typeLabel,
      r.flag.title,
      r.flag.summary,
      r.flag.at_stake_thb,
      r.flag.docs.join(", "),
      ...(client
        ? [r.flag.questions.join("\n")]
        : [
            r.stateLabel,
            r.verdictLabel,
            r.decision?.reason ?? "",
            r.decision?.by ?? "",
            r.decision ? when(r.decision.at) : "",
            r.decision?.review?.by ?? "",
            r.decision?.review ? when(r.decision.review.at) : "",
          ]),
    ]),
  };

  const evidence: Sheet = {
    name: "หลักฐาน",
    preamble: head.slice(0, 2),
    columns: [
      { header: "อ้างอิง", width: 9 },
      { header: "เอกสาร", width: 16 },
      { header: "ไฟล์", width: 24 },
      { header: "ตำแหน่ง", width: 18 },
      { header: "ช่อง", width: 22 },
      { header: "ค่า", width: 24 },
      { header: "ข้อความต้นฉบับ", width: 70 },
    ],
    rows: report.flags.flatMap((r) =>
      r.flag.evidence.map((e) => [r.ref, e.doc, e.file, e.locator, fieldLabel(e.field), e.value, e.quote]),
    ),
  };

  if (client) return [lead, schedule, evidence];

  const pending: Sheet = {
    name: "รอจับคู่",
    preamble: head.slice(0, 2),
    columns: [
      { header: "เอกสาร", width: 16 },
      { header: "ประเภท", width: 12 },
      { header: "เหตุผล", width: 60 },
      { header: "ตัวเลือก", width: 30 },
    ],
    rows: data.pending.map((p) => [p.doc, KIND_LABEL[p.kind], p.why, p.candidates.join(", ")]),
  };

  const files: Sheet = {
    name: "ไฟล์",
    preamble: head.slice(0, 2),
    columns: [
      { header: "ไฟล์", width: 30 },
      { header: "อ่านได้", width: 10 },
      { header: "SHA-256", width: 70 },
      { header: "เอกสาร", width: 30 },
      { header: "การจับคู่", width: 22 },
    ],
    rows: data.files.map((f) => {
      const docs = data.documents.filter((d) => d.file === f.file);
      return [
        f.file,
        f.read ? "อ่านแล้ว" : "อ่านไม่ได้",
        f.sha256 ?? "",
        docs.map((d) => d.id).join(", "),
        [...new Set(docs.map((d) => (d.link ? MATCH_LABEL[d.link.level] : "")).filter(Boolean))].join(", "),
      ];
    }),
  };

  return [lead, schedule, evidence, pending, files];
}

export function downloadWorkbook(report: Report, data: ConflictMap) {
  const bytes = buildXlsx(reportSheets(report, data));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
  );
  a.download = `working-paper-${report.audience}-${report.runId}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
