import type { ConflictMap } from "../types";
import { MATCH_LABEL, KIND_LABEL, RISK_LABEL, RISK_ORDER, fieldLabel } from "../labels";
import { locale, t as tr } from "../i18n";
import { buildXlsx, type Sheet } from "./xlsx";
import { when, type Report } from "./model";

// Working-paper workbook: a lead sheet, the flag schedule with sign-offs, an evidence index that
// ties every flag back to file + locator + quote, and (manager copy) pending matches and file hashes.
export function reportSheets(report: Report, data: ConflictMap): Sheet[] {
  const head = [
    report.title,
    `${tr("ลูกค้า", "Client")}: ${report.client}`,
    `Run: ${report.runId} · ${tr("จัดทำรายงาน", "Generated")}: ${when(report.generatedAt)} · Materiality ${report.materiality.toLocaleString(locale())} ฿ · Tolerance ${report.tolerancePct}%`,
    ...(report.synthetic ? [tr("ข้อมูลสมมติ (synthetic) ไม่มีข้อมูลลูกค้าจริง", "Synthetic data, no real client data")] : []),
    tr("ระบบชี้จุดที่ควรตรวจพร้อมหลักฐาน ผู้สอบบัญชีเป็นผู้ตัดสิน", "The system points out what to check, with evidence. The auditor decides."),
  ];
  const client = report.audience === "client";
  const t = report.totals;

  const lead: Sheet = {
    name: tr("สรุป", "Summary"),
    preamble: head,
    columns: [
      { header: tr("รายการ", "Item"), width: 34 },
      ...RISK_ORDER.map((r) => ({ header: RISK_LABEL[r], width: 14 })),
      { header: tr("รวม", "Total"), width: 16 },
    ],
    rows: [
      [client ? tr("ประเด็นที่พบ", "Issues found") : tr("รายการที่ควรตรวจ", "Items to check"), ...report.byRisk.map((r) => r.total), t.flags],
      ...(client
        ? []
        : [
            [tr("ตรวจสอบแล้ว", "Checked"), ...report.byRisk.map((r) => r.checked), t.checked],
            [tr("สรุปว่าเป็นประเด็น", "Concluded as issue"), ...report.byRisk.map((r) => r.issues), t.issues],
          ]),
      [tr("ยอดที่เกี่ยวข้อง (บาท)", "Amount at stake (THB)"), ...report.byRisk.map((r) => r.atStake), report.byRisk.reduce((s, r) => s + r.atStake, 0)],
      ...(client
        ? []
        : [
            [tr("สรุปว่าไม่เป็นประเด็น", "Concluded not an issue"), "", "", "", t.notIssues],
            [tr("รอจับคู่ (ยังไม่นำไปตรวจ)", "Unmatched (not yet checked)"), "", "", "", t.pending],
            [tr("ตรวจสอบโดย", "Checked by"), "", "", "", report.checkedBy.join(", ") || "-"],
            [tr("ลงนามยืนยันผลโดย", "Signed off by"), "", "", "", report.signoff ? `${report.signoff.by} · ${when(report.signoff.at)}` : "-"],
          ]),
    ],
  };

  const schedule: Sheet = {
    name: client ? tr("ประเด็น", "Issues") : tr("รายการควรตรวจ", "To check"),
    preamble: head.slice(0, 2),
    columns: [
      { header: tr("อ้างอิง", "Ref"), width: 9 },
      { header: tr("ความเสี่ยง", "Risk"), width: 10 },
      { header: tr("ประเภท", "Type"), width: 18 },
      { header: tr("ประเด็น", "Issues"), width: 34 },
      { header: tr("รายละเอียด", "Details"), width: 60 },
      { header: tr("ยอดที่เกี่ยวข้อง (บาท)", "Amount at stake (THB)"), width: 16, money: true },
      { header: tr("เอกสาร", "Document"), width: 24 },
      ...(client
        ? [{ header: tr("คำถามที่ขอคำชี้แจง", "Questions for the client"), width: 50 }]
        : [
            { header: tr("สถานะ", "Status"), width: 18 },
            { header: tr("ผลการพิจารณา", "Conclusion"), width: 14 },
            { header: tr("เหตุผล", "Reason"), width: 44 },
            { header: tr("ตรวจสอบโดย", "Checked by"), width: 9 },
            { header: tr("วันที่ตรวจสอบ", "Checked on"), width: 18 },
          ]),
    ],
    rows: report.flags.map((r) => [
      r.ref,
      RISK_LABEL[r.flag.risk],
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
          ]),
    ]),
  };

  const evidence: Sheet = {
    name: tr("หลักฐาน", "Evidence"),
    preamble: head.slice(0, 2),
    columns: [
      { header: tr("อ้างอิง", "Ref"), width: 9 },
      { header: tr("เอกสาร", "Document"), width: 16 },
      { header: tr("ไฟล์", "File"), width: 24 },
      { header: tr("ตำแหน่ง", "Location"), width: 18 },
      { header: tr("ช่อง", "Field"), width: 22 },
      { header: tr("ค่า", "Value"), width: 24 },
      { header: tr("ข้อความต้นฉบับ", "Source text"), width: 70 },
    ],
    rows: report.flags.flatMap((r) =>
      r.flag.evidence.map((e) => [r.ref, e.doc, e.file, e.locator, fieldLabel(e.field), e.value, e.quote]),
    ),
  };

  if (client) return [lead, schedule, evidence];

  const pending: Sheet = {
    name: tr("รอจับคู่", "Unmatched"),
    preamble: head.slice(0, 2),
    columns: [
      { header: tr("เอกสาร", "Document"), width: 16 },
      { header: tr("ประเภท", "Type"), width: 12 },
      { header: tr("เหตุผล", "Reason"), width: 60 },
      { header: tr("ตัวเลือก", "Candidates"), width: 30 },
    ],
    rows: data.pending.map((p) => [p.doc, KIND_LABEL[p.kind], p.why, p.candidates.join(", ")]),
  };

  const files: Sheet = {
    name: tr("ไฟล์", "File"),
    preamble: head.slice(0, 2),
    columns: [
      { header: tr("ไฟล์", "File"), width: 30 },
      { header: tr("อ่านได้", "Readable"), width: 10 },
      { header: "SHA-256", width: 70 },
      { header: tr("เอกสาร", "Document"), width: 30 },
      { header: tr("การจับคู่", "Matching"), width: 22 },
    ],
    rows: data.files.map((f) => {
      const docs = data.documents.filter((d) => d.file === f.file);
      return [
        f.file,
        f.read ? tr("อ่านแล้ว", "Read") : tr("อ่านไม่ได้", "Unreadable"),
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
