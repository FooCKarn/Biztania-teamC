import { useCallback, useEffect, useRef, useState } from "react";
import { api, ROLE_LABEL, when, type EngagementDetail, type FileRow, type Role, type RunProgress, type User } from "../api";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.tif,.tiff,.csv,.xlsx,.json";
const RUN_LABEL = { queued: "รอคิว", running: "กำลังประมวลผล", done: "เสร็จ", failed: "ไม่สำเร็จ" } as const;
const ACTIVITY_LABEL: Record<string, string> = {
  create: "สร้าง Engagement",
  member: "กำหนดบทบาททีม",
  remove_member: "นำออกจากทีม",
  upload: "อัปโหลด",
  replace_file: "อัปโหลดแทนไฟล์เดิม",
  delete_file: "ลบไฟล์",
  download: "ดาวน์โหลด",
  run: "เริ่มประมวลผล",
  run_done: "ประมวลผลเสร็จ",
  run_failed: "ประมวลผลไม่สำเร็จ",
  settings: "แก้ tolerance / materiality",
  close: "ปิดงาน",
  purge: "ลบไฟล์ดิบตามนโยบาย",
};
// Share of the bar each stage covers; the rest of a stage is filled by done/total.
const STAGE_SPAN: Record<RunProgress["stage"], [number, number, string]> = {
  waking: [0, 8, "กำลังปลุกเครื่องประมวลผล (ครั้งแรกอาจรอราว 1 นาที)"],
  download: [8, 18, "ส่งไฟล์ไปเครื่องประมวลผล"],
  ocr: [18, 50, "อ่านตัวอักษรจากรูป (OCR)"],
  read: [50, 85, "สกัดข้อมูลจากเอกสาร"],
  pages: [85, 88, "เตรียมภาพหน้าเอกสาร"],
  check: [88, 92, "จับคู่และตรวจความขัดแย้ง"],
  upload: [92, 99, "บันทึกผลและภาพหน้าเอกสาร"],
};
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
    <div className="runbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(p)}>
      <div className="runbar-track">
        <div className="runbar-fill" style={{ width: `${percent(p)}%` }} />
      </div>
      <p className="small">
        {STAGE_SPAN[p.stage][2]}
        {count}
        {p.file && (p.stage === "read" || p.stage === "download") ? ` · ${p.file}` : ""}
        <span className="muted"> · {percent(p)}% · ผ่านไป {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
      </p>
    </div>
  );
}

const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const detailText = (d: Record<string, unknown> | null) =>
  !d ? "" : [d.file, d.user && `${d.user}${d.role ? ` → ${ROLE_LABEL[String(d.role)] ?? d.role}` : ""}`, d.flags != null && `${d.flags} จุดควรตรวจ`, d.error].filter(Boolean).join(" · ");

