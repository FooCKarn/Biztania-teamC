import { useMemo, useState } from "react";
import type { ConflictMap, Decision } from "../types";
import { baht, fieldLabel, KIND_LABEL } from "../labels";
import { buildReport, when, type Audience } from "./model";
import { downloadWorkbook } from "./workbook";
import { downloadDocx } from "./docx";
import "./report.css";

interface Props {
  data: ConflictMap;
  decisions: Record<string, Decision>;
}

const RISK_CLASS = { สูง: "risk-high", กลาง: "risk-mid", ต่ำ: "risk-low" } as const;

// Printable working paper, also downloadable as Excel and Word (editable copy). "บันทึก PDF" uses the browser's print-to-PDF, so Thai text renders with
// the system fonts and nothing leaves the browser.
export default function ReportView({ data, decisions }: Props) {
  const [audience, setAudience] = useState<Audience>("manager");
  const report = useMemo(() => buildReport(data, decisions, audience), [data, decisions, audience]);
  const client = audience === "client";
  const t = report.totals;

  const savePdf = () => {
    const prev = document.title;
    document.title = `working-paper-${audience}-${report.runId}`;
    window.print();
    document.title = prev;
  };

  return (
    <div className="stack">
      <div className="report-toolbar card">
        <div className="segmented small-seg" role="radiogroup" aria-label="ฉบับรายงาน">
          {(
            [
              ["manager", "ฉบับ Manager"],
              ["client", "ฉบับส่งลูกค้า"],
            ] as const
          ).map(([v, label]) => (
            <button key={v} role="radio" aria-checked={audience === v} onClick={() => setAudience(v)}>
              {label}
            </button>
          ))}
        </div>
        <span className="muted small">
          {client
            ? "เฉพาะรายการที่ผู้สอบทานลงนามแล้วว่าเป็นประเด็น ไม่มีเหตุผลภายในของทีม"
            : "ทุกรายการพร้อมผลการพิจารณาและการลงนาม"}
        </span>
        <span className="grow" />
        <button className="btn" onClick={() => downloadWorkbook(report, data)}>
          Export Excel
        </button>
        <button className="btn" onClick={() => downloadDocx(report, data)}>
          Export Word
        </button>
        <button className="btn filled" onClick={savePdf}>
          บันทึก PDF
        </button>
      </div>

      <article className="report" aria-label={report.title}>
        <header className="rp-head">
          <div>
            <p className="rp-kicker">AI Audit Concierge · กระดาษทำการ</p>
            <h2>{report.title}</h2>
            <p>
              <b>{report.client}</b>
            </p>
            <p className="rp-meta">
              Run {report.runId} · จัดทำรายงาน {when(report.generatedAt)} · Materiality {baht(report.materiality)} ·
              Tolerance {report.tolerancePct}%
            </p>
            {report.synthetic && <p className="rp-synthetic">ข้อมูลสมมติ (synthetic) ไม่มีข้อมูลลูกค้าจริง</p>}
          </div>
          <table className="rp-sign">
            <tbody>
              <tr>
                <th>จัดทำโดย</th>
                <td>{report.preparers.join(", ") || " "}</td>
              </tr>
              <tr>
                <th>สอบทานโดย</th>
                <td>{report.reviewers.join(", ") || " "}</td>
              </tr>
              <tr>
                <th>อนุมัติ (Manager)</th>
                <td> </td>
              </tr>
            </tbody>
          </table>
        </header>

        <p className="rp-principle">
          ระบบชี้จุดที่ควรตรวจพร้อมหลักฐานจากเอกสารต้นฉบับ ข้อสรุปทุกข้อเป็นดุลยพินิจของผู้สอบบัญชี ไม่ใช่การตัดสินของระบบ
        </p>

        <section>
          <h3>สรุป</h3>
          <table className="rp-table rp-summary">
            <thead>
              <tr>
                <th />
                {report.byRisk.map((r) => (
                  <th key={r.risk}>{r.risk}</th>
                ))}
                <th>รวม</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>{client ? "ประเด็นที่พบ" : "รายการที่ควรตรวจ"}</th>
                {report.byRisk.map((r) => (
                  <td key={r.risk}>{r.total}</td>
                ))}
                <td>{t.flags}</td>
              </tr>
              {!client && (
                <>
                  <tr>
                    <th>สอบทานแล้ว</th>
                    {report.byRisk.map((r) => (
                      <td key={r.risk}>{r.reviewed}</td>
                    ))}
                    <td>{t.reviewed}</td>
                  </tr>
                  <tr>
                    <th>สรุปว่าเป็นประเด็น</th>
                    {report.byRisk.map((r) => (
                      <td key={r.risk}>{r.issues}</td>
                    ))}
                    <td>{t.issues}</td>
                  </tr>
                </>
              )}
              <tr>
                <th>ยอดที่เกี่ยวข้อง</th>
                {report.byRisk.map((r) => (
                  <td key={r.risk}>{baht(r.atStake)}</td>
                ))}
                <td>{baht(report.byRisk.reduce((s, r) => s + r.atStake, 0))}</td>
              </tr>
            </tbody>
          </table>
          {!client && (
            <p className="rp-meta">
              จัดทำแล้ว {t.prepared}/{t.flags} · สอบทานแล้ว {t.reviewed}/{t.flags} · ไม่เป็นประเด็น {t.notIssues} · รอจับคู่{" "}
              {t.pending} (ยังไม่นำไปตรวจ)
            </p>
          )}
        </section>

        <section>
          <h3>{client ? "ประเด็นและเอกสารอ้างอิง" : "รายการที่ควรตรวจ"}</h3>
          {report.flags.length === 0 && (
            <p className="rp-meta">
              {client ? "ยังไม่มีรายการที่ผู้สอบทานลงนามแล้วว่าเป็นประเด็น" : "ไม่มีรายการที่ควรตรวจ"}
            </p>
          )}
          {report.flags.map((r) => (
            <div key={r.ref} className="rp-flag">
              <div className="rp-flag-head">
                <span className="rp-ref">{r.ref}</span>
                <span className={"pill " + RISK_CLASS[r.flag.risk]}>{r.flag.risk}</span>
                <span className="rp-type">{r.typeLabel}</span>
                <strong>{r.flag.title}</strong>
                <span className="rp-amt">{r.flag.at_stake_thb != null ? baht(r.flag.at_stake_thb) : ""}</span>
              </div>
              <p>{r.flag.summary}</p>
              <ol className="rp-evidence">
                {r.flag.evidence.map((e, i) => (
                  <li key={i}>
                    <b>{e.doc}</b> {fieldLabel(e.field)}: “{e.quote}” <span className="rp-loc">{e.file} · {e.locator}</span>
                  </li>
                ))}
              </ol>
              {client ? (
                r.flag.questions.length > 0 && (
                  <div className="rp-ask">
                    <b>ขอคำชี้แจง</b>
                    <ul>
                      {r.flag.questions.map((q) => (
                        <li key={q}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )
              ) : (
                <table className="rp-decision">
                  <tbody>
                    <tr>
                      <th>ผลการพิจารณา</th>
                      <td>
                        <span className={"pill " + (r.decision?.verdict === "issue" ? "bad" : r.decision ? "ok" : "")}>
                          {r.decision ? r.verdictLabel : r.stateLabel}
                        </span>{" "}
                        {r.decision?.reason}
                      </td>
                    </tr>
                    <tr>
                      <th>ผู้จัดทำ</th>
                      <td>{r.decision ? `${r.decision.by ?? "-"} · ${when(r.decision.at)}` : "-"}</td>
                    </tr>
                    <tr>
                      <th>ผู้สอบทาน</th>
                      <td>{r.decision?.review ? `${r.decision.review.by} · ${when(r.decision.review.at)}` : "-"}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </section>

        {!client && data.pending.length > 0 && (
          <section>
            <h3>รอจับคู่ (ยังไม่นำไปตรวจ)</h3>
            <table className="rp-table">
              <thead>
                <tr>
                  <th>เอกสาร</th>
                  <th>ประเภท</th>
                  <th>เหตุผล</th>
                  <th>ตัวเลือก</th>
                </tr>
              </thead>
              <tbody>
                {data.pending.map((p) => (
                  <tr key={p.doc}>
                    <td>{p.doc}</td>
                    <td>{KIND_LABEL[p.kind]}</td>
                    <td>{p.why}</td>
                    <td>{p.candidates.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {!client && (
          <section>
            <h3>ขอบเขตข้อมูล</h3>
            <p className="rp-meta">
              อ่าน {data.coverage.files} ไฟล์ · {data.documents.length} เอกสาร · {data.transactions.length} ธุรกรรม · ไฟล์อ่านไม่ได้{" "}
              {data.coverage.unreadable_files.length} · ช่องอ่านไม่ชัด {data.coverage.unclear_fields.length} (ไม่ใช้ยกประเด็น)
            </p>
          </section>
        )}

        <footer className="rp-foot">
          <span>
            {report.client} · Run {report.runId}
          </span>
          <span>เลขบัญชีธนาคารแสดงแบบปิดบัง · ข้อมูลลับ</span>
        </footer>
      </article>
    </div>
  );
}
