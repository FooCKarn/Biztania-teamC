import type { ConflictMap } from "../types";
import { KIND_LABEL, RISK_LABEL, baht, fieldLabel } from "../labels";
import { t as tr } from "../i18n";
import { when, type Report } from "./model";
import { zip } from "./zip";

// Minimal .docx writer. Every run sets the cs font/size too, or Word may pick a font without Thai glyphs.

const FONT = "Tahoma";

const esc = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

interface RunOpt {
  bold?: boolean;
  color?: string;
  /** Half-points, like w:sz. */
  size?: number;
  italic?: boolean;
}

function run(text: string, o: RunOpt = {}) {
  const pr = [
    o.bold ? "<w:b/><w:bCs/>" : "",
    o.italic ? "<w:i/><w:iCs/>" : "",
    o.color ? `<w:color w:val="${o.color}"/>` : "",
    o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : "",
  ].join("");
  // Line breaks inside a value (e.g. several questions) become <w:br/>.
  const body = text
    .split("\n")
    .map((t) => `<w:t xml:space="preserve">${esc(t)}</w:t>`)
    .join("<w:br/>");
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}${body}</w:r>`;
}

type Inline = string | [string, RunOpt];

interface ParaOpt {
  style?: string;
  align?: "left" | "center" | "right";
  /** Hanging indent for list items; the marker ("1.", "•") is written as text so each list restarts. */
  hanging?: boolean;
  keepNext?: boolean;
  spaceAfter?: number;
}

function para(content: string | Inline[], o: ParaOpt = {}) {
  const parts = typeof content === "string" ? [content] : content;
  const pr = [
    o.style ? `<w:pStyle w:val="${o.style}"/>` : "",
    o.keepNext ? "<w:keepNext/>" : "",
    o.hanging ? '<w:tabs><w:tab w:val="left" w:pos="400"/></w:tabs>' : "",
    o.spaceAfter != null ? `<w:spacing w:after="${o.spaceAfter}"/>` : "",
    o.hanging ? '<w:ind w:left="400" w:hanging="300"/>' : "",
    o.align && o.align !== "left" ? `<w:jc w:val="${o.align}"/>` : "",
  ].join("");
  const runs = parts.map((p) => (typeof p === "string" ? run(p) : run(p[0], p[1]))).join("");
  return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ""}${runs}</w:p>`;
}

const h = (text: string, level: 1 | 2) => para(text, { style: level === 1 ? "Title" : "Heading1", keepNext: true });
const muted = (text: string) => para([[text, { color: "6E6E73", size: 18 }]]);

interface Col {
  header: string;
  /** Twentieths of a point. The usable A4 width with 2 cm margins is about 9638. */
  width: number;
  align?: "left" | "right" | "center";
}

function table(cols: Col[], rows: (string | Inline[])[][], opt: { headerCol?: boolean; noHeader?: boolean } = {}) {
  const cell = (c: Col, content: string | Inline[], head: boolean, rowHead: boolean) => {
    const parts: Inline[] = typeof content === "string" ? [[content, head || rowHead ? { bold: true } : {}]] : content;
    return `<w:tc><w:tcPr><w:tcW w:w="${c.width}" w:type="dxa"/>${head || rowHead ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F7"/>' : ""}</w:tcPr>${para(parts, { align: c.align, spaceAfter: 0 })}</w:tc>`;
  };
  const header = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${cols.map((c) => cell(c, c.header, true, false)).join("")}</w:tr>`;
  const body = rows
    .map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cols.map((c, i) => cell(c, r[i] ?? "", false, !!opt.headerCol && i === 0)).join("")}</w:tr>`)
    .join("");
  return `<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="${cols.reduce((s, c) => s + c.width, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${cols
    .map((c) => `<w:gridCol w:w="${c.width}"/>`)
    .join("")}</w:tblGrid>${opt.noHeader ? "" : header}${body}</w:tbl>${para("", { spaceAfter: 0 })}`;
}

const RISK_COLOR = { สูง: "D70015", กลาง: "C93400", ต่ำ: "007AFF" } as const;

