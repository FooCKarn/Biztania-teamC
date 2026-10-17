// Engagements: one audit job for one client, with its own team, files, pipeline runs and Audit Trail.
//
// Isolation: every route checks that the signed-in user is a member of that engagement (a firm admin
// is not automatically one). Files are encrypted with a key derived for that engagement only
// (store.js), stored under eng/<id>/, and the pipeline can fetch a file only while a run of the same
// engagement that lists it is in progress.
//
// Roles per engagement:
//   preparer  upload/delete files, run the pipeline, sign as preparer, confirm pairs
//   reviewer  everything a preparer can, plus sign as reviewer (never on an item they prepared)
//   manager   everything, plus team, settings and closing the engagement
// A closed engagement is read-only. RETENTION_DAYS (default 90) after closing, the raw files and the
// page images rendered from them are deleted (purgeExpired, run daily by the cron trigger); the
// working paper (conflict_map.json with its quotes) and the Audit Trail stay.

import { HttpError, json, readJson, nowIso, randomId, sha256Hex, verifySigned, signRequest } from "./http.js";
import { ensureAppSchema } from "./schema.js";
import { requireUser, isDemoEmail } from "./auth.js";
import { putBlob, getBlob, deleteBlob, deleteWhere, isConfigured as storeConfigured } from "./store.js";
import { readTrail, appendEvent, parseAction } from "./trail.js";

const ROLES = ["preparer", "reviewer", "manager"];
const CAN = {
  work: new Set(["preparer", "reviewer", "manager"]), // upload, run, prepare, pair, reopen
  review: new Set(["reviewer", "manager"]),
  manage: new Set(["manager"]),
};
const ACTION_NEEDS = { prepare: "work", pair: "work", reopen: "work", review: "review", unreview: "review" };

const MAX_FILE = 10 * 1024 * 1024;
const MAX_FILES = 200;
const DEMO_MAX_FILE = 3 * 1024 * 1024; // shared demo accounts: smaller limits, the storage is shared by every visitor
const DEMO_MAX_FILES = 30;
const MAX_ASSET = 5 * 1024 * 1024;
const MAX_MAP = 20 * 1024 * 1024;
const STALE_RUN_MIN = 30;
const NAME_RE = /^[A-Za-z0-9฀-๿][A-Za-z0-9฀-๿ _.()-]{0,118}\.(pdf|png|jpe?g|tiff?|csv|xlsx|json)$/i;
const ASSET_RE = /^(pages|crops)\/[A-Za-z0-9฀-๿ _.()-]{1,160}\.png$/;
const ID_RE = /^[a-f0-9]{12}$/;

const CONTENT_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tif: "image/tiff",
  tiff: "image/tiff",
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json",
};

// The bytes must look like the extension says (a renamed executable is refused).
export function looksLike(ext, b) {
  const starts = (...sig) => sig.every((x, i) => b[i] === x);
  switch (ext) {
    case "pdf":
      return starts(0x25, 0x50, 0x44, 0x46); // %PDF
    case "png":
      return starts(0x89, 0x50, 0x4e, 0x47);
    case "jpg":
    case "jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "tif":
    case "tiff":
      return starts(0x49, 0x49, 0x2a, 0x00) || starts(0x4d, 0x4d, 0x00, 0x2a);
    case "xlsx":
      return starts(0x50, 0x4b, 0x03, 0x04); // zip
    case "csv":
    case "json": {
      // Text: valid UTF-8 and no NUL bytes.
      if (b.includes(0)) return false;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(b);
        return true;
      } catch {
        return false;
      }
    }
  }
  return false;
}

const wsOf = (id) => `eng-${id}`;
const outKey = (id, runId, path) => `eng/${id}/out/${runId}/${path}`;
const rawKey = (id, fileId) => `eng/${id}/raw/${fileId}`;

