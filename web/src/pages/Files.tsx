import { useCallback, useEffect, useMemo, useState } from "react";
import { api, when, type FilesOverview, type ManagedFile } from "../api";
import "./files.css";

// File manager (#/files, or #/files/<engagement id> to open on one engagement): storage meter like a
// cloud drive, files of every engagement the user is on, filtered by extension, searchable, with
// download and delete. Page images the pipeline rendered count toward storage but are not listed:
// the evidence viewer needs them, and only the retention policy removes them.

const KIND: Record<string, { label: string; color: string }> = {
  pdf: { label: "PDF", color: "var(--ft-pdf)" },
  image: { label: "รูปภาพ", color: "var(--ft-image)" },
  csv: { label: "CSV", color: "var(--ft-csv)" },
  xlsx: { label: "Excel", color: "var(--ft-xlsx)" },
  json: { label: "กฎบริษัท (JSON)", color: "var(--ft-json)" },
  other: { label: "อื่นๆ", color: "var(--ft-other)" },
};
const kindOf = (ext: string) =>
  ext === "pdf" ? "pdf" : ["png", "jpg", "jpeg", "tif", "tiff"].includes(ext) ? "image" : ["csv", "xlsx", "json"].includes(ext) ? ext : "other";

export const bytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
};

type Sort = "new" | "old" | "name" | "big" | "small";
const SORTS: [Sort, string][] = [
  ["new", "อัปโหลดล่าสุด"],
  ["old", "อัปโหลดเก่าสุด"],
  ["name", "ชื่อ ก–ฮ / A–Z"],
  ["big", "ขนาดใหญ่สุด"],
  ["small", "ขนาดเล็กสุด"],
];
const sorters: Record<Sort, (a: ManagedFile, b: ManagedFile) => number> = {
  new: (a, b) => b.uploaded_at.localeCompare(a.uploaded_at),
  old: (a, b) => a.uploaded_at.localeCompare(b.uploaded_at),
  name: (a, b) => a.name.localeCompare(b.name, "th"),
  big: (a, b) => b.size - a.size,
  small: (a, b) => a.size - b.size,
};

const FileBadge = ({ ext }: { ext: string }) => (
  <span className="ft-badge" style={{ background: KIND[kindOf(ext)].color }} aria-hidden>
    {ext.toUpperCase().slice(0, 4) || "?"}
  </span>
);

function StorageMeter({ o }: { o: FilesOverview }) {
  const s = o.storage;
  const byKind = new Map<string, number>();
  for (const t of s.by_type) byKind.set(kindOf(t.ext), (byKind.get(kindOf(t.ext)) ?? 0) + t.bytes);
  const parts = [
    ...[...byKind.entries()].map(([k, b]) => ({ key: k, label: KIND[k].label, color: KIND[k].color, bytes: b })),
    { key: "pages", label: "ภาพหน้าเอกสารและผลการตรวจ", color: "var(--ft-pages)", bytes: s.pages },
    { key: "others", label: "Engagement อื่นในสำนักงาน", color: "var(--ft-others)", bytes: s.others },
    { key: "overhead", label: "ระบบฐานข้อมูล", color: "var(--ft-overhead)", bytes: s.overhead },
  ].filter((p) => p.bytes > 0);
  const pct = (n: number) => Math.min(100, (n / s.quota) * 100);
  const used = pct(s.used);
  const level = used >= 90 ? "bad" : used >= 75 ? "warn" : "";
  return (
    <section className="group-body storage" aria-label="พื้นที่จัดเก็บ">
      <div className="between row">
        <div>
          <p className="storage-big">
            ใช้ไป <strong>{bytes(s.used)}</strong> <span className="muted">จาก {bytes(s.quota)}</span>
          </p>
          <p className="muted small">
            ไฟล์ของคุณ {o.files.length} ไฟล์ · {bytes(s.files)} · เข้ารหัสแยกต่อ Engagement
          </p>
        </div>
        <span className={`pill ${level}`}>{used < 0.1 && s.used > 0 ? "<0.1" : used.toFixed(used < 10 ? 1 : 0)}%</span>
      </div>
      <div className="storage-bar" role="meter" aria-valuemin={0} aria-valuemax={s.quota} aria-valuenow={s.used} aria-label="พื้นที่ที่ใช้">
        {parts.map((p) => (
          <span key={p.key} style={{ width: `${pct(p.bytes)}%`, background: p.color }} title={`${p.label} ${bytes(p.bytes)}`} />
        ))}
      </div>
      <ul className="storage-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <span className="ft-dot" style={{ background: p.color }} aria-hidden />
            {p.label} <span className="muted">{bytes(p.bytes)}</span>
          </li>
        ))}
        <li>
          <span className="ft-dot free" aria-hidden />
          ว่าง <span className="muted">{bytes(Math.max(0, s.quota - s.used))}</span>
        </li>
      </ul>
      {level && <p className="small error">พื้นที่ใกล้เต็ม ลบไฟล์ที่ไม่ใช้แล้ว หรือปิดงานที่เสร็จแล้วเพื่อให้ระบบลบไฟล์ดิบตามนโยบาย</p>}
    </section>
  );
}