export default function EngagementPage({ id, me }: { id: string; me: User }) {
  const [d, setD] = useState<EngagementDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [add, setAdd] = useState<{ user: string; role: Role }>({ user: "", role: "preparer" });
  const [settings, setSettings] = useState<{ t: string; m: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

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
  const manager = role === "manager";
  const open = d?.engagement.status === "open";
  useEffect(() => {
    if (manager) api<{ users: User[] }>("api/users").then((r) => setUsers(r.users)).catch(() => undefined);
  }, [manager]);

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
        setNote(`กำลังอัปโหลด ${i + 1}/${list.length}: ${f.name}`);
        await api(`api/engagements/${id}/files?name=${encodeURIComponent(f.name.normalize("NFC"))}`, { bytes: f });
      }
      if (input.current) input.current.value = "";
    }, `อัปโหลดแล้ว ${files.length} ไฟล์`);

  if (!d) return <p className="empty">{error ?? "กำลังโหลด…"}</p>;
  const e = d.engagement;
  const purgeOn = e.closed_at ? new Date(Date.parse(e.closed_at) + d.retention_days * 86400_000) : null;
  const memberIds = new Set(d.members.map((m) => m.id));
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
                  {f.name}
                </a>
                {st && (
                  <div className="small">
                    <span className={"pill " + (st.read ? "ok" : "bad")}>{st.read ? "ประมวลผลแล้ว" : "อ่านไม่ได้"}</span>
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
                    onClick={() => confirm(`ลบ ${f.name}?`) && act(() => api(`api/engagements/${id}/files/${f.id}/delete`, { method: "POST" }))}
                  >
                    ลบ
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
        ‹ Engagement ทั้งหมด
      </a>
      <div className="between page-head">
        <div>
          <h2>{e.client}</h2>
          <p className="muted small">
            {e.period ? `${e.period} · ` : ""}บทบาทของคุณ: {ROLE_LABEL[e.my_role]} · tolerance {e.tolerance_pct}% · materiality{" "}
            {e.materiality_thb.toLocaleString("th-TH")} ฿{e.synthetic && " · ข้อมูลสมมติ"}
          </p>
        </div>
        <div className="row">
          <span className={"pill " + (open ? "ok" : "")}>{open ? "เปิดอยู่" : "ปิดแล้ว"}</span>
          {d.current_run && (
            <a className="btn filled" href={`#/e/${id}/review`}>
              เปิดผลการตรวจ
            </a>
          )}
        </div>
      </div>
      {!open && (
        <p className="banner" role="note">
          ปิดงานเมื่อ {when(e.closed_at!)} · ดูได้อย่างเดียว ·{" "}
          {e.purged_at
            ? `ไฟล์ดิบและภาพหน้าเอกสารถูกลบแล้วเมื่อ ${when(e.purged_at)} (กระดาษทำการและ Audit Trail ยังอยู่)`
            : `ไฟล์ดิบจะถูกลบอัตโนมัติประมาณ ${purgeOn!.toLocaleDateString("th-TH", { dateStyle: "medium" })} (${d.retention_days} วันหลังปิดงาน)`}
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
              เอกสารของ Engagement ({d.files.length})
              <a className="link small" href={`#/files/${id}`}>
                จัดการไฟล์ ›
              </a>
            </h3>
            <div className="group-body">
              {!d.store_configured && <p className="small error">ยังไม่ได้ตั้งค่ากุญแจเข้ารหัสไฟล์ (FILES_KEY) จึงอัปโหลดไม่ได้</p>}
              {open && role && (
                <div
                  className="dropzone"
                  onDragOver={(ev) => ev.preventDefault()}
                  onDrop={(ev) => {
                    ev.preventDefault();
                    upload(ev.dataTransfer.files);
                  }}
                >
                  <p>
                    ลากไฟล์มาวาง หรือ{" "}
                    <button className="link" disabled={busy} onClick={() => input.current?.click()}>
                      เลือกไฟล์
                    </button>
                  </p>
                  <p className="muted small">PDF, สแกน (PNG/JPG/TIFF), CSV, XLSX ไม่เกิน 10 MB ต่อไฟล์ · กฎของบริษัทใส่เป็น remember.json · ไฟล์ถูกเข้ารหัสแยกต่อ Engagement</p>
                  <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(ev) => upload(ev.target.files)} />
                </div>
              )}
              {d.files.length === 0 ? (
                <p className="muted small">{e.purged_at ? "ไฟล์ถูกลบตามนโยบายแล้ว" : "ยังไม่มีไฟล์"}</p>
              ) : (
                <>
                  {latest && fresh.length === 0 && (
                    <div className="banner done-banner" role="status">
                      <span>
                        ประมวลผลเสร็จเมื่อ {when(latest.finished_at ?? latest.started_at)} · {latest.summary?.flags ?? 0} จุดควรตรวจ
                        {unreadable > 0 && ` · อ่านไม่ได้ ${unreadable} ไฟล์`}
                      </span>{" "}
                      <a className="btn filled" href={`#/e/${id}/review`}>
                        เปิดผลการตรวจ
                      </a>
                    </div>
                  )}
                  {fresh.length > 0 && (
                    <>
                      {latest && <p className="muted small">รอประมวลผล ({fresh.length}) · ไฟล์ใหม่หรือไฟล์ที่ถูกแทนที่หลังรอบล่าสุด</p>}
                      <FileTable rows={fresh} />
                    </>
                  )}
                  {processed.length > 0 && (
                    <details className="processed" open={unreadable > 0 || fresh.length === 0}>
                      <summary>
                        ประมวลผลแล้ว ({processed.length}){unreadable > 0 && <span className="pill bad"> อ่านไม่ได้ {unreadable}</span>}
                      </summary>
                      <FileTable rows={processed} />
                    </details>
                  )}
                </>
              )}
            </div>
          </section>

          <section className="group">
            <h3 className="group-title">ประมวลผล</h3>
            <div className="group-body stack">
              {open && (
                <div className="row">
                  <button
                    className="btn filled"
                    disabled={busy || running || !docs.length || !d.pipeline_configured}
                    onClick={() => act(() => api(`api/engagements/${id}/runs`, { method: "POST" }), "เริ่มประมวลผลแล้ว ระบบจะอัปเดตสถานะให้เอง")}
                  >
                    {running ? "กำลังประมวลผล…" : busy ? "กำลังปลุกเครื่องประมวลผล…" : "ประมวลผลเอกสารทั้งหมด"}
                  </button>
                  <span className="muted small">
                    {d.pipeline_configured
                      ? "อ่านเอกสาร จับคู่ และตรวจขัดแย้งบน server (ครั้งแรกของวันอาจรอเครื่องตื่นราว 1 นาที)"
                      : "ยังไม่ได้ตั้งค่าเครื่องประมวลผล (PIPELINE_URL)"}
                  </span>
                </div>
              )}
              {d.runs.length === 0 ? (
                <p className="muted small">ยังไม่เคยประมวลผล</p>
              ) : (
                <ol className="runs">
                  {d.runs.map((r) => (
                    <li key={r.id}>
                      <span className={"pill " + (r.status === "done" ? "ok" : r.status === "failed" ? "bad" : "warn")}>{RUN_LABEL[r.status]}</span>{" "}
                      <span className="muted small">
                        {when(r.started_at)} · {r.files} ไฟล์
                      </span>
                      {r.summary && (
                        <span className="small">
                          {" "}
                          · {r.summary.flags} จุดควรตรวจ · รอจับคู่ {r.summary.pending} · {r.summary.documents} เอกสาร
                          {r.summary.unreadable > 0 && ` · อ่านไม่ได้ ${r.summary.unreadable} ไฟล์`}
                          {r.summary.documents === 0 && " · ไม่พบเอกสารที่อ่านได้ (เปิดหน้าผลเพื่อดูสาเหตุรายไฟล์)"}
                        </span>
                      )}
                      {r.status === "running" && <RunBar p={r.progress ?? { stage: "waking", done: 0, total: r.files, file: null, at: r.started_at }} started={r.started_at} />}
                      {r.error && <span className="small error"> · {r.error}</span>}
                      {r.result_run_id === d.current_run && r.status === "done" && <span className="muted small"> · ผลที่แสดงอยู่</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </div>

        <div>
          <section className="group">
            <h3 className="group-title">ทีม</h3>
            <div className="group-body">
              <table className="fields">
                <tbody>
                  {d.members.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <strong>{m.initials}</strong> {m.name}
                        {m.id === me.id && <span className="muted small"> (คุณ)</span>}
                      </td>
                      <td>
                        {manager && open ? (
                          <select
                            value={m.role}
                            disabled={busy}
                            aria-label={`บทบาทของ ${m.name}`}
                            onChange={(ev) => act(() => api(`api/engagements/${id}/members`, { body: { user_id: m.id, role: ev.target.value } }))}
                          >
                            {Object.entries(ROLE_LABEL).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                        ) : (
                          ROLE_LABEL[m.role]
                        )}
                      </td>
                      <td>
                        {manager && open && m.id !== me.id && (
                          <button className="link destructive small" disabled={busy} onClick={() => act(() => api(`api/engagements/${id}/members/${m.id}/remove`, { method: "POST" }))}>
                            นำออก
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {manager && open && (
                <div className="row add-member">
                  <select value={add.user} onChange={(ev) => setAdd({ ...add, user: ev.target.value })} aria-label="ผู้ใช้">
                    <option value="">เพิ่มคนในทีม…</option>
                    {users
                      .filter((u) => !memberIds.has(u.id))
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.initials} · {u.name}
                        </option>
                      ))}
                  </select>
                  <select value={add.role} onChange={(ev) => setAdd({ ...add, role: ev.target.value as Role })} aria-label="บทบาท">
                    {Object.entries(ROLE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn"
                    disabled={!add.user || busy}
                    onClick={() => act(async () => {
                      await api(`api/engagements/${id}/members`, { body: { user_id: add.user, role: add.role } });
                      setAdd({ ...add, user: "" });
                    })}
                  >
                    เพิ่ม
                  </button>
                </div>
              )}
              <p className="muted small">ผู้จัดทำ: อัปโหลด ประมวลผล ลงนามผู้จัดทำ · ผู้สอบทาน: ลงนามสอบทาน (ต้องไม่ใช่คนที่จัดทำรายการนั้น) · Manager: ทุกอย่าง รวมถึงทีมและปิดงาน</p>
            </div>
          </section>

          {manager && open && (
            <section className="group">
              <h3 className="group-title">ตั้งค่าและปิดงาน (Manager)</h3>
              <div className="group-body stack">
                <div className="row">
                  <label className="form-field">
                    <span>Tolerance (%)</span>
                    <input type="number" step="0.1" min="0" max="20" value={settings?.t ?? e.tolerance_pct} onChange={(ev) => setSettings({ t: ev.target.value, m: settings?.m ?? String(e.materiality_thb) })} />
                  </label>
                  <label className="form-field">
                    <span>Materiality (฿)</span>
                    <input type="number" min="0" value={settings?.m ?? e.materiality_thb} onChange={(ev) => setSettings({ t: settings?.t ?? String(e.tolerance_pct), m: ev.target.value })} />
                  </label>
                  <button
                    className="btn"
                    disabled={!settings || busy}
                    onClick={() =>
                      act(async () => {
                        await api(`api/engagements/${id}/settings`, { body: { tolerance_pct: Number(settings!.t), materiality_thb: Number(settings!.m) } });
                        setSettings(null);
                      }, "บันทึกแล้ว มีผลกับการประมวลผลรอบถัดไป")
                    }
                  >
                    บันทึก
                  </button>
                </div>
                <div className="row">
                  <button
                    className="btn destructive"
                    disabled={busy}
                    onClick={() =>
                      confirm(`ปิดงาน ${e.client}? หลังปิดจะแก้ไขไม่ได้ และไฟล์ดิบจะถูกลบอัตโนมัติหลัง ${d.retention_days} วัน`) &&
                      act(() => api(`api/engagements/${id}/close`, { method: "POST" }))
                    }
                  >
                    ปิดงาน
                  </button>
                  <span className="muted small">ไฟล์ดิบจะถูกลบ {d.retention_days} วันหลังปิดงาน กระดาษทำการและ Audit Trail เก็บไว้</span>
                </div>
              </div>
            </section>
          )}

          <section className="group">
            <h3 className="group-title">บันทึกการใช้งาน</h3>
            <div className="group-body">
              <ol className="activity">
                {d.activity.map((a) => (
                  <li key={a.seq}>
                    <span className="muted small">
                      {when(a.at)} · {a.actor === "SYSTEM" ? "ระบบ" : a.actor}
                    </span>{" "}
                    {ACTIVITY_LABEL[a.action] ?? a.action}
                    <span className="muted small"> {detailText(a.detail)}</span>
                  </li>
                ))}
              </ol>
              <p className="muted small">บันทึกนี้เพิ่มได้อย่างเดียว แก้หรือลบไม่ได้</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
