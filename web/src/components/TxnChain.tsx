import type { Doc, Flag, Transaction } from "../types";
import { KIND_LABEL, KIND_ORDER, TYPE_LABEL, baht, fieldLabel } from "../labels";
import { t } from "../i18n";

interface Props {
  txn: Transaction;
  docs: Map<string, Doc>;
  flags: Flag[];
  highlight?: Flag;
  selectedDoc?: string | null;
  onSelect?: (id: string) => void;
  compact?: boolean;
}

interface Edge {
  a: string;
  b: string;
  label: string;
  bad: boolean;
  inferred: boolean;
}

const W = 168;
const H = 58;
const GAP_X = 56;
const GAP_Y = 22;

const amountOf = (d: Doc) => {
  const f = d.fields.total ?? d.fields.amount ?? d.fields.subtotal;
  return f && f.clear && typeof f.value === "number" ? baht(f.value) : "";
};

const shortId = (id: string) =>
  id.replace(/^BANK-(\d{4}-\d{2}-\d{2}).*/, t("โอน $1", "Paid $1")).replace(" (อ่านเลขที่ไม่ชัด)", "");

// PO → GR → Invoice → Payment; other documents a flag pulls in go in an extra column.
export default function TxnChain({ txn, docs, flags, highlight, selectedDoc, onSelect, compact }: Props) {
  const txnFlags = flags.filter((f) => f.transaction === txn.id);
  const extra = [...new Set(txnFlags.flatMap((f) => f.docs))].filter((d) => !txn.members.includes(d) && docs.has(d));
  const cols: string[][] = [...KIND_ORDER.map((k) => txn.members.filter((m) => docs.get(m)?.kind === k)), extra].filter(
    (c) => c.length,
  );

  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((col, ci) => col.forEach((id, ri) => pos.set(id, { x: ci * (W + GAP_X), y: ri * (H + GAP_Y) })));
  const width = cols.length * (W + GAP_X) - GAP_X;
  const height = Math.max(...cols.map((c) => c.length)) * (H + GAP_Y) - GAP_Y;

  const edges: Edge[] = txn.links.map((l) => ({
    a: l.a,
    b: l.b,
    label: l.field,
    bad: l.status === "conflicts",
    inferred: docs.get(l.b)?.link?.level === "likely" || docs.get(l.a)?.link?.level === "likely",
  }));
  for (const f of txnFlags) {
    const anchor = f.docs.find((d) => txn.members.includes(d));
    for (const d of f.docs)
      if (anchor && extra.includes(d) && !edges.some((e) => (e.a === d && e.b === anchor) || (e.a === anchor && e.b === d)))
        edges.push({ a: anchor, b: d, label: TYPE_LABEL[f.type] ?? f.type, bad: true, inferred: false });
  }
  const hot = new Set(highlight?.docs ?? []);
  const flagged = new Set(txnFlags.flatMap((f) => f.docs));
  const pad = 14;

  return (
    <div className="chain-wrap">
      <svg
        className={"chain" + (compact ? " compact" : "")}
        viewBox={`${-pad} ${-pad} ${width + 2 * pad} ${height + 2 * pad}`}
        width={compact ? undefined : width + 2 * pad}
        role="img"
        aria-label={`${t("แผนที่ธุรกรรม", "Transaction map")} ${txn.id}`}
      >
        {edges.map((e, i) => {
          const p = pos.get(e.a);
          const q = pos.get(e.b);
          if (!p || !q) return null;
          const [l, r] = p.x <= q.x ? [p, q] : [q, p];
          const x1 = l.x + W,
            y1 = l.y + H / 2,
            x2 = r.x === l.x ? r.x + W : r.x,
            y2 = r.y + H / 2;
          const d =
            r.x === l.x
              ? `M${x1} ${y1} C${x1 + 40} ${y1} ${x2 + 40} ${y2} ${x2} ${y2}`
              : `M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`;
          return (
            <g key={i} className={"edge " + (e.bad ? "bad" : "good") + (e.inferred ? " inferred" : "")}>
              <path d={d}>
                <title>
                  {fieldLabel(e.label)}: {e.bad ? t("ไม่ตรงกัน", "mismatch") : t("ตรงกัน", "match")}
                  {e.inferred ? ` (${t("จับคู่โดยอนุมาน", "inferred match")})` : ""}
                </title>
              </path>
              {!compact && e.bad && (
                <text x={(x1 + x2) / 2 + (r.x === l.x ? 44 : 0)} y={(y1 + y2) / 2 - 6} textAnchor="middle" className="edge-label">
                  ✕
                </text>
              )}
            </g>
          );
        })}
        {[...pos.entries()].map(([id, p]) => {
          const d = docs.get(id)!;
          const unclear = Object.values(d.fields).some((f) => !f.clear);
          const cls =
            "node" +
            (hot.has(id) ? " hot" : flagged.has(id) ? " flagged" : "") +
            (selectedDoc === id ? " selected" : "") +
            (onSelect ? " clickable" : "");
          return (
            <g
              key={id}
              className={cls}
              transform={`translate(${p.x},${p.y})`}
              onClick={() => onSelect?.(id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect?.(id)}
              tabIndex={onSelect ? 0 : undefined}
              role={onSelect ? "button" : undefined}
              aria-label={`${KIND_LABEL[d.kind]} ${id}`}
            >
              <rect width={W} height={H} rx={10} />
              <text x={10} y={18} className="n-kind">
                {KIND_LABEL[d.kind]}
                {d.format === "scan" ? ` · ${t("สแกน", "scan")}` : ""}
                {unclear ? ` · ${t("อ่านไม่ชัด", "unclear")}` : ""}
              </text>
              <text x={10} y={35} className="n-id">
                {shortId(id).slice(0, 22)}
              </text>
              <text x={10} y={50} className="n-amt">
                {amountOf(d)}
              </text>
            </g>
          );
        })}
      </svg>
      {!compact && (
        <p className="legend muted small">
          <span className="lg good" /> {t("ตรงกัน", "Match")} <span className="lg bad" /> {t("ไม่ตรงกัน", "Mismatch")} <span className="lg inferred" />{" "}
          {t("จับคู่โดยอนุมาน", "Inferred match")} · {t("คลิกเอกสารเพื่อดูข้อมูลที่อ่านได้", "Click a document to see what was read")}
        </p>
      )}
    </div>
  );
}