export default function Files({ engagement }: { engagement?: string }) {
  const [o, setO] = useState<FilesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [eng, setEng] = useState(engagement ?? "");
  const [ext, setExt] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("new");
  const [view, setView] = useState<"list" | "grid">("list");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = useCallback(
    () =>
      api<FilesOverview>("api/files")
        .then((x) => {
          setO(x);
          setError(null);
        })
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => void load(), [load]);
  useEffect(() => setEng(engagement ?? ""), [engagement]);

  const engOf = useMemo(() => new Map((o?.engagements ?? []).map((e) => [e.id, e])), [o]);
  const inEng = useMemo(() => (o?.files ?? []).filter((f) => !eng || f.engagement_id === eng), [o, eng]);
  const exts = useMemo(() => {
    const m = new Map<string, { count: number; bytes: number }>();
    for (const f of inEng) {
      const x = m.get(f.ext) ?? { count: 0, bytes: 0 };
      x.count++;
      x.bytes += f.size;
      m.set(f.ext, x);
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  }, [inEng]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inEng.filter((f) => (!ext || f.ext === ext) && (!needle || f.name.toLowerCase().includes(needle))).sort(sorters[sort]);
  }, [inEng, ext, q, sort]);
  useEffect(() => {
    if (ext && !exts.some(([x]) => x === ext)) setExt("");
  }, [ext, exts]);

  if (!o) return <p className="empty">{error ?? "กำลังโหลด…"}</p>;

  const canDelete = (f: ManagedFile) => !!engOf.get(f.engagement_id)?.can_delete;
  const chosen = shown.filter((f) => picked.has(f.id));
  const allPicked = shown.length > 0 && chosen.length === shown.length;
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const href = (f: ManagedFile) => `api/engagements/${f.engagement_id}/files/${f.id}`;

  const remove = async (list: ManagedFile[]) => {
    const ok = list.filter(canDelete);
    if (!ok.length) return;
    const used = ok.filter((f) => f.in_latest_run).length;
    const msg =
      (ok.length === 1 ? `ลบ ${ok[0].name}?` : `ลบ ${ok.length} ไฟล์ (${bytes(ok.reduce((n, f) => n + f.size, 0))})?`) +
      (used ? `\n\n${used} ไฟล์ถูกใช้ในผลการตรวจล่าสุด ผลการตรวจและภาพหน้าเอกสารยังเปิดดูได้ แต่การประมวลผลรอบถัดไปจะไม่มีไฟล์นี้` : "") +
      "\n\nการลบบันทึกไว้ในบันทึกการใช้งานของ Engagement และกู้คืนไม่ได้";
    if (!confirm(msg)) return;
    setBusy(true);
    setError(null);
    setNote(null);
    let done = 0;
    try {
      for (const f of ok) {
        setNote(`กำลังลบ ${done + 1}/${ok.length}: ${f.name}`);
        await api(`api/engagements/${f.engagement_id}/files/${f.id}/delete`, { method: "POST" });
        done++;
      }
      setNote(`ลบแล้ว ${done} ไฟล์`);
    } catch (x) {
      setError(`ลบได้ ${done} จาก ${ok.length} ไฟล์: ${(x as Error).message}`);
    } finally {
      setPicked(new Set());
      setBusy(false);
      await load();
    }
  };
  // One download per file (each is logged on the engagement), spaced so the browser allows them.
  const downloadAll = async (list: ManagedFile[]) => {
    for (const f of list) {
      const a = document.createElement("a");
      a.href = href(f);
      a.download = f.name;
      document.body.append(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 400));
    }
  };

  const engName = (f: ManagedFile) => engOf.get(f.engagement_id)?.client ?? "";
  const current = eng ? engOf.get(eng) : null;

  return (
    <div className="files-page">
      <a className="back" href={current ? `#/e/${current.id}` : "#/"}>
        ‹ {current ? current.client : "Engagement ทั้งหมด"}
      </a>
      <div className="between page-head">
        <div>
          <h2>จัดการไฟล์</h2>
          <p className="muted small">ไฟล์ดิบของทุก Engagement ที่คุณอยู่ในทีม · ไฟล์ดิบถูกลบอัตโนมัติหลังปิดงานตามนโยบาย กระดาษทำการและ Audit Trail เก็บไว้</p>
        </div>
      </div>

      <StorageMeter o={o} />

      {error && (
        <p className="small error" role="alert">
          {error}
        </p>
      )}
      {note && !error && <p className="small muted">{note}</p>}

      <div className="files-toolbar">
        <input className="search" type="search" placeholder="ค้นหาชื่อไฟล์" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาชื่อไฟล์" />
        <select value={eng} onChange={(e) => setEng(e.target.value)} aria-label="Engagement">
          <option value="">ทุก Engagement ({o.engagements.length})</option>
          {o.engagements.map((e) => (
            <option key={e.id} value={e.id}>
              {e.client}
              {e.period ? ` · ${e.period}` : ""}
              {e.status === "closed" ? " (ปิดแล้ว)" : ""}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="เรียงตาม">
          {SORTS.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <div className="segmented" role="radiogroup" aria-label="มุมมอง">
          <button role="radio" aria-checked={view === "list"} onClick={() => setView("list")}>
            รายการ
          </button>
          <button role="radio" aria-checked={view === "grid"} onClick={() => setView("grid")}>
            ไอคอน
          </button>
        </div>
      </div>

      <div className="ext-chips" role="radiogroup" aria-label="ประเภทไฟล์">
        <button role="radio" aria-checked={!ext} className="chip" onClick={() => setExt("")}>
          ทั้งหมด <span className="count">{inEng.length}</span>
        </button>
        {exts.map(([x, v]) => (
          <button key={x} role="radio" aria-checked={ext === x} className="chip" onClick={() => setExt(x)} title={bytes(v.bytes)}>
            <span className="ft-dot" style={{ background: KIND[kindOf(x)].color }} aria-hidden />.{x || "?"} <span className="count">{v.count}</span>
          </button>
        ))}
      </div>

      {chosen.length > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="ไฟล์ที่เลือก">
          <span>
            เลือก {chosen.length} ไฟล์ · {bytes(chosen.reduce((n, f) => n + f.size, 0))}
          </span>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => downloadAll(chosen)}>
              ดาวน์โหลด
            </button>
            <button className="btn destructive" disabled={busy || !chosen.some(canDelete)} onClick={() => remove(chosen)}>
              ลบ{chosen.some((f) => !canDelete(f)) ? ` (${chosen.filter(canDelete).length})` : ""}
            </button>
            <button className="link small" onClick={() => setPicked(new Set())}>
              ยกเลิกการเลือก
            </button>
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="group-body muted">{inEng.length ? "ไม่พบไฟล์ที่ตรงกับตัวกรอง" : o.engagements.length ? "ยังไม่มีไฟล์ อัปโหลดได้ที่หน้า Engagement" : "ยังไม่มี Engagement ที่คุณอยู่ในทีม"}</p>
      ) : view === "list" ? (
        <div className="group-body files-list">
          <table className="fields">
            <thead>
              <tr>
                <th className="pick">
                  <input
                    type="checkbox"
                    checked={allPicked}
                    aria-label="เลือกทั้งหมด"
                    onChange={() => setPicked(allPicked ? new Set() : new Set(shown.map((f) => f.id)))}
                  />
                </th>
                <th>ชื่อ</th>
                {!eng && <th className="hide-narrow">Engagement</th>}
                <th className="num">ขนาด</th>
                <th className="hide-narrow">อัปโหลด</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f.id} className={picked.has(f.id) ? "picked" : ""}>
                  <td className="pick">
                    <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} aria-label={`เลือก ${f.name}`} />
                  </td>
                  <td>
                    <div className="file-name">
                      <FileBadge ext={f.ext} />
                      <div>
                        <a href={href(f)} title={`SHA-256 ${f.sha256}`}>
                          {f.name}
                        </a>
                        {f.in_latest_run && <span className="pill ok small-pill">ใช้ในผลล่าสุด</span>}
                        {eng ? null : <div className="muted small show-narrow">{engName(f)}</div>}
                      </div>
                    </div>
                  </td>
                  {!eng && (
                    <td className="hide-narrow">
                      <a className="muted" href={`#/e/${f.engagement_id}`}>
                        {engName(f)}
                      </a>
                    </td>
                  )}
                  <td className="num muted">{bytes(f.size)}</td>
                  <td className="muted small hide-narrow">
                    {f.uploaded_by} · {when(f.uploaded_at)}
                  </td>
                  <td className="actions">
                    {canDelete(f) && (
                      <button className="link destructive small" disabled={busy} onClick={() => remove([f])}>
                        ลบ
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="files-grid">
          {shown.map((f) => (
            <li key={f.id} className={picked.has(f.id) ? "picked" : ""}>
              <label className="grid-pick">
                <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} aria-label={`เลือก ${f.name}`} />
              </label>
              <a href={href(f)} className="grid-tile" title={`${f.name} · ${bytes(f.size)}`}>
                <span className="grid-icon" style={{ background: KIND[kindOf(f.ext)].color }}>
                  {f.ext.toUpperCase().slice(0, 4)}
                </span>
                <strong>{f.name}</strong>
                <span className="muted small">
                  {bytes(f.size)} · {when(f.uploaded_at)}
                </span>
                {!eng && <span className="muted small">{engName(f)}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small files-foot">
        ลบได้เฉพาะ Engagement ที่ยังเปิดอยู่ · ทุกการดาวน์โหลดและลบถูกบันทึกในบันทึกการใช้งานของ Engagement
      </p>
    </div>
  );
}