async function log(env, engagementId, actor, action, detail = null) {
  const db = env.AUDIT_DB;
  for (let i = 0; i < 3; i++) {
    const last = await db.prepare("SELECT MAX(seq) AS s FROM activity WHERE engagement_id = ?1").bind(engagementId).first();
    try {
      await db
        .prepare("INSERT INTO activity (engagement_id, seq, at, actor, action, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
        .bind(engagementId, (last?.s ?? 0) + 1, nowIso(), actor, action, detail == null ? null : JSON.stringify(detail))
        .run();
      return;
    } catch (e) {
      if (!/UNIQUE|constraint/i.test(String(e?.message))) throw e;
    }
  }
}

async function loadEngagement(env, id) {
  if (!ID_RE.test(id)) throw new HttpError(404, "ไม่พบ Engagement");
  const e = await env.AUDIT_DB.prepare("SELECT * FROM engagements WHERE id = ?1").bind(id).first();
  if (!e) throw new HttpError(404, "ไม่พบ Engagement");
  return e;
}

// The user's role in this engagement, or 403. Not being a member looks the same as not existing
// to the caller only in the message; the list endpoint never shows other engagements' details.
async function access(env, user, id, need = null) {
  const e = await loadEngagement(env, id);
  const m = await env.AUDIT_DB.prepare("SELECT role FROM members WHERE engagement_id = ?1 AND user_id = ?2").bind(id, user.id).first();
  if (!m) throw new HttpError(403, "คุณไม่ได้อยู่ในทีมของ Engagement นี้");
  if (need && !CAN[need].has(m.role)) throw new HttpError(403, "บทบาทของคุณใน Engagement นี้ทำรายการนี้ไม่ได้");
  return { e, role: m.role };
}
const mustBeOpen = (e) => {
  if (e.status !== "open") throw new HttpError(409, "Engagement ปิดแล้ว แก้ไขไม่ได้");
};

const num = (v, lo, hi, label) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new HttpError(400, `${label} ต้องอยู่ระหว่าง ${lo}–${hi}`);
  return n;
};

const realDataAllowed = (env) => String(env.ALLOW_REAL_DATA || "false") === "true";

function engagementJson(e, role) {
  return {
    id: e.id,
    client: e.client,
    period: e.period,
    tolerance_pct: e.tolerance_pct,
    materiality_thb: e.materiality_thb,
    synthetic: !!e.synthetic,
    status: e.status,
    created_at: e.created_at,
    closed_at: e.closed_at,
    purged_at: e.purged_at,
    my_role: role,
  };
}

// The newest finished run is the one the workspace shows.
async function latestDone(env, id) {
  return env.AUDIT_DB.prepare("SELECT * FROM runs WHERE engagement_id = ?1 AND status = 'done' ORDER BY finished_at DESC LIMIT 1")
    .bind(id)
    .first();
}

export async function loadEngagementMap(env, id, resultRunId) {
  const b = await getBlob(env, id, outKey(id, resultRunId, "conflict_map.json"));
  return b ? JSON.parse(new TextDecoder().decode(b.bytes)) : null;
}

const STAGES = new Set(["waking", "download", "ocr", "read", "pages", "check", "upload"]);

const runJson = (r, progress) => ({
  id: r.id,
  status: r.status,
  started_at: r.started_at,
  finished_at: r.finished_at,
  result_run_id: r.result_run_id,
  summary: r.summary ? JSON.parse(r.summary) : null,
  error: r.error,
  files: JSON.parse(r.file_ids).length,
  progress: r.status === "running" && progress ? { stage: progress.stage, done: progress.done, total: progress.total, file: progress.file, at: progress.updated_at } : null,
});

async function dispatch(env, run, files, e) {
  const body = JSON.stringify({
    run: run.id,
    files: files.map((f) => ({ id: f.id, name: f.name, sha256: f.sha256 })),
    settings: { client: e.client, tolerance_pct: e.tolerance_pct, materiality_thb: e.materiality_thb, synthetic: !!e.synthetic },
  });
  const url = new URL("/jobs", env.PIPELINE_URL);
  const headers = { "content-type": "application/json", ...(await signRequest(env.PIPELINE_SECRET, "POST", url.pathname, body)) };
  // The free pipeline host sleeps when idle; waking it can take about a minute, so wait for it here
  // (the browser shows "starting") rather than in waitUntil, which is cut off after 30 s.
  const r = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(Number(env.PIPELINE_TIMEOUT_MS || 120000)) });
  if (r.status !== 202 && !r.ok) throw new Error(`pipeline HTTP ${r.status}`);
}

