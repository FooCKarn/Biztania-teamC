import type { Kind, MatchLevel, Risk } from "./types";
import { bi, locale, t } from "./i18n";

export const KIND_LABEL = bi<Kind>({
  po: ["PO", "PO"],
  gr: ["ใบรับของ", "Goods receipt"],
  invoice: ["Invoice", "Invoice"],
  payment: ["รายการโอน", "Payment"],
  vendor: ["Vendor", "Vendor"],
  contract: ["สัญญา", "Contract"],
  policy: ["นโยบาย", "Policy"],
});

export const KIND_ORDER: Kind[] = ["po", "gr", "invoice", "payment"];

export const MATCH_LABEL = bi<MatchLevel>({
  sure: ["จับคู่จากเลขอ้างอิง", "Matched by reference"],
  likely: ["จับคู่โดยอนุมาน", "Inferred match"],
  pending: ["รอจับคู่", "Awaiting match"],
  none: ["ไม่พบคู่", "No match"],
});

// Risk values come from the pipeline in Thai; these are the display names.
export const RISK_ORDER: Risk[] = ["สูง", "กลาง", "ต่ำ"];
export const RISK_LABEL = bi<Risk>({ สูง: ["สูง", "High"], กลาง: ["กลาง", "Medium"], ต่ำ: ["ต่ำ", "Low"] });
export const riskText = (r: Risk) => t(`เสี่ยง${r}`, `${RISK_LABEL[r]} risk`);

export const TYPE_LABEL: Record<string, string> = bi({
  VALUE_MISMATCH: ["ยอดเงินไม่ตรง", "Amount mismatch"],
  PARTY_MISMATCH: ["คู่ค้า/บัญชีไม่ตรง", "Party / account mismatch"],
  DATE_ORDER: ["ลำดับวันที่ผิด", "Dates out of order"],
  MISSING_LINK: ["เอกสารที่ควรมีหาไม่พบ", "Missing document"],
  POLICY_BREACH: ["ขัดกฎบริษัท", "Company rule breach"],
  DUPLICATE: ["อาจซ้ำ", "Possible duplicate"],
  TEXT_CONFLICT: ["เงื่อนไขไม่ตรงกัน", "Conflicting terms"],
  CONTRACT_BREACH: ["ไม่เป็นไปตามสัญญา", "Not per contract"],
});

export const FIELD_LABEL: Record<string, string> = bi({
  invoice_no: ["เลขที่ Invoice", "Invoice no."],
  po_no: ["เลขที่ PO", "PO no."],
  gr_no: ["เลขที่ใบรับของ", "GR no."],
  contract_no: ["เลขที่สัญญา", "Contract no."],
  date: ["วันที่", "Date"],
  vendor_name: ["ชื่อผู้ขาย", "Vendor name"],
  vendor_code: ["รหัส vendor", "Vendor code"],
  tax_id: ["เลขผู้เสียภาษี", "Tax ID"],
  po_ref: ["อ้างอิง PO", "PO reference"],
  invoice_ref: ["อ้างอิง Invoice", "Invoice reference"],
  subtotal: ["รวมเงิน (ก่อน VAT)", "Subtotal (excl. VAT)"],
  vat: ["VAT", "VAT"],
  total: ["ยอดรวมทั้งสิ้น", "Total"],
  amount: ["ยอดเงิน", "Amount"],
  credit_days: ["เครดิต (วัน)", "Credit (days)"],
  description: ["รายละเอียด", "Description"],
  approved_by: ["ผู้อนุมัติ", "Approved by"],
  approver_role: ["ตำแหน่งผู้อนุมัติ", "Approver role"],
  account: ["บัญชี (ปิดบังบางส่วน)", "Account (masked)"],
  item: ["รายการสินค้า", "Item"],
  quantity: ["จำนวน", "Quantity"],
  unit_price: ["ราคาต่อหน่วย", "Unit price"],
  start_date: ["วันเริ่มสัญญา", "Contract start"],
  end_date: ["วันสิ้นสุดสัญญา", "Contract end"],
  ceiling: ["วงเงินสัญญา", "Contract ceiling"],
  policy_no: ["เลขที่นโยบาย", "Policy no."],
  name_th: ["ชื่อ (ไทย)", "Name (Thai)"],
  name_en: ["ชื่อ (อังกฤษ)", "Name (English)"],
});

// Contract price-list fields are named "price:<item>".
export const fieldLabel = (k: string) =>
  FIELD_LABEL[k] ?? (k.startsWith("price:") ? t(`ราคาต่อหน่วยตามสัญญา (${k.slice(6)})`, `Contract unit price (${k.slice(6)})`) : k);

export const baht = (n: number | null | undefined) =>
  n == null ? "-" : n.toLocaleString(locale(), { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " ฿";