export function reportBody(report: Report, data: ConflictMap): string {
  const client = report.audience === "client";
  const t = report.totals;
  const out: string[] = [];

  out.push(para([[tr("AuditPal · กระดาษทำการ", "AuditPal · Working paper"), { color: "6E6E73", size: 18 }]]));
  out.push(h(report.title, 1));
  out.push(para([[report.client, { bold: true }]]));
  out.push(
    muted(
      `Run ${report.runId} · ${tr("จัดทำรายงาน", "Generated")} ${when(report.generatedAt)}`,
    ),
  );
  if (report.synthetic) out.push(para([[tr("ข้อมูลสมมติ (synthetic) ไม่มีข้อมูลลูกค้าจริง", "Synthetic data, no real client data"), { bold: true, color: "C93400" }]]));

  out.push(
    table(
      [
        { header: tr("การลงนาม", "Sign-off"), width: 2400 },
        { header: tr("ชื่อ", "Name"), width: 4000 },
      ],
      [
        [tr("ตรวจสอบโดย", "Checked by"), report.checkedBy.join(", ")],
        [tr("ลงนามยืนยันผลโดย", "Signed off by"), report.signoff ? `${report.signoff.by} · ${when(report.signoff.at)}` : ""],
      ],
      { headerCol: true },
    ),
  );

  out.push(
    para([[tr("ระบบชี้จุดที่ควรตรวจพร้อมหลักฐานจากเอกสารต้นฉบับ ข้อสรุปทุกข้อเป็นดุลยพินิจของผู้สอบบัญชี ไม่ใช่การตัดสินของระบบ", "The system points out what to check, with evidence from the source documents. Every conclusion is the auditor's professional judgment, not the system's."), { italic: true }]]),
  );

  out.push(h(tr("สรุป", "Summary"), 2));
  const num = (c: string): Col => ({ header: c, width: 1500, align: "right" });
  const summaryRows: string[][] = [
    [client ? tr("ประเด็นที่พบ", "Issues found") : tr("รายการที่ควรตรวจ", "Items to check"), ...report.byRisk.map((r) => String(r.total)), String(t.flags)],
    ...(client
      ? []
      : [
          [tr("ตรวจสอบแล้ว", "Checked"), ...report.byRisk.map((r) => String(r.checked)), String(t.checked)],
          [tr("สรุปว่าเป็นประเด็น", "Concluded as issue"), ...report.byRisk.map((r) => String(r.issues)), String(t.issues)],
        ]),
    [tr("ยอดที่เกี่ยวข้อง", "Amount at stake"), ...report.byRisk.map((r) => baht(r.atStake)), baht(report.byRisk.reduce((s, r) => s + r.atStake, 0))],
  ];
  out.push(table([{ header: "", width: 3138 }, ...report.byRisk.map((r) => num(RISK_LABEL[r.risk])), num(tr("รวม", "Total"))], summaryRows, { headerCol: true }));
  if (!client)
    out.push(
      muted(
        tr(
          `ตรวจสอบแล้ว ${t.checked}/${t.flags} · ไม่เป็นประเด็น ${t.notIssues} · รอจับคู่ ${t.pending} (ยังไม่นำไปตรวจ)`,
          `Checked ${t.checked}/${t.flags} · Not an issue ${t.notIssues} · Unmatched ${t.pending} (not yet checked)`,
        ),
      ),
    );

  out.push(h(client ? tr("ประเด็นและเอกสารอ้างอิง", "Issues and supporting documents") : tr("รายการที่ควรตรวจ", "Items to check"), 2));
  if (report.flags.length === 0)
    out.push(muted(client ? tr("ยังไม่มีรายการจากผลที่ลงนามยืนยันแล้วว่าเป็นประเด็น", "No items from a signed-off run are issues yet") : tr("ไม่มีรายการที่ควรตรวจ", "No items to check")));
  for (const r of report.flags) {
    out.push(
      para(
        [
          [`${r.ref}  `, { bold: true, color: "6E6E73" }],
          [`[${RISK_LABEL[r.flag.risk]}]  `, { bold: true, color: RISK_COLOR[r.flag.risk] }],
          [`${r.typeLabel} · `, { color: "6E6E73" }],
          [r.flag.title, { bold: true }],
          ...(r.flag.at_stake_thb != null ? [[`  ${baht(r.flag.at_stake_thb)}`, { bold: true }] as Inline] : []),
        ],
        { style: "Heading2", keepNext: true },
      ),
    );
    out.push(para(r.flag.summary, { keepNext: true }));
    r.flag.evidence.forEach((e, i) =>
      out.push(
        para(
          [
            `${i + 1}.\t`,
            [e.doc, { bold: true }],
            ` ${fieldLabel(e.field)}: “${e.quote}” `,
            [`${e.file} · ${e.locator}`, { color: "6E6E73", size: 18 }],
          ],
          { hanging: true },
        ),
      ),
    );
    if (client) {
      if (r.flag.questions.length) {
        out.push(para([[tr("ขอคำชี้แจง", "Please explain"), { bold: true }]], { keepNext: true }));
        for (const q of r.flag.questions) out.push(para(`•\t${q}`, { hanging: true }));
      }
    } else {
      out.push(
        table(
          [
            { header: "", width: 2400 },
            { header: "", width: 7238 },
          ],
          [
            [tr("ผลการพิจารณา", "Conclusion"), `${r.decision ? r.verdictLabel : r.stateLabel}${r.decision?.reason ? ` · ${r.decision.reason}` : ""}`],
            [tr("ตรวจสอบโดย", "Checked by"), r.decision ? `${r.decision.by ?? "-"} · ${when(r.decision.at)}` : "-"],
          ],
          { headerCol: true, noHeader: true },
        ),
      );
    }
  }

  if (!client && data.pending.length > 0) {
    out.push(h(tr("รอจับคู่ (ยังไม่นำไปตรวจ)", "Unmatched (not yet checked)"), 2));
    out.push(
      table(
        [
          { header: tr("เอกสาร", "Document"), width: 1700 },
          { header: tr("ประเภท", "Type"), width: 1400 },
          { header: tr("เหตุผล", "Reason"), width: 4238 },
          { header: tr("ตัวเลือก", "Candidates"), width: 2300 },
        ],
        data.pending.map((p) => [p.doc, KIND_LABEL[p.kind], p.why, p.candidates.join(", ")]),
      ),
    );
  }

  if (!client) {
    out.push(h(tr("ขอบเขตข้อมูล", "Data coverage"), 2));
    out.push(
      muted(
        tr(
          `อ่าน ${data.coverage.files} ไฟล์ · ${data.documents.length} เอกสาร · ${data.transactions.length} ธุรกรรม · ไฟล์อ่านไม่ได้ ${data.coverage.unreadable_files.length} · ช่องอ่านไม่ชัด ${data.coverage.unclear_fields.length} (ไม่ใช้ยกประเด็น)`,
          `Read ${data.coverage.files} files · ${data.documents.length} documents · ${data.transactions.length} transactions · Unreadable files ${data.coverage.unreadable_files.length} · Unclear fields ${data.coverage.unclear_fields.length} (never used to raise a flag)`,
        ),
      ),
    );
  }
  return out.join("");
}

const NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;

const STYLES = `${XML}<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="th-TH" w:bidi="th-TH"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="2" w:color="1D1D1F"/></w:pBdr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="6E6E73"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="Grid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="C7C7CC"/><w:left w:val="single" w:sz="4" w:color="C7C7CC"/><w:bottom w:val="single" w:sz="4" w:color="C7C7CC"/><w:right w:val="single" w:sz="4" w:color="C7C7CC"/><w:insideH w:val="single" w:sz="4" w:color="C7C7CC"/><w:insideV w:val="single" w:sz="4" w:color="C7C7CC"/></w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

export function buildDocx(report: Report, data: ConflictMap): Uint8Array {
  const footer = `${XML}<w:ftr ${NS}><w:p><w:pPr><w:pStyle w:val="Footer"/><w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs></w:pPr>${run(
    `${report.client} · Run ${report.runId} · ${tr("เลขบัญชีธนาคารแสดงแบบปิดบัง · ข้อมูลลับ", "Bank accounts shown masked · Confidential")}`,
  )}<w:r><w:tab/><w:t xml:space="preserve">${tr("หน้า", "Page")} </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;

  // A4, 2 cm margins.
  const docXml = `${XML}<w:document ${NS}><w:body>${reportBody(report, data)}<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    ],
    [
      "docProps/core.xml",
      `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(report.title)}</dc:title><dc:subject>${esc(report.client)}</dc:subject><dc:creator>AuditPal</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${report.generatedAt.replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`,
    ],
    [
      "word/_rels/document.xml.rels",
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`,
    ],
    ["word/document.xml", docXml],
    ["word/styles.xml", STYLES],
    ["word/footer1.xml", footer],
  ];
  return zip(files.map(([name, text]) => [name, new TextEncoder().encode(text)]));
}

export function downloadDocx(report: Report, data: ConflictMap) {
  const bytes = buildDocx(report, data);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
  );
  a.download = `working-paper-${report.audience}-${report.runId}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
