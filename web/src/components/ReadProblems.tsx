import type { ConflictMap } from "../types";
import { t } from "../i18n";

// Files the pipeline could not read, and the table layouts it accepts.
export default function ReadProblems({ data }: { data: ConflictMap }) {
  const bad = data.coverage.unreadable_files;
  const empty = data.documents.length === 0;
  if (!bad.length && !empty) return null;
  const why = data.coverage.unreadable_reasons ?? {};
  return (
    <div className="banner" role="alert">
      <strong>
        {empty
          ? t("ไม่พบเอกสารที่อ่านได้จากไฟล์ที่อัปโหลด", "No readable documents in the uploaded files")
          : t(`อ่านไม่ได้ ${bad.length} ไฟล์`, `${bad.length} file(s) could not be read`)}
      </strong>
      {bad.length > 0 && (
        <ul className="small">
          {bad.map((f) => (
            <li key={f}>
              <b>{f}</b>: {why[f] ?? t("อ่านไม่ได้", "Unreadable")}
            </li>
          ))}
        </ul>
      )}
      {empty && (
        <p className="small">
          {t("CSV ที่รับ (หัวคอลัมน์ในแถวแรก ภาษาอังกฤษตามนี้): ใบสั่งซื้อ", "Accepted CSV (English headers in the first row): purchase orders")}{" "}
          <code>po_no, po_date, vendor_code, vendor_name, description, amount_excl_vat, approved_by, approver_role</code> ·{" "}
          {t("รายการเดินบัญชี", "bank statement")} <code>date, description, withdrawal, counterparty_account</code> · Vendor master{" "}
          <code>vendor_code, name_th, name_en, tax_id, bank_account</code> ·{" "}
          {t(
            'Excel ใบรับของต้องมีคอลัมน์ "อ้างอิง PO" · ใบกำกับภาษี สัญญา และนโยบายเป็น PDF หรือรูปที่อ่านข้อความได้',
            'Goods-receipt Excel needs an "อ้างอิง PO" column · Tax invoices, contracts and policies as PDF or legible images',
          )}
        </p>
      )}
    </div>
  );
}
