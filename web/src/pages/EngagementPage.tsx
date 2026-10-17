import { useCallback, useEffect, useRef, useState } from "react";
import { api, ROLE_LABEL, when, type EngagementDetail, type FileRow, type RunProgress } from "../api";
import { bi, locale, t } from "../i18n";
import { amount } from "../labels";
import Loading from "../components/Loading";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.tif,.tiff,.csv,.xlsx,.json";
const RUN_LABEL = bi({ queued: ["รอคิว", "Queued"], running: ["กำลังประมวลผล", "Processing"], done: ["เสร็จ", "Done"], failed: ["ไม่สำเร็จ", "Failed"] });
const ACTIVITY_LABEL: Record<string, string> = bi({
  create: ["สร้าง Engagement", "Created engagement"],
  member: ["กำหนดบทบาททีม", "Set team role"],
  remove_member: ["นำออกจากทีม", "Removed from team"],
  upload: ["อัปโหลด", "Uploaded"],
  replace_file: ["อัปโหลดแทนไฟล์เดิม", "Replaced file"],
  delete_file: ["ลบไฟล์", "Deleted file"],
  download: ["ดาวน์โหลด", "Downloaded"],
  run: ["เริ่มประมวลผล", "Started processing"],
  run_done: ["ประมวลผลเสร็จ", "Processing done"],
  run_failed: ["ประมวลผลไม่สำเร็จ", "Processing failed"],
  settings: ["แก้ tolerance / materiality", "Changed tolerance / materiality"],
  close: ["ปิดงาน", "Closed engagement"],
  purge: ["ลบไฟล์ดิบตามนโยบาย", "Purged raw files per policy"],
});
// Share of the bar each stage covers; the rest of a stage is filled by done/total.
const STAGE_SPAN: Record<RunProgress["stage"], [number, number]> = {
  waking: [0, 8],
  download: [8, 18],
  ocr: [18, 50],
  read: [50, 85],
  pages: [85, 88],
  check: [88, 92],
  upload: [92, 99],
};
const STAGE_LABEL = bi<RunProgress["stage"]>({
  waking: ["กำลังปลุกเครื่องประมวลผล (ครั้งแรกอาจรอราว 1 นาที)", "Waking the processor (the first run may take about a minute)"],
  download: ["ส่งไฟล์ไปเครื่องประมวลผล", "Sending files to the processor"],
  ocr: ["อ่านตัวอักษรจากรูป (OCR)", "Reading text from images (OCR)"],
  read: ["สกัดข้อมูลจากเอกสาร", "Extracting data from documents"],
  pages: ["เตรียมภาพหน้าเอกสาร", "Preparing page images"],
  check: ["จับคู่และตรวจความขัดแย้ง", "Matching and checking for conflicts"],
  upload: ["บันทึกผลและภาพหน้าเอกสาร", "Saving results and page images"],
});
const percent = (p: RunProgress) => {
  const [a, b] = STAGE_SPAN[p.stage];
  return Math.round(a + (b - a) * (p.total ? Math.min(1, (p.done ?? 0) / p.total) : 0));
};