// A new open engagement with its creator as manager. Synthetic unless ALLOW_REAL_DATA allows otherwise.
export async function createEngagement(env, user, body) {
  const db = env.AUDIT_DB;
  const client = String(body.client || "").trim();
  if (client.length < 2 || client.length > 120) throw new HttpError(400, "ชื่อลูกค้าต้องยาว 2–120 ตัวอักษร");
  const synthetic = body.synthetic === false && realDataAllowed(env) ? 0 : 1;
  const e = {
    id: randomId(6),
    client,
    period: String(body.period || "").trim().slice(0, 40) || null,
    tolerance_pct: num(body.tolerance_pct ?? 1, 0, 20, "tolerance (%)"),
    materiality_thb: num(body.materiality_thb ?? 10000, 0, 1e12, "materiality"),
    synthetic,
  };
  const at = nowIso();
  await db.batch([
    db
      .prepare(
        "INSERT INTO engagements (id, client, period, tolerance_pct, materiality_thb, synthetic, status, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'open', ?7, ?8)",
      )
      .bind(e.id, e.client, e.period, e.tolerance_pct, e.materiality_thb, e.synthetic, user.id, at),
    db.prepare("INSERT INTO members (engagement_id, user_id, role, added_by, added_at) VALUES (?1, ?2, 'manager', ?2, ?3)").bind(e.id, user.id, at),
  ]);
  await log(env, e.id, user.initials, "create", { client, synthetic: !!synthetic });
  return { ...e, status: "open", created_at: at };
}

// Adds a user to the team, or changes their role.
export async function setMember(env, id, by, u, role) {
  await env.AUDIT_DB
    .prepare(
      "INSERT INTO members (engagement_id, user_id, role, added_by, added_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (engagement_id, user_id) DO UPDATE SET role = excluded.role",
    )
    .bind(id, u.id, role, by.id, nowIso())
    .run();
  await log(env, id, by.initials, "member", { user: u.initials, role });
}

