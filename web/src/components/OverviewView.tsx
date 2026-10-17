import type { ConflictMap, Doc } from "../types";
import { MATCH_LABEL, TYPE_LABEL } from "../labels";
import { t } from "../i18n";
import TxnChain from "./TxnChain";

interface Props {
  data: ConflictMap;
  docs: Map<string, Doc>;
  openTxn: (id: string) => void;
}

const vendorName = (v?: ConflictMap["vendors"][number]) => v && (t(v.name_th, v.name_en) || v.name_th);

export default function OverviewView({ data, docs, openTxn }: Props) {
  const cov = data.coverage;
  const skipped = cov.skipped_checks ?? [];
  const sorted = [...data.transactions].sort((a, b) => b.flags.length - a.flags.length || a.id.localeCompare(b.id));
  return (
    <div className="stack">
      <div className="stats">
        <div className="stat">
          <b>{cov.files}</b>
          {t("ไฟล์ที่อ่าน", "Files read")}
        </div>
        <div className="stat">
          <b>{data.transactions.length}</b>
          {t("ธุรกรรม", "Transactions")}
        </div>
        <div className="stat">
          <b>{data.flags.length}</b>
          {t("จุดที่ควรตรวจ", "To check")}
        </div>
        <div className="stat">
          <b>{data.pending.length}</b>
          {t("รอจับคู่", "Unmatched")}
        </div>
        <div className="stat">
          <b>{cov.unclear_fields.length}</b>
          {t("ช่องอ่านไม่ชัด", "Unclear fields")}
        </div>
        <div className="stat">
          <b>{cov.unreadable_files.length}</b>
          {t("ไฟล์อ่านไม่ได้", "Unreadable files")}
        </div>
        <div className="stat">
          <b>{skipped.length}</b>
          {t("จุดที่ตรวจไม่ได้", "Checks skipped")}
        </div>
      </div>

      <div className="card">
        <h3>{t("ทุกธุรกรรม", "All transactions")}</h3>
        <div className="txn-grid">
          {sorted.map((x) => (
            <button key={x.id} className="txn-tile" onClick={() => openTxn(x.id)}>
              <span className="row between">
                <strong>{x.id.replace(/^T-/, "")}</strong>
                <span className={x.flags.length ? "tag bad" : x.pending ? "tag warn" : "tag ok"}>
                  {x.flags.length ? `${t("ควรตรวจ", "To check")} ${x.flags.length}` : x.pending ? t("รอจับคู่", "Unmatched") : t("ไม่พบจุดขัดแย้ง", "No conflicts")}
                </span>
              </span>
              <span className="muted small">
                {vendorName(data.vendors.find((v) => v.code === x.vendor)) ?? t("ไม่ทราบ vendor", "Unknown vendor")} · {MATCH_LABEL[x.match]}
              </span>
              <TxnChain txn={x} docs={docs} flags={data.flags} compact />
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>{t("กฎของบริษัทที่ใช้ (Remember)", "Company rules applied (Remember)")}</h3>
        <ul>
          {data.rules.map((r) => (
            <li key={r.id}>
              <strong>{r.id}</strong> “{r.source_quote}” <span className="muted small">({r.source_doc})</span>{" "}
              {r.verified ? (
                <span className="tag ok">{t("พบในเอกสาร", "Found in document")}</span>
              ) : (
                <span className="tag bad">{t("ไม่พบ ไม่นำไปใช้", "Not found, not applied")}</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {cov.unclear_fields.length > 0 && (
        <div className="card">
          <h3>{t("ช่องที่อ่านไม่ชัด (ไม่ใช้ยกประเด็น)", "Unclear fields (never used to raise a flag)")}</h3>
          <ul>
            {cov.unclear_fields.map((u) => (
              <li key={u.doc + u.field}>
                {u.doc} · {u.field} · “{u.quote}” <span className="muted small">{u.locator}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {skipped.length > 0 && (
        <div className="card">
          <h3>{t("จุดที่ระบบตรวจไม่ได้ (ไม่มีประเด็น ≠ ไม่มีปัญหา)", "Checks the system could not run (no flag ≠ no problem)")}</h3>
          <p className="muted small">{t("เอกสารเหล่านี้ถูกข้ามบางการตรวจ ผู้ตรวจควรดูเองหรือขอเอกสารเพิ่ม", "Some checks were skipped for these documents. Review them yourself or request more documents.")}</p>
          <ul>
            {skipped.map((b) => (
              <li key={b.doc + b.reason}>
                <strong>{b.doc}</strong> · {b.reason}{" "}
                <span className="muted small">({t("ไม่ได้ตรวจ", "Not checked")}: {b.checks.map((c) => TYPE_LABEL[c] ?? c).join(", ")})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h3>{t("ไฟล์ทั้งหมด", "All files")}</h3>
        <table className="fields">
          <tbody>
            {data.files.map((f) => (
              <tr key={f.file}>
                <th>{f.file}</th>
                <td className="mono small">{f.sha256?.slice(0, 16)}</td>
                <td>{f.read ? <span className="tag ok">{t("อ่านแล้ว", "Read")}</span> : <span className="tag bad">{t("อ่านไม่ได้", "Unreadable")}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
