import { useMemo, useState } from "react";
import type { ConflictMap, Decision, Signoff } from "../types";
import { baht, fieldLabel, KIND_LABEL, RISK_LABEL } from "../labels";
import { t as tr, useLang } from "../i18n";
import { buildReport, when, type Audience } from "./model";
import { downloadDocx } from "./docx";
import "./report.css";

interface Props {
  data: ConflictMap;
  decisions: Record<string, Decision>;
  signoff: Signoff | null;
}

const RISK_CLASS = { สูง: "risk-high", กลาง: "risk-mid", ต่ำ: "risk-low" } as const;

// Printable working paper, also exported as Word. PDF uses the browser's print-to-PDF.
export default function ReportView({ data, decisions, signoff }: Props) {
  const [audience, setAudience] = useState<Audience>("manager");
  const lang = useLang();
  const report = useMemo(() => buildReport(data, decisions, signoff, audience), [data, decisions, signoff, audience, lang]);
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
        <div className="segmented small-seg" role="radiogroup" aria-label={tr("ฉบับรายงาน", "Report version")}>
          {(
            [
              ["manager", tr("ฉบับ Manager", "Manager copy")],
              ["client", tr("ฉบับส่งลูกค้า", "Client copy")],
            ] as const
          ).map(([v, label]) => (
            <button key={v} role="radio" aria-checked={audience === v} onClick={() => setAudience(v)}>
              {label}
            </button>
          ))}
        </div>
        <span className="muted small">
          {client
            ? tr("เฉพาะรายการจากผลที่ลงนามยืนยันแล้วว่าเป็นประเด็น ไม่มีเหตุผลภายในของทีม", "Only items from a signed-off run marked as issues, without the team's internal notes")
            : tr("ทุกรายการพร้อมผลการพิจารณาและการตรวจสอบ", "Every item with its conclusion and check")}
        </span>
        <span className="grow" />
        <button className="btn" onClick={() => downloadDocx(report, data)}>
          Export Word
        </button>
        <button className="btn filled" onClick={savePdf}>
          {tr("บันทึก PDF", "Save PDF")}
        </button>
      </div>

      <article className="report" aria-label={report.title}>
        <header className="rp-head">
          <div>
            <p className="rp-kicker">AI Audit Concierge · {tr("กระดาษทำการ", "Working paper")}</p>
            <h2>{report.title}</h2>
            <p>
              <b>{report.client}</b>
            </p>
            <p className="rp-meta">
              Run {report.runId} · {tr("จัดทำรายงาน", "Generated")} {when(report.generatedAt)} · Materiality {baht(report.materiality)} ·
              Tolerance {report.tolerancePct}%
            </p>
            {report.synthetic && <p className="rp-synthetic">{tr("ข้อมูลสมมติ (synthetic) ไม่มีข้อมูลลูกค้าจริง", "Synthetic data, no real client data")}</p>}
          </div>
          <table className="rp-sign">
            <tbody>
              <tr>
                <th>{tr("ตรวจสอบโดย", "Checked by")}</th>
                <td>{report.checkedBy.join(", ") || " "}</td>
              </tr>
              <tr>
                <th>{tr("ลงนามยืนยันผลโดย", "Signed off by")}</th>
                <td>{report.signoff ? `${report.signoff.by} · ${when(report.signoff.at)}` : " "}</td>
              </tr>
            </tbody>
          </table>
        </header>

        <p className="rp-principle">
          {tr(
            "ระบบชี้จุดที่ควรตรวจพร้อมหลักฐานจากเอกสารต้นฉบับ ข้อสรุปทุกข้อเป็นดุลยพินิจของผู้สอบบัญชี ไม่ใช่การตัดสินของระบบ",
            "The system points out items to check with evidence from the source documents. Every conclusion is the auditor's professional judgment, not the system's.",
          )}
        </p>

        <section>
          <h3>{tr("สรุป", "Summary")}</h3>
          <table className="rp-table rp-summary">
            <thead>
              <tr>
                <th />
                {report.byRisk.map((r) => (
                  <th key={r.risk}>{RISK_LABEL[r.risk]}</th>
                ))}
                <th>{tr("รวม", "Total")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>{client ? tr("ประเด็นที่พบ", "Issues found") : tr("รายการที่ควรตรวจ", "Items to check")}</th>
                {report.byRisk.map((r) => (
                  <td key={r.risk}>{r.total}</td>
                ))}
                <td>{t.flags}</td>
              </tr>
              {!client && (
                <>
                  <tr>
                    <th>{tr("ตรวจสอบแล้ว", "Checked")}</th>
                    {report.byRisk.map((r) => (
                      <td key={r.risk}>{r.checked}</td>
                    ))}
                    <td>{t.checked}</td>
                  </tr>
                  <tr>
                    <th>{tr("สรุปว่าเป็นประเด็น", "Concluded as issue")}</th>
                    {report.byRisk.map((r) => (
                      <td key={r.risk}>{r.issues}</td>
                    ))}
                    <td>{t.issues}</td>
                  </tr>
                </>
              )}
              <tr>
                <th>{tr("ยอดที่เกี่ยวข้อง", "Amount at stake")}</th>
                {report.byRisk.map((r) => (
                  <td key={r.risk}>{baht(r.atStake)}</td>
                ))}
                <td>{baht(report.byRisk.reduce((s, r) => s + r.atStake, 0))}</td>
              </tr>
            </tbody>
          </table>
          {!client && (
            <p className="rp-meta">
              {tr("ตรวจสอบแล้ว", "Checked")} {t.checked}/{t.flags} · {tr("ไม่เป็นประเด็น", "Not an issue")} {t.notIssues} ·{" "}
              {tr("รอจับคู่", "Unmatched")} {t.pending} ({tr("ยังไม่นำไปตรวจ", "not yet checked")})
            </p>
          )}
        </section>

        <section>
          <h3>{client ? tr("ประเด็นและเอกสารอ้างอิง", "Findings and supporting documents") : tr("รายการที่ควรตรวจ", "Items to check")}</h3>
          {report.flags.length === 0 && (
            <p className="rp-meta">
              {client
                ? tr("ยังไม่มีรายการจากผลที่ลงนามยืนยันแล้วว่าเป็นประเด็น", "No item from a signed-off run has been marked as an issue yet")
                : tr("ไม่มีรายการที่ควรตรวจ", "Nothing to check")}
            </p>
          )}
          {report.flags.map((r) => (
            <div key={r.ref} className="rp-flag">
              <div className="rp-flag-head">
                <span className="rp-ref">{r.ref}</span>
                <span className={"pill " + RISK_CLASS[r.flag.risk]}>{RISK_LABEL[r.flag.risk]}</span>
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
                    <b>{tr("ขอคำชี้แจง", "Please explain")}</b>
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
                      <th>{tr("ผลการพิจารณา", "Conclusion")}</th>
                      <td>
                        <span className={"pill " + (r.decision?.verdict === "issue" ? "bad" : r.decision ? "ok" : "")}>
                          {r.decision ? r.verdictLabel : r.stateLabel}
                        </span>{" "}
                        {r.decision?.reason}
                      </td>
                    </tr>
                    <tr>
                      <th>{tr("ตรวจสอบโดย", "Checked by")}</th>
                      <td>{r.decision ? `${r.decision.by ?? "-"} · ${when(r.decision.at)}` : "-"}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </section>

        {!client && data.pending.length > 0 && (
          <section>
            <h3>{tr("รอจับคู่ (ยังไม่นำไปตรวจ)", "Unmatched (not yet checked)")}</h3>
            <table className="rp-table">
              <thead>
                <tr>
                  <th>{tr("เอกสาร", "Document")}</th>
                  <th>{tr("ประเภท", "Type")}</th>
                  <th>{tr("เหตุผล", "Reason")}</th>
                  <th>{tr("ตัวเลือก", "Candidates")}</th>
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
            <h3>{tr("ขอบเขตข้อมูล", "Data coverage")}</h3>
            <p className="rp-meta">
              {tr("อ่าน", "Read")} {data.coverage.files} {tr("ไฟล์", "files")} · {data.documents.length} {tr("เอกสาร", "documents")} ·{" "}
              {data.transactions.length} {tr("ธุรกรรม", "transactions")} · {tr("ไฟล์อ่านไม่ได้", "unreadable files")} {data.coverage.unreadable_files.length} ·{" "}
              {tr("ช่องอ่านไม่ชัด", "unclear fields")} {data.coverage.unclear_fields.length} ({tr("ไม่ใช้ยกประเด็น", "never used to raise a flag")})
            </p>
          </section>
        )}

        <footer className="rp-foot">
          <span>
            {report.client} · Run {report.runId}
          </span>
          <span>{tr("เลขบัญชีธนาคารแสดงแบบปิดบัง · ข้อมูลลับ", "Bank accounts shown masked · Confidential")}</span>
        </footer>
      </article>
    </div>
  );
}