export async function handleEngagements(request, env, path) {
  await ensureAppSchema(env);
  const user = await requireUser(request, env);
  const db = env.AUDIT_DB;
  const method = request.method;

  if (path === "/api/engagements") {
    if (method === "GET") {
      const { results } = await db
        .prepare("SELECT e.*, m.role FROM engagements e JOIN members m ON m.engagement_id = e.id AND m.user_id = ?1 ORDER BY e.created_at DESC")
        .bind(user.id)
        .all();
      return json({ engagements: results.map((e) => engagementJson(e, e.role)), can_create: user.firm_role === "admin", real_data_allowed: realDataAllowed(env) });
    }
    if (method !== "POST") throw new HttpError(405, "ใช้ GET หรือ POST");
    if (user.firm_role !== "admin") throw new HttpError(403, "เฉพาะผู้ดูแลระบบของสำนักงานสร้าง Engagement ได้");
    const e = await createEngagement(env, user, await readJson(request));
    return json({ engagement: engagementJson(e, "manager") }, 201);
  }

  const m = path.match(/^\/api\/engagements\/([^/]+)(?:\/(.*))?$/);
  if (!m) throw new HttpError(404, "ไม่มีบริการนี้");
  const [, id, rest = ""] = m;

  // ---------- read ----------
  if (rest === "" && method === "GET") {
    const { e, role } = await access(env, user, id);
    await expireStaleRuns(env, Date.now(), id);
    const [members, files, runs, activity] = await Promise.all([
      db
        .prepare("SELECT u.id, u.name, u.initials, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.engagement_id = ?1 ORDER BY u.name")
        .bind(id)
        .all(),
      db.prepare("SELECT * FROM files WHERE engagement_id = ?1 AND deleted_at IS NULL ORDER BY name").bind(id).all(),
      db.prepare("SELECT * FROM runs WHERE engagement_id = ?1 ORDER BY started_at DESC LIMIT 10").bind(id).all(),
      db.prepare("SELECT * FROM activity WHERE engagement_id = ?1 ORDER BY seq DESC LIMIT 50").bind(id).all(),
    ]);
    const done = runs.results.find((r) => r.status === "done") ?? (await latestDone(env, id));
    const running = runs.results.filter((r) => r.status === "running");
    const progressOf = new Map();
    if (running.length) {
      const q = await db.prepare(`SELECT * FROM run_progress WHERE run_id IN (${running.map((_, i) => `?${i + 1}`).join(",")})`).bind(...running.map((r) => r.id)).all();
      for (const p of q.results) progressOf.set(p.run_id, p);
    }
    return json({
      engagement: engagementJson(e, role),
      members: members.results.filter((m) => !isDemoEmail(user.email) || isDemoEmail(m.email)), // a demo account never sees real users
      files: files.results.map((f) => ({ id: f.id, name: f.name, size: f.size, sha256: f.sha256, uploaded_at: f.uploaded_at, uploaded_by: f.uploaded_by })),
      runs: runs.results.map((r) => runJson(r, progressOf.get(r.id))),
      current_run: done?.result_run_id ?? null,
      activity: activity.results.map((a) => ({ ...a, detail: a.detail ? JSON.parse(a.detail) : null })),
      pipeline_configured: !!(env.PIPELINE_URL && env.PIPELINE_SECRET),
      retention_days: retentionDays(env),
      store_configured: storeConfigured(env),
    });
  }

  // ---------- results (conflict_map.json, page images) ----------
  const data = rest.match(/^data\/([a-f0-9]{12})\/(.+)$/);
  if (data && method === "GET") {
    await access(env, user, id);
    const [, runId, p] = data;
    if (p !== "conflict_map.json" && !ASSET_RE.test(p)) throw new HttpError(404, "ไม่พบไฟล์");
    const b = await getBlob(env, id, outKey(id, runId, p));
    if (!b) throw new HttpError(404, p === "conflict_map.json" ? "ไม่พบผลการตรวจ" : "ไม่พบภาพ (อาจถูกลบตามนโยบายหลังปิดงาน)");
    return new Response(b.bytes, { headers: { "content-type": b.contentType, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  }

  // ---------- Audit Trail (signer = signed-in user) ----------
  if (rest === "trail") {
    const { e, role } = await access(env, user, id);
    const run = new URL(request.url).searchParams.get("run") || "";
    if (method === "GET") {
      if (!/^[a-f0-9]{12}$/.test(run)) throw new HttpError(400, "ต้องระบุ run");
      return json({ ...(await readTrail(db, wsOf(id), run)), actor: user.initials, role });
    }
    if (method !== "POST") throw new HttpError(405, "ใช้ GET หรือ POST");
    mustBeOpen(e);
    const body = await readJson(request);
    const a = parseAction(body, user.initials); // the account signs, whatever the body says
    const need = ACTION_NEEDS[a.action];
    if (need && !CAN[need].has(role))
      throw new HttpError(403, need === "review" ? "ต้องมีบทบาทผู้สอบทานหรือ Manager จึงลงนามสอบทานได้" : "บทบาทของคุณทำรายการนี้ไม่ได้");
    const current = await latestDone(env, id);
    if (!current || String(body.run || "") !== current.result_run_id) throw new HttpError(409, "ผลการตรวจถูกรันใหม่แล้ว กรุณาโหลดหน้าใหม่");
    const map = await loadEngagementMap(env, id, current.result_run_id);
    if (!map) throw new HttpError(500, "ไม่พบผลการตรวจ");
    return appendEvent(db, wsOf(id), current.result_run_id, map, a);
  }

  if (method !== "POST" && !(method === "GET" && /^files\/[a-f0-9]{16}$/.test(rest))) throw new HttpError(405, "ใช้ POST");

  // ---------- files ----------
  if (rest === "files") {
    const { e } = await access(env, user, id, "work");
    mustBeOpen(e);
    const url = new URL(request.url);
    const name = (url.searchParams.get("name") || "").normalize("NFC").trim();
    if (!NAME_RE.test(name) || name.includes(".."))
      throw new HttpError(400, "ชื่อไฟล์หรือนามสกุลไม่รองรับ (PDF, PNG, JPG, TIFF, CSV, XLSX, remember.json)");
    if (name.toLowerCase().endsWith(".json") && name !== "remember.json") throw new HttpError(400, "ไฟล์ JSON รับเฉพาะ remember.json (กฎของบริษัท)");
    const len = Number(request.headers.get("content-length") || 0);
    if (len > MAX_FILE) throw new HttpError(413, "ไฟล์ใหญ่เกิน 10 MB");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) throw new HttpError(400, "ไฟล์ว่าง");
    if (bytes.length > MAX_FILE) throw new HttpError(413, "ไฟล์ใหญ่เกิน 10 MB");
    const ext = name.split(".").pop().toLowerCase();
    if (!looksLike(ext, bytes)) throw new HttpError(415, "เนื้อไฟล์ไม่ตรงกับนามสกุล");
    const count = await db.prepare("SELECT COUNT(*) AS n FROM files WHERE engagement_id = ?1 AND deleted_at IS NULL").bind(id).first();
    const same = await db.prepare("SELECT * FROM files WHERE engagement_id = ?1 AND name = ?2 AND deleted_at IS NULL").bind(id, name).first();
    if (isDemoEmail(user.email) && (bytes.length > DEMO_MAX_FILE || (!same && count.n >= DEMO_MAX_FILES)))
      throw new HttpError(413, `เดโมรับไฟล์ไม่เกิน ${DEMO_MAX_FILE / 1e6} MB และไม่เกิน ${DEMO_MAX_FILES} ไฟล์`);
    if (!same && count.n >= MAX_FILES) throw new HttpError(413, `ไฟล์ครบ ${MAX_FILES} ไฟล์แล้ว`);

    const f = { id: randomId(8), name, size: bytes.length, sha256: await sha256Hex(bytes) };
    await putBlob(env, id, rawKey(id, f.id), bytes, CONTENT_TYPES[ext]);
    const at = nowIso();
    await db
      .prepare("INSERT INTO files (id, engagement_id, name, size, sha256, uploaded_by, uploaded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(f.id, id, f.name, f.size, f.sha256, user.initials, at)
      .run();
    if (same) {
      // Same name again = a new version; the old one stops being used and its bytes are removed.
      await db.prepare("UPDATE files SET deleted_at = ?1 WHERE id = ?2").bind(at, same.id).run();
      await deleteBlob(env, rawKey(id, same.id));
    }
    await log(env, id, user.initials, same ? "replace_file" : "upload", { file: name, sha256: f.sha256, size: f.size });
    return json({ file: { ...f, uploaded_at: at, uploaded_by: user.initials } }, 201);
  }

  const fileOp = rest.match(/^files\/([a-f0-9]{16})(?:\/(delete))?$/);
  if (fileOp) {
    const [, fid, op] = fileOp;
    const { e } = await access(env, user, id, op ? "work" : null);
    const f = await db.prepare("SELECT * FROM files WHERE id = ?1 AND engagement_id = ?2 AND deleted_at IS NULL").bind(fid, id).first();
    if (!f) throw new HttpError(404, "ไม่พบไฟล์");
    if (!op) {
      const b = await getBlob(env, id, rawKey(id, fid));
      if (!b) throw new HttpError(404, "ไม่พบไฟล์");
      await log(env, id, user.initials, "download", { file: f.name });
      return new Response(b.bytes, {
        headers: {
          "content-type": b.contentType,
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    mustBeOpen(e);
    await db.prepare("UPDATE files SET deleted_at = ?1 WHERE id = ?2").bind(nowIso(), fid).run();
    await deleteBlob(env, rawKey(id, fid));
    await log(env, id, user.initials, "delete_file", { file: f.name });
    return json({ ok: true });
  }

  // ---------- pipeline runs ----------
  if (rest === "runs") {
    const { e } = await access(env, user, id, "work");
    mustBeOpen(e);
    if (!env.PIPELINE_URL || !env.PIPELINE_SECRET) throw new HttpError(503, "ยังไม่ได้ตั้งค่าเครื่องประมวลผล (PIPELINE_URL, PIPELINE_SECRET)");
    await expireStaleRuns(env, Date.now(), id);
    const busy = await db.prepare("SELECT id FROM runs WHERE engagement_id = ?1 AND status IN ('queued', 'running')").bind(id).first();
    if (busy) throw new HttpError(409, "กำลังประมวลผลรอบก่อนหน้าอยู่");
    const { results: files } = await db.prepare("SELECT * FROM files WHERE engagement_id = ?1 AND deleted_at IS NULL ORDER BY name").bind(id).all();
    if (!files.some((f) => f.name !== "remember.json")) throw new HttpError(400, "ยังไม่มีเอกสารให้ประมวลผล");
    const run = { id: randomId(8), file_ids: JSON.stringify(files.map((f) => f.id)) };
    await db
      .prepare("INSERT INTO runs (id, engagement_id, status, file_ids, started_by, started_at) VALUES (?1, ?2, 'running', ?3, ?4, ?5)")
      .bind(run.id, id, run.file_ids, user.initials, nowIso())
      .run();
    await log(env, id, user.initials, "run", { run: run.id, files: files.length });
    await setProgress(env, run.id, { stage: "waking", done: 0, total: files.length }); // the page polls while the free host wakes up
    try {
      await dispatch(env, run, files, e);
    } catch (x) {
      await db.prepare("UPDATE runs SET status = 'failed', finished_at = ?1, error = ?2 WHERE id = ?3").bind(nowIso(), "ติดต่อเครื่องประมวลผลไม่ได้", run.id).run();
      console.error("pipeline dispatch failed", String(x));
      throw new HttpError(502, "ติดต่อเครื่องประมวลผลไม่ได้ ลองใหม่อีกครั้ง");
    }
    return json({ run: { id: run.id, status: "running" } }, 202);
  }

  // ---------- team and settings (manager) ----------
  // Shared demo accounts cannot change the team or close the engagement (the demo reset does that).
  if (isDemoEmail(user.email) && (rest === "members" || rest === "close" || /^members\//.test(rest)))
    throw new HttpError(403, "บัญชีทดลองเปลี่ยนทีมหรือปิดงานไม่ได้ (ใช้ปุ่มรีเซ็ตเดโมแทน)");
  if (rest === "members") {
    const { e } = await access(env, user, id, "manage");
    mustBeOpen(e);
    const body = await readJson(request);
    const role = String(body.role || "");
    if (!ROLES.includes(role)) throw new HttpError(400, "บทบาทไม่ถูกต้อง");
    const u = await db.prepare("SELECT * FROM users WHERE id = ?1 AND disabled = 0").bind(String(body.user_id || "")).first();
    if (!u) throw new HttpError(404, "ไม่พบผู้ใช้");
    if (u.id === user.id && role !== "manager") await keepAManager(db, id, u.id);
    await setMember(env, id, user, u, role);
    return json({ ok: true });
  }
  const rm = rest.match(/^members\/([a-f0-9]{16})\/remove$/);
  if (rm) {
    const { e } = await access(env, user, id, "manage");
    mustBeOpen(e);
    await keepAManager(db, id, rm[1]);
    const u = await db.prepare("SELECT initials FROM users WHERE id = ?1").bind(rm[1]).first();
    await db.prepare("DELETE FROM members WHERE engagement_id = ?1 AND user_id = ?2").bind(id, rm[1]).run();
    await log(env, id, user.initials, "remove_member", { user: u?.initials ?? rm[1] });
    return json({ ok: true });
  }
  if (rest === "settings") {
    const { e } = await access(env, user, id, "manage");
    mustBeOpen(e);
    const body = await readJson(request);
    const t = num(body.tolerance_pct, 0, 20, "tolerance (%)");
    const mat = num(body.materiality_thb, 0, 1e12, "materiality");
    await db.prepare("UPDATE engagements SET tolerance_pct = ?1, materiality_thb = ?2 WHERE id = ?3").bind(t, mat, id).run();
    await log(env, id, user.initials, "settings", { tolerance_pct: t, materiality_thb: mat });
    return json({ ok: true });
  }
  if (rest === "close") {
    const { e } = await access(env, user, id, "manage");
    mustBeOpen(e);
    const at = nowIso();
    await db.prepare("UPDATE engagements SET status = 'closed', closed_at = ?1, closed_by = ?2 WHERE id = ?3").bind(at, user.id, id).run();
    await log(env, id, user.initials, "close", { purge_after_days: retentionDays(env) });
    return json({ ok: true, closed_at: at });
  }

  throw new HttpError(404, "ไม่มีบริการนี้");
}

async function keepAManager(db, id, leavingUserId) {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM members WHERE engagement_id = ?1 AND role = 'manager' AND user_id != ?2")
    .bind(id, leavingUserId)
    .first();
  if (r.n === 0) throw new HttpError(409, "ต้องมี Manager อย่างน้อย 1 คน");
}

// ---------- pipeline callbacks (signed with PIPELINE_SECRET, no cookie) ----------

async function setProgress(env, runId, p) {
  await env.AUDIT_DB
    .prepare("INSERT INTO run_progress (run_id, stage, done, total, file, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(run_id) DO UPDATE SET stage = ?2, done = ?3, total = ?4, file = ?5, updated_at = ?6")
    .bind(runId, p.stage, p.done ?? null, p.total ?? null, p.file ?? null, nowIso())
    .run();
}

async function activeRun(env, runId) {
  const r = await env.AUDIT_DB.prepare("SELECT * FROM runs WHERE id = ?1").bind(runId).first();
  if (!r || r.status !== "running") throw new HttpError(409, "run ไม่ได้อยู่ระหว่างประมวลผล");
  return r;
}

export async function handleInternal(request, env, path) {
  await ensureAppSchema(env);
  const m = path.match(/^\/api\/internal\/runs\/([a-f0-9]{16})\/(files\/([a-f0-9]{16})|asset|progress|done|fail)$/);
  if (!m) throw new HttpError(404, "ไม่มีบริการนี้");
  const body = request.method === "GET" ? new Uint8Array() : new Uint8Array(await request.arrayBuffer());
  if (!(await verifySigned(request, env.PIPELINE_SECRET, body))) throw new HttpError(401, "ลายเซ็นไม่ถูกต้อง");
  const [, runId, op, fid] = m;
  const run = await activeRun(env, runId);
  const eid = run.engagement_id;
  const db = env.AUDIT_DB;

  if (fid && request.method === "GET") {
    if (!JSON.parse(run.file_ids).includes(fid)) throw new HttpError(403, "ไฟล์นี้ไม่อยู่ในรอบประมวลผลนี้");
    const b = await getBlob(env, eid, rawKey(eid, fid));
    if (!b) throw new HttpError(404, "ไม่พบไฟล์");
    return new Response(b.bytes, { headers: { "content-type": "application/octet-stream" } });
  }
  if (request.method !== "POST") throw new HttpError(405, "ใช้ POST");

  if (op === "progress") {
    let p;
    try {
      p = JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw new HttpError(400, "progress ไม่ใช่ JSON");
    }
    if (!STAGES.has(p.stage)) throw new HttpError(400, "stage ไม่รู้จัก");
    const n = (v) => (Number.isInteger(v) && v >= 0 && v < 100000 ? v : null);
    await setProgress(env, runId, { stage: p.stage, done: n(p.done), total: n(p.total), file: typeof p.file === "string" ? p.file.slice(0, 120) : null });
    return json({ ok: true });
  }
  if (op === "asset") {
    const url = new URL(request.url);
    const p = url.searchParams.get("path") || "";
    const resultRun = url.searchParams.get("result") || "";
    if (!ASSET_RE.test(p) || !/^[a-f0-9]{12}$/.test(resultRun)) throw new HttpError(400, "path ไม่ถูกต้อง");
    if (body.length > MAX_ASSET || !looksLike("png", body)) throw new HttpError(415, "รับเฉพาะ PNG");
    await putBlob(env, eid, outKey(eid, resultRun, p), body, "image/png");
    return json({ ok: true });
  }
  if (op === "done") {
    if (body.length > MAX_MAP) throw new HttpError(413, "ผลการตรวจใหญ่เกินไป");
    let map;
    try {
      map = JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw new HttpError(400, "ผลการตรวจไม่ใช่ JSON");
    }
    if (!/^[a-f0-9]{12}$/.test(map.run_id || "") || !Array.isArray(map.flags)) throw new HttpError(400, "ผลการตรวจไม่ครบ");
    await putBlob(env, eid, outKey(eid, map.run_id, "conflict_map.json"), body, "application/json; charset=utf-8");
    const summary = { flags: map.flags.length, pending: (map.pending || []).length, documents: (map.documents || []).length, unreadable: (map.coverage?.unreadable_files || []).length };
    await db
      .prepare("UPDATE runs SET status = 'done', finished_at = ?1, result_run_id = ?2, summary = ?3 WHERE id = ?4")
      .bind(nowIso(), map.run_id, JSON.stringify(summary), runId)
      .run();
    await log(env, eid, "SYSTEM", "run_done", { run: runId, result: map.run_id, ...summary });
    return json({ ok: true });
  }
  // fail
  let msg = "ประมวลผลไม่สำเร็จ";
  try {
    msg = String(JSON.parse(new TextDecoder().decode(body)).error || msg).slice(0, 300);
  } catch {
    /* keep the generic message */
  }
  await db.prepare("UPDATE runs SET status = 'failed', finished_at = ?1, error = ?2 WHERE id = ?3").bind(nowIso(), msg, runId).run();
  await log(env, eid, "SYSTEM", "run_failed", { run: runId, error: msg });
  return json({ ok: true });
}

// A run whose callbacks never arrive (pipeline down, Worker unreachable) must not block the engagement for
// good, so runs older than STALE_RUN_MIN are failed whenever the engagement is read or a run is started,
// not only by the daily cron.
export async function expireStaleRuns(env, now = Date.now(), engagementId = null) {
  const stale = new Date(now - STALE_RUN_MIN * 60_000).toISOString();
  const at = new Date(now).toISOString();
  const q = "UPDATE runs SET status = 'failed', finished_at = ?1, error = 'หมดเวลาประมวลผล' WHERE status IN ('queued', 'running') AND started_at < ?2";
  const r = engagementId
    ? await env.AUDIT_DB.prepare(q + " AND engagement_id = ?3").bind(at, stale, engagementId).run()
    : await env.AUDIT_DB.prepare(q).bind(at, stale).run();
  return r?.meta?.changes ?? 0;
}

// Demo reset: closes the engagement and deletes everything stored for it at once (raw files, page images,
// results). The activity log and the hash-chained trail rows stay, like after a normal purge.
export async function wipeEngagement(env, id, actor) {
  const db = env.AUDIT_DB;
  const n = await deleteWhere(env, id, () => false);
  const at = nowIso();
  await db.batch([
    db.prepare("UPDATE files SET deleted_at = ?1 WHERE engagement_id = ?2 AND deleted_at IS NULL").bind(at, id),
    db.prepare("UPDATE engagements SET status = 'closed', closed_at = COALESCE(closed_at, ?1), purged_at = ?1 WHERE id = ?2").bind(at, id),
  ]);
  await log(env, id, actor, "purge", { objects: n, reason: "demo reset" });
  return n;
}

// ---------- retention (cron) ----------

export const retentionDays = (env) => Number(env.RETENTION_DAYS || 90);

// Deletes raw files and rendered page images of engagements closed more than RETENTION_DAYS ago,
// and marks runs stuck for over 30 minutes as failed. Returns what it did, for the log and tests.
export async function purgeExpired(env, now = Date.now()) {
  await ensureAppSchema(env);
  const db = env.AUDIT_DB;
  const cutoff = new Date(now - retentionDays(env) * 86400_000).toISOString();
  const { results } = await db
    .prepare("SELECT id FROM engagements WHERE status = 'closed' AND purged_at IS NULL AND closed_at <= ?1")
    .bind(cutoff)
    .all();
  const purged = [];
  for (const { id } of results) {
    // Keep only the working paper itself (conflict_map.json: quotes, flags, matches).
    const n = await deleteWhere(env, id, (key) => key.endsWith("/conflict_map.json"));
    const at = new Date(now).toISOString();
    await db.batch([
      db.prepare("UPDATE files SET deleted_at = ?1 WHERE engagement_id = ?2 AND deleted_at IS NULL").bind(at, id),
      db.prepare("UPDATE engagements SET purged_at = ?1 WHERE id = ?2").bind(at, id),
    ]);
    await log(env, id, "SYSTEM", "purge", { objects: n, retention_days: retentionDays(env) });
    purged.push({ id, objects: n });
  }
  return { purged, stale_runs: await expireStaleRuns(env, now) };
}
