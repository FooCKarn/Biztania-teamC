import type { ConflictMap, Doc } from "../types";
import { MATCH_LABEL } from "../labels";
import TxnChain from "./TxnChain";

interface Props {
  data: ConflictMap;
  docs: Map<string, Doc>;
  openTxn: (id: string) => void;
}

export default function OverviewView({ data, docs, openTxn }: Props) {
  const cov = data.coverage;
  const sorted = [...data.transactions].sort((a, b) => b.flags.length - a.flags.length || a.id.localeCompare(b.id));
  return (
    <div className="stack">
      <div className="stats">
        <div className="stat">
          <b>{cov.files}</b>ไฟล์ที่อ่าน
        </div>
        <div className="stat">
          <b>{data.transactions.length}</b>ธุรกรรม
        </div>
        <div className="stat">
          <b>{data.flags.length}</b>จุดที่ควรตรวจ
        </div>
        <div className="stat">
          <b>{data.pending.length}</b>รอจับคู่
        </div>
        <div className="stat">
          <b>{cov.unclear_fields.length}</b>ช่องอ่านไม่ชัด
        </div>
        <div className="stat">
          <b>{cov.unreadable_files.length}</b>ไฟล์อ่านไม่ได้
        </div>
      </div>

      <div className="card">
        <h3>ทุกธุรกรรม</h3>
        <div className="txn-grid">
          {sorted.map((t) => (
            <button key={t.id} className="txn-tile" onClick={() => openTxn(t.id)}>
              <span className="row between">
                <strong>{t.id.replace(/^T-/, "")}</strong>
                <span className={t.flags.length ? "tag bad" : t.pending ? "tag warn" : "tag ok"}>
                  {t.flags.length ? `ควรตรวจ ${t.flags.length}` : t.pending ? "รอจับคู่" : "ไม่พบจุดขัดแย้ง"}
                </span>
              </span>
              <span className="muted small">
                {data.vendors.find((v) => v.code === t.vendor)?.name_th ?? "ไม่ทราบ vendor"} · {MATCH_LABEL[t.match]}
              </span>
              <TxnChain txn={t} docs={docs} flags={data.flags} compact />
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>กฎของบริษัทที่ใช้ (Remember)</h3>
        <ul>
          {data.rules.map((r) => (
            <li key={r.id}>
              <strong>{r.id}</strong> “{r.source_quote}” <span className="muted small">({r.source_doc})</span>{" "}
              {r.verified ? <span className="tag ok">พบในเอกสาร</span> : <span className="tag bad">ไม่พบ ไม่นำไปใช้</span>}
            </li>
          ))}
        </ul>
      </div>

      {cov.unclear_fields.length > 0 && (
        <div className="card">
          <h3>ช่องที่อ่านไม่ชัด (ไม่ใช้ยกประเด็น)</h3>
          <ul>
            {cov.unclear_fields.map((u) => (
              <li key={u.doc + u.field}>
                {u.doc} · {u.field} · “{u.quote}” <span className="muted small">{u.locator}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h3>ไฟล์ทั้งหมด</h3>
        <table className="fields">
          <tbody>
            {data.files.map((f) => (
              <tr key={f.file}>
                <th>{f.file}</th>
                <td className="mono small">{f.sha256?.slice(0, 16)}</td>
                <td>{f.read ? <span className="tag ok">อ่านแล้ว</span> : <span className="tag bad">อ่านไม่ได้</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