function RunBar({ p, started }: { p: RunProgress; started: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((now - Date.parse(started)) / 1000));
  const count = p.total && p.stage !== "waking" ? ` ${Math.min(p.total, (p.done ?? 0) + (p.stage === "ocr" || p.stage === "upload" ? 0 : 1))}/${p.total}` : "";
  return (
    <div className="runbar" role="progressbar" aria-label={t("ความคืบหน้าการประมวลผล", "Processing progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(p)}>
      <div className="runbar-track">
        <div className="runbar-fill" style={{ width: `${percent(p)}%` }} />
      </div>
      <p className="small">
        {STAGE_LABEL[p.stage]}
        {count}
        {p.file && (p.stage === "read" || p.stage === "download") ? ` · ${p.file}` : ""}
        <span className="muted"> · {percent(p)}% · {t("ผ่านไป", "elapsed")} {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
      </p>
    </div>
  );
}

const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const detailText = (d: Record<string, unknown> | null) =>
  !d ? "" : [d.file, d.user && `${d.user}${d.role ? ` → ${ROLE_LABEL[String(d.role)] ?? d.role}` : ""}`, d.flags != null && `${d.flags} ${t("จุดควรตรวจ", "to check")}`, d.error].filter(Boolean).join(" · ");

export default function EngagementPage({ id }: { id: string }) {
  const [d, setD] = useState<EngagementDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const load = useCallback(
    () =>
      api<EngagementDetail>(`api/engagements/${id}`)
        .then((x) => {
          setD(x);
          setError(null);
        })
        .catch((e) => setError(e.message)),
    [id],
  );
  useEffect(() => void load(), [load]);

  // While a run is in progress, refresh every few seconds.
  const running = d?.runs.some((r) => r.status === "running" || r.status === "queued");
  // Also while the start request itself is still waiting for the free host to wake up (busy).
  useEffect(() => {
    if (!running && !busy) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [running, busy, load]);

  const role = d?.engagement.my_role;
  const open = d?.engagement.status === "open";

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      if (done) setNote(done);
      await load();
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const upload = (files: FileList | null) =>
    files &&
    act(async () => {
      const list = [...files];
      for (const [i, f] of list.entries()) {
        setNote(t(`กำลังอัปโหลด ${i + 1}/${list.length}: ${f.name}`, `Uploading ${i + 1}/${list.length}: ${f.name}`));
        await api(`api/engagements/${id}/files?name=${encodeURIComponent(f.name.normalize("NFC"))}`, { bytes: f });
      }
      if (input.current) input.current.value = "";
    }, t(`อัปโหลดแล้ว ${files.length} ไฟล์`, `Uploaded ${files.length} file(s)`));

  if (!d) return error ? <p className="empty error">{error}</p> : <Loading />;
  const e = d.engagement;
  const purgeOn = e.closed_at ? new Date(Date.parse(e.closed_at) + d.retention_days * 86400_000) : null;
  const docs = d.files.filter((f) => f.name !== "remember.json");
  // A file counts as processed when the newest finished run saw this name with the same content (new uploads and replaced files do not).
  const latest = d.runs.find((r) => r.status === "done" && r.result_run_id === d.current_run);
  const seen = new Map((latest?.summary?.files ?? []).map((f) => [f.name, f]));
  const statusOf = (f: FileRow) => {
    const x = seen.get(f.name);
    return x && (x.sha256 === null || x.sha256 === f.sha256) ? x : null;
  };
  const fresh = d.files.filter((f) => !statusOf(f));
  const processed = d.files.filter((f) => statusOf(f));
  // The "Processed on … · N to check" bar carries the run context, so its button wins; the header one is only a fallback.
  const doneBanner = !!latest && fresh.length === 0 && d.files.length > 0;
  const unreadable = processed.filter((f) => !statusOf(f)!.read).length;

  const FileTable = ({ rows }: { rows: FileRow[] }) => (
    <table className="fields files-table">
      <tbody>
        {rows.map((f) => {
          const st = statusOf(f);
          return (
            <tr key={f.id}>
              <td>
                <a href={`api/engagements/${id}/files/${f.id}`} title={`SHA-256 ${f.sha256}`}>
                  <span className="ext" aria-hidden>
                    {f.name.split(".").pop()?.slice(0, 4).toUpperCase()}
                  </span>
                  {f.name}
                </a>
                {st && (
                  <div className="small">
                    <span className={"pill " + (st.read ? "ok" : "bad")}>{st.read ? t("ประมวลผลแล้ว", "Processed") : t("อ่านไม่ได้", "Unreadable")}</span>
                    {!st.read && st.reason && <span className="error"> {st.reason}</span>}
                  </div>
                )}
              </td>
              <td className="muted small num">{size(f.size)}</td>
              <td className="muted small">
                {f.uploaded_by} · {when(f.uploaded_at)}
              </td>
              <td>
                {open && (
                  <button
                    className="link destructive small"
                    disabled={busy}
                    onClick={() => confirm(t(`ลบ ${f.name}?`, `Delete ${f.name}?`)) && act(() => api(`api/engagements/${id}/files/${f.id}/delete`, { method: "POST" }))}
                  >
                    {t("ลบ", "Delete")}
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div>
      <a className="back" href="#/">
        ‹ {t("Engagement ทั้งหมด", "All engagements")}
      </a>
      <div className="between page-head">
        <div>
          <h2>{e.client}</h2>
          <p className="muted small">
            {e.period ? `${e.period} · ` : ""}
            {t("บทบาทของคุณ", "Your role")}: {ROLE_LABEL[e.my_role]} · {t("เกณฑ์คลาดเคลื่อน", "Tolerance")} {e.tolerance_pct}% · {t("เกณฑ์สาระสำคัญ", "Materiality")}{" "}
            {amount(e.materiality_thb)} ฿{e.synthetic && ` · ${t("ข้อมูลสมมติ", "Synthetic")}`}
          </p>
        </div>
        <div className="row">
          <span className={"pill " + (open ? "ok" : "")}>{open ? t("เปิดอยู่", "Open") : t("ปิดแล้ว", "Closed")}</span>
          {d.current_run && !doneBanner && (
            <a className="btn filled" href={`#/e/${id}/review`}>
              {t("เปิดผลการตรวจ", "Open results")}
            </a>
          )}
        </div>
      </div>
      {!open && (
        <p className="banner" role="note">
          {t("ปิดงานเมื่อ", "Closed on")} {when(e.closed_at!)} · {t("ดูได้อย่างเดียว", "Read only")} ·{" "}
          {e.purged_at
            ? t(
                `ไฟล์ดิบและภาพหน้าเอกสารถูกลบแล้วเมื่อ ${when(e.purged_at)} (กระดาษทำการและ Audit Trail ยังอยู่)`,
                `Raw files and page images were deleted on ${when(e.purged_at)} (the working paper and Audit Trail remain)`,
              )
            : t(
                `ไฟล์ดิบจะถูกลบอัตโนมัติประมาณ ${purgeOn!.toLocaleDateString(locale(), { dateStyle: "medium" })} (${d.retention_days} วันหลังปิดงาน)`,
                `Raw files will be deleted automatically around ${purgeOn!.toLocaleDateString(locale(), { dateStyle: "medium" })} (${d.retention_days} days after closing)`,
              )}
        </p>
      )}
      {error && (
        <p className="small error" role="alert">
          {error}
        </p>
      )}
      {note && !error && <p className="small muted">{note}</p>}

      <div className="eng-grid">
        <div>
          <section className="group">
            <h3 className="group-title between row">
              <span>
                {t("เอกสารของ Engagement", "Engagement documents")} ({d.files.length})
              </span>
              <a className="link small" href={`#/files/${id}`}>
                {t("จัดการไฟล์ ›", "Manage files ›")}
              </a>
            </h3>
            <div className="group-body">
              {!d.store_configured && <p className="small error">{t("ยังไม่ได้ตั้งค่ากุญแจเข้ารหัสไฟล์ (FILES_KEY) จึงอัปโหลดไม่ได้", "The file encryption key (FILES_KEY) is not set, so uploads are off.")}</p>}
              {open && role && (
                <div
                  className={"dropzone" + (dragging ? " over" : "")}
                  onDragOver={(ev) => {
                    ev.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(ev) => {
                    ev.preventDefault();
                    setDragging(false);
                    upload(ev.dataTransfer.files);
                  }}
                >
                  <span className="drop-icon" aria-hidden>
                    ⇪
                  </span>
                  <p>
                    {t("ลากไฟล์มาวาง หรือ", "Drop files here or")}{" "}
                    <button className="link" disabled={busy} onClick={() => input.current?.click()}>
                      {t("เลือกไฟล์", "choose files")}
                    </button>
                  </p>
                  <p className="muted small">{t("PDF, สแกน (PNG/JPG/TIFF), CSV, XLSX ไม่เกิน 100 MB ต่อไฟล์", "PDF, scans (PNG/JPG/TIFF), CSV, XLSX up to 100 MB each")}</p>
                  <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(ev) => upload(ev.target.files)} />
                </div>
              )}
              {d.files.length === 0 ? (
                <p className="muted small">{e.purged_at ? t("ไฟล์ถูกลบตามนโยบายแล้ว", "Files were deleted per the retention policy") : t("ยังไม่มีไฟล์", "No files yet")}</p>
              ) : (
                <>
                  {doneBanner && latest && (
                    <div className="banner done-banner" role="status">
                      <span>
                        {t("ประมวลผลเสร็จเมื่อ", "Processed on")} {when(latest.finished_at ?? latest.started_at)} · {latest.summary?.flags ?? 0}{" "}
                        {t("จุดควรตรวจ", "to check")}
                        {unreadable > 0 && ` · ${t(`อ่านไม่ได้ ${unreadable} ไฟล์`, `${unreadable} unreadable`)}`}
                      </span>{" "}
                      <a className="btn filled" href={`#/e/${id}/review`}>
                        {t("เปิดผลการตรวจ", "Open results")}
                      </a>
                    </div>
                  )}
                  {fresh.length > 0 && (
                    <>
                      {latest && (
                        <p className="muted small">
                          {t("รอประมวลผล", "Not yet processed")} ({fresh.length}) ·{" "}
                          {t("ไฟล์ใหม่หรือไฟล์ที่ถูกแทนที่หลังรอบล่าสุด", "new or replaced since the last run")}
                        </p>
                      )}
                      <FileTable rows={fresh} />
                    </>
                  )}
                  {processed.length > 0 && (
                    <details className="processed" open={unreadable > 0 || fresh.length === 0}>
                      <summary>
                        {t("ประมวลผลแล้ว", "Processed")} ({processed.length})
                        {unreadable > 0 && (
                          <span className="pill bad">
                            {t("อ่านไม่ได้", "Unreadable")} {unreadable}
                          </span>
                        )}
                      </summary>
                      <FileTable rows={processed} />
                    </details>
                  )}
                </>
              )}
            </div>
          </section>

          <section className="group">
            <h3 className="group-title">{t("ประมวลผล", "Processing")}</h3>
            <div className="group-body stack">
              {open && (
                <div className="row">
                  <button
                    className="btn filled"
                    disabled={busy || running || !docs.length || !d.pipeline_configured}
                    onClick={() => act(() => api(`api/engagements/${id}/runs`, { method: "POST" }), t("เริ่มประมวลผลแล้ว ระบบจะอัปเดตสถานะให้เอง", "Processing started. Status updates on its own."))}
                  >
                    {running ? t("กำลังประมวลผล…", "Processing…") : busy ? t("กำลังปลุกเครื่องประมวลผล…", "Waking the processor…") : t("ประมวลผลเอกสารทั้งหมด", "Process all documents")}
                  </button>
                  <span className="muted small">
                    {d.pipeline_configured
                      ? t(
                          "อ่านเอกสาร จับคู่ และตรวจขัดแย้งบน server (ครั้งแรกของวันอาจรอเครื่องตื่นราว 1 นาที)",
                          "Reads, matches and checks documents on the server (the first run of the day may wait about a minute)",
                        )
                      : t("ยังไม่ได้ตั้งค่าเครื่องประมวลผล (PIPELINE_URL)", "The processor (PIPELINE_URL) is not configured")}
                  </span>
                </div>
              )}
              {d.runs.length === 0 ? (
                <p className="muted small">{t("ยังไม่เคยประมวลผล", "Not processed yet")}</p>
              ) : (
                <ol className="runs">
                  {d.runs.map((r) => (
                    <li key={r.id}>
                      <span className={"pill " + (r.status === "done" ? "ok" : r.status === "failed" ? "bad" : "warn")}>{RUN_LABEL[r.status]}</span>{" "}
                      <span className="muted small">
                        {when(r.started_at)} · {r.files} {t("ไฟล์", "files")}
                      </span>
                      {r.summary && (
                        <span className="small">
                          {" "}
                          · {r.summary.flags} {t("จุดควรตรวจ", "to check")} · {t("รอจับคู่", "unmatched")} {r.summary.pending} · {r.summary.documents}{" "}
                          {t("เอกสาร", "documents")}
                          {r.summary.unreadable > 0 && ` · ${t(`อ่านไม่ได้ ${r.summary.unreadable} ไฟล์`, `${r.summary.unreadable} unreadable`)}`}
                          {r.summary.documents === 0 &&
                            ` · ${t("ไม่พบเอกสารที่อ่านได้ (เปิดหน้าผลเพื่อดูสาเหตุรายไฟล์)", "no readable documents (open the results for per-file reasons)")}`}
                        </span>
                      )}
                      {r.status === "running" && <RunBar p={r.progress ?? { stage: "waking", done: 0, total: r.files, file: null, at: r.started_at }} started={r.started_at} />}
                      {r.error && <span className="small error"> · {r.error}</span>}
                      {r.result_run_id === d.current_run && r.status === "done" && <span className="muted small"> · {t("ผลที่แสดงอยู่", "current results")}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </div>

        <div>
          <section className="group">
            <h3 className="group-title">{t("บันทึกการใช้งาน", "Activity log")}</h3>
            <div className="group-body">
              <ol className="activity">
                {d.activity.map((a) => (
                  <li key={a.seq}>
                    <span className="muted small">
                      {when(a.at)} · {a.actor === "SYSTEM" ? t("ระบบ", "System") : a.actor}
                    </span>{" "}
                    {ACTIVITY_LABEL[a.action] ?? a.action}
                    <span className="muted small"> {detailText(a.detail)}</span>
                  </li>
                ))}
              </ol>
              <p className="muted small">{t("บันทึกนี้เพิ่มได้อย่างเดียว แก้หรือลบไม่ได้", "This log is append-only; entries cannot be edited or deleted.")}</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
