import type { ConflictMap } from "../types";

// Why the page may look empty: files the pipeline could not read, with its reason, and the table layouts it accepts.
export default function ReadProblems({ data }: { data: ConflictMap }) {
  const bad = data.coverage.unreadable_files;
  const empty = data.documents.length === 0;
  if (!bad.length && !empty) return null;
  const why = data.coverage.unreadable_reasons ?? {};
  return (
    <div className="banner" role="alert">
      <strong>{empty ? "ไม่พบเอกสารที่อ่านได้จากไฟล์ที่อัปโหลด" : `อ่านไม่ได้ ${bad.length} ไฟล์`}</strong>
      {bad.length > 0 && (
        <ul className="small">
          {bad.map((f) => (
            <li key={f}>
              <b>{f}</b>: {why[f] ?? "อ่านไม่ได้"}
            </li>
          ))}
        </ul>
      )}
      {empty && (
        <p className="small">
          CSV ที่รับ (หัวคอลัมน์ในแถวแรก ภาษาอังกฤษตามนี้): ใบสั่งซื้อ <code>po_no, po_date, vendor_code, vendor_name, description, amount_excl_vat, approved_by, approver_role</code> · รายการเดินบัญชี{" "}
          <code>date, description, withdrawal, counterparty_account</code> · Vendor master <code>vendor_code, name_th, name_en, tax_id, bank_account</code> · Excel ใบรับของต้องมีคอลัมน์ "อ้างอิง PO" · ใบกำกับภาษี สัญญา และนโยบายเป็น PDF หรือรูปที่อ่านข้อความได้
        </p>
      )}
    </div>
  );
}
