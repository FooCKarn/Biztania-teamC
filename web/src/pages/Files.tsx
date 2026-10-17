import { useCallback, useEffect, useMemo, useState } from "react";
import { api, when, type FilesOverview, type ManagedFile } from "../api";
import { bi, t } from "../i18n";
import "./files.css";

// File manager: storage meter and the user's files. Page images count toward storage but are not listed.

const KIND: Record<string, { color: string }> = {
  pdf: { color: "var(--ft-pdf)" },
  image: { color: "var(--ft-image)" },
  csv: { color: "var(--ft-csv)" },
  xlsx: { color: "var(--ft-xlsx)" },
  json: { color: "var(--ft-json)" },
  other: { color: "var(--ft-other)" },
};
const KIND_LABEL: Record<string, string> = bi({
  pdf: ["PDF", "PDF"],
  image: ["รูปภาพ", "Images"],
  csv: ["CSV", "CSV"],
  xlsx: ["Excel", "Excel"],
  json: ["กฎบริษัท (JSON)", "Company rules (JSON)"],
  other: ["อื่นๆ", "Other"],
});
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
const SORT_LABEL = bi<Sort>({
  new: ["อัปโหลดล่าสุด", "Newest upload"],
  old: ["อัปโหลดเก่าสุด", "Oldest upload"],
  name: ["ชื่อ ก–ฮ / A–Z", "Name A–Z"],
  big: ["ขนาดใหญ่สุด", "Largest"],
  small: ["ขนาดเล็กสุด", "Smallest"],
});
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
    ...[...byKind.entries()].map(([k, b]) => ({ key: k, label: KIND_LABEL[k], color: KIND[k].color, bytes: b })),
    { key: "pages", label: t("ภาพหน้าเอกสารและผลการตรวจ", "Page images and results"), color: "var(--ft-pages)", bytes: s.pages },
    { key: "others", label: t("Engagement อื่นในสำนักงาน", "Other engagements in the firm"), color: "var(--ft-others)", bytes: s.others },
    { key: "overhead", label: t("ระบบฐานข้อมูล", "Database"), color: "var(--ft-overhead)", bytes: s.overhead },
  ].filter((p) => p.bytes > 0);
  const pct = (n: number) => Math.min(100, (n / s.quota) * 100);
  const used = pct(s.used);
  const level = used >= 90 ? "bad" : used >= 75 ? "warn" : "";
  return (
    <section className="group-body storage" aria-label={t("พื้นที่จัดเก็บ", "Storage")}>
      <div className="between row">
        <div>
          <p className="storage-big">
            {t("ใช้ไป", "Used")} <strong>{bytes(s.used)}</strong> <span className="muted">{t("จาก", "of")} {bytes(s.quota)}</span>
          </p>
          <p className="muted small">
            {t(`ไฟล์ของคุณ ${o.files.length} ไฟล์`, `Your files: ${o.files.length}`)} · {bytes(s.files)} · {t("เข้ารหัสแยกต่อ Engagement", "Encrypted per engagement")}
          </p>
        </div>
        <span className={`pill ${level}`}>{used < 0.1 && s.used > 0 ? "<0.1" : used.toFixed(used < 10 ? 1 : 0)}%</span>
      </div>
      <div className="storage-bar" role="meter" aria-valuemin={0} aria-valuemax={s.quota} aria-valuenow={s.used} aria-label={t("พื้นที่ที่ใช้", "Storage used")}>
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
          {t("ว่าง", "Free")} <span className="muted">{bytes(Math.max(0, s.quota - s.used))}</span>
        </li>
      </ul>
      {level && <p className="small error">{t("พื้นที่ใกล้เต็ม ลบไฟล์ที่ไม่ใช้แล้ว หรือปิดงานที่เสร็จแล้วเพื่อให้ระบบลบไฟล์ดิบตามนโยบาย", "Storage is nearly full. Delete files you no longer need, or close finished engagements so raw files are removed under the retention policy.")}</p>}
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

  if (!o) return <p className="empty">{error ?? t("กำลังโหลด…", "Loading…")}</p>;

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
      (ok.length === 1
        ? t(`ลบ ${ok[0].name}?`, `Delete ${ok[0].name}?`)
        : t(`ลบ ${ok.length} ไฟล์ (${bytes(ok.reduce((n, f) => n + f.size, 0))})?`, `Delete ${ok.length} files (${bytes(ok.reduce((n, f) => n + f.size, 0))})?`)) +
      (used
        ? t(
            `\n\n${used} ไฟล์ถูกใช้ในผลการตรวจล่าสุด ผลการตรวจและภาพหน้าเอกสารยังเปิดดูได้ แต่การประมวลผลรอบถัดไปจะไม่มีไฟล์นี้`,
            `\n\n${used} of these files are in the latest results. The results and page images stay viewable, but the next run will not have the file.`,
          )
        : "") +
      t("\n\nการลบบันทึกไว้ในบันทึกการใช้งานของ Engagement และกู้คืนไม่ได้", "\n\nThe deletion is recorded in the engagement's usage log and cannot be undone.");
    if (!confirm(msg)) return;
    setBusy(true);
    setError(null);
    setNote(null);
    let done = 0;
    try {
      for (const f of ok) {
        setNote(t(`กำลังลบ ${done + 1}/${ok.length}: ${f.name}`, `Deleting ${done + 1}/${ok.length}: ${f.name}`));
        await api(`api/engagements/${f.engagement_id}/files/${f.id}/delete`, { method: "POST" });
        done++;
      }
      setNote(t(`ลบแล้ว ${done} ไฟล์`, `Deleted ${done} files`));
    } catch (x) {
      setError(t(`ลบได้ ${done} จาก ${ok.length} ไฟล์: ${(x as Error).message}`, `Deleted ${done} of ${ok.length} files: ${(x as Error).message}`));
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
        ‹ {current ? current.client : t("Engagement ทั้งหมด", "All engagements")}
      </a>
      <div className="between page-head">
        <div>
          <h2>{t("จัดการไฟล์", "Files")}</h2>
          <p className="muted small">
            {t(
              "ไฟล์ดิบของทุก Engagement ที่คุณอยู่ในทีม · ไฟล์ดิบถูกลบอัตโนมัติหลังปิดงานตามนโยบาย กระดาษทำการและ Audit Trail เก็บไว้",
              "Raw files of every engagement you are on · Raw files are deleted automatically after closing under the retention policy; the working paper and Audit Trail are kept",
            )}
          </p>
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
        <input className="search" type="search" placeholder={t("ค้นหาชื่อไฟล์", "Search file names")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("ค้นหาชื่อไฟล์", "Search file names")} />
        <select value={eng} onChange={(e) => setEng(e.target.value)} aria-label="Engagement">
          <option value="">{t("ทุก Engagement", "All engagements")} ({o.engagements.length})</option>
          {o.engagements.map((e) => (
            <option key={e.id} value={e.id}>
              {e.client}
              {e.period ? ` · ${e.period}` : ""}
              {e.status === "closed" ? t(" (ปิดแล้ว)", " (closed)") : ""}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t("เรียงตาม", "Sort by")}>
          {(Object.keys(SORT_LABEL) as Sort[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABEL[k]}
            </option>
          ))}
        </select>
        <div className="segmented" role="radiogroup" aria-label={t("มุมมอง", "View")}>
          <button role="radio" aria-checked={view === "list"} onClick={() => setView("list")}>
            {t("รายการ", "List")}
          </button>
          <button role="radio" aria-checked={view === "grid"} onClick={() => setView("grid")}>
            {t("ไอคอน", "Icons")}
          </button>
        </div>
      </div>

      <div className="ext-chips" role="radiogroup" aria-label={t("ประเภทไฟล์", "File type")}>
        <button role="radio" aria-checked={!ext} className="chip" onClick={() => setExt("")}>
          {t("ทั้งหมด", "All")} <span className="count">{inEng.length}</span>
        </button>
        {exts.map(([x, v]) => (
          <button key={x} role="radio" aria-checked={ext === x} className="chip" onClick={() => setExt(x)} title={bytes(v.bytes)}>
            <span className="ft-dot" style={{ background: KIND[kindOf(x)].color }} aria-hidden />.{x || "?"} <span className="count">{v.count}</span>
          </button>
        ))}
      </div>

      {chosen.length > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label={t("ไฟล์ที่เลือก", "Selected files")}>
          <span>
            {t(`เลือก ${chosen.length} ไฟล์`, `${chosen.length} selected`)} · {bytes(chosen.reduce((n, f) => n + f.size, 0))}
          </span>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => downloadAll(chosen)}>
              {t("ดาวน์โหลด", "Download")}
            </button>
            <button className="btn destructive" disabled={busy || !chosen.some(canDelete)} onClick={() => remove(chosen)}>
              {t("ลบ", "Delete")}{chosen.some((f) => !canDelete(f)) ? ` (${chosen.filter(canDelete).length})` : ""}
            </button>
            <button className="link small" onClick={() => setPicked(new Set())}>
              {t("ยกเลิกการเลือก", "Clear selection")}
            </button>
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="group-body muted">{inEng.length ? t("ไม่พบไฟล์ที่ตรงกับตัวกรอง", "No files match the filter") : o.engagements.length ? t("ยังไม่มีไฟล์ อัปโหลดได้ที่หน้า Engagement", "No files yet. Upload them on the engagement page.") : t("ยังไม่มี Engagement ที่คุณอยู่ในทีม", "You are not on any engagement team yet")}</p>
      ) : view === "list" ? (
        <div className="group-body files-list">
          <table className="fields">
            <thead>
              <tr>
                <th className="pick">
                  <input
                    type="checkbox"
                    checked={allPicked}
                    aria-label={t("เลือกทั้งหมด", "Select all")}
                    onChange={() => setPicked(allPicked ? new Set() : new Set(shown.map((f) => f.id)))}
                  />
                </th>
                <th>{t("ชื่อ", "Name")}</th>
                {!eng && <th className="hide-narrow">Engagement</th>}
                <th className="num">{t("ขนาด", "Size")}</th>
                <th className="hide-narrow">{t("อัปโหลด", "Uploaded")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f.id} className={picked.has(f.id) ? "picked" : ""}>
                  <td className="pick">
                    <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} aria-label={t(`เลือก ${f.name}`, `Select ${f.name}`)} />
                  </td>
                  <td>
                    <div className="file-name">
                      <FileBadge ext={f.ext} />
                      <div>
                        <a href={href(f)} title={`SHA-256 ${f.sha256}`}>
                          {f.name}
                        </a>
                        {f.in_latest_run && <span className="pill ok small-pill">{t("ใช้ในผลล่าสุด", "In latest results")}</span>}
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
                        {t("ลบ", "Delete")}
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
                <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} aria-label={t(`เลือก ${f.name}`, `Select ${f.name}`)} />
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
        {t(
          "ลบได้เฉพาะ Engagement ที่ยังเปิดอยู่ · ทุกการดาวน์โหลดและลบถูกบันทึกในบันทึกการใช้งานของ Engagement",
          "Files can be deleted only while the engagement is open · Every download and delete is recorded in the engagement's usage log",
        )}
      </p>
    </div>
  );
}
