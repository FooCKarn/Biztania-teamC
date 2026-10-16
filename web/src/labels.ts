import type { Kind, MatchLevel, Risk } from "./types";

export const KIND_LABEL: Record<Kind, string> = {
  po: "PO",
  gr: "ใบรับของ",
  invoice: "Invoice",
  payment: "รายการโอน",
  vendor: "Vendor",
  contract: "สัญญา",
  policy: "นโยบาย",
};

export const KIND_ORDER: Kind[] = ["po", "gr", "invoice", "payment"];

export const MATCH_LABEL: Record<MatchLevel, string> = {
  sure: "จับคู่จากเลขอ้างอิง",
  likely: "จับคู่โดยอนุมาน",
  pending: "รอจับคู่",
  none: "ไม่พบคู่",
};

export const RISK_ORDER: Risk[] = ["สูง", "กลาง", "ต่ำ"];

export const TYPE_LABEL: Record<string, string> = {
  VALUE_MISMATCH: "ยอดเงินไม่ตรง",
  PARTY_MISMATCH: "คู่ค้า/บัญชีไม่ตรง",
  DATE_ORDER: "ลำดับวันที่ผิด",
  MISSING_LINK: "เอกสารที่ควรมีหาไม่พบ",
  POLICY_BREACH: "ขัดกฎบริษัท",
  DUPLICATE: "อาจซ้ำ",
  TEXT_CONFLICT: "เงื่อนไขไม่ตรงกัน",
};

export const FIELD_LABEL: Record<string, string> = {
  invoice_no: "เลขที่ Invoice",
  po_no: "เลขที่ PO",
  gr_no: "เลขที่ใบรับของ",
  contract_no: "เลขที่สัญญา",
  date: "วันที่",
  vendor_name: "ชื่อผู้ขาย",
  vendor_code: "รหัส vendor",
  tax_id: "เลขผู้เสียภาษี",
  po_ref: "อ้างอิง PO",
  invoice_ref: "อ้างอิง Invoice",
  subtotal: "รวมเงิน (ก่อน VAT)",
  vat: "VAT",
  total: "ยอดรวมทั้งสิ้น",
  amount: "ยอดเงิน",
  credit_days: "เครดิต (วัน)",
  description: "รายละเอียด",
  approved_by: "ผู้อนุมัติ",
  approver_role: "ตำแหน่งผู้อนุมัติ",
  account: "บัญชี (ปิดบังบางส่วน)",
};

export const baht = (n: number | null | undefined) =>
  n == null ? "-" : n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " ฿";
