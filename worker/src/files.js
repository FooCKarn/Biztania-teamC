// GET /api/files → { storage, engagements, files } for the user's own engagements.
// Other engagements' usage is a single number. Download/delete go through engagements.js.

import { HttpError, json } from "./http.js";
import { ensureAppSchema, filesDb } from "./schema.js";
import { requireUser } from "./auth.js";

const MB = 1024 * 1024;
// D1 free plan: 500 MB per database; paid: 10 GB. STORAGE_QUOTA_MB sets what the meter shows as full.
const quotaBytes = (env) => Math.max(1, Number(env.STORAGE_QUOTA_MB || 500)) * MB;

export const extOf = (name) => {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m ? m[1] : "";
};

export async function handleFiles(request, env, path) {
  if (path !== "/api/files") throw new HttpError(404, "ไม่มีบริการนี้");
  if (request.method !== "GET") throw new HttpError(405, "ใช้ GET");
  await ensureAppSchema(env);
  const user = await requireUser(request, env);
  const db = env.AUDIT_DB;

  const { results: engs } = await db
    .prepare(
      "SELECT e.id, e.client, e.period, e.status, e.purged_at, m.role FROM engagements e JOIN members m ON m.engagement_id = e.id AND m.user_id = ?1 ORDER BY e.created_at DESC",
    )
    .bind(user.id)
    .all();
  const mine = new Set(engs.map((e) => e.id));

  let files = [];
  const inLatest = new Map(); // engagement id → file ids used by its latest finished run
  if (engs.length) {
    const ids = engs.map((e) => e.id);
    const marks = ids.map((_, i) => `?${i + 1}`).join(",");
    const [f, runs] = await Promise.all([
      db.prepare(`SELECT * FROM files WHERE deleted_at IS NULL AND engagement_id IN (${marks}) ORDER BY uploaded_at DESC`).bind(...ids).all(),
      db
        .prepare(
          `SELECT engagement_id, file_ids FROM runs r WHERE status = 'done' AND engagement_id IN (${marks})
           AND started_at = (SELECT MAX(started_at) FROM runs WHERE engagement_id = r.engagement_id AND status = 'done')`,
        )
        .bind(...ids)
        .all(),
    ]);
    for (const r of runs.results) inLatest.set(r.engagement_id, new Set(JSON.parse(r.file_ids)));
    files = f.results;
  }

  // Bytes per engagement and kind, from the store itself (raw uploads vs. page images and results).
  const store = filesDb(env);
  const usage = await store
    .prepare(
      "SELECT engagement_id, CASE WHEN key LIKE 'eng/%/raw/%' THEN 'raw' ELSE 'out' END AS kind, SUM(size) AS bytes, COUNT(*) AS n FROM blobs GROUP BY engagement_id, kind",
    )
    .all();
  let raw = 0;
  let out = 0;
  let others = 0;
  for (const u of usage.results) {
    const b = Number(u.bytes) || 0;
    if (!mine.has(u.engagement_id)) others += b;
    else if (u.kind === "raw") raw += b;
    else out += b;
  }
  const byType = new Map();
  for (const f of files) {
    const t = byType.get(extOf(f.name)) ?? { ext: extOf(f.name), bytes: 0, count: 0 };
    t.bytes += f.size;
    t.count += 1;
    byType.set(t.ext, t);
  }
  const stored = raw + out + others;
  // D1 reports the database file size with each result; it includes indexes and free pages.
  const dbSize = Number(usage.meta?.size_after) || null;

  return json({
    storage: {
      quota: quotaBytes(env),
      used: Math.max(stored, dbSize ?? 0),
      files: raw,
      pages: out,
      others,
      overhead: dbSize && dbSize > stored ? dbSize - stored : 0,
      by_type: [...byType.values()].sort((a, b) => b.bytes - a.bytes),
    },
    engagements: engs.map((e) => ({
      id: e.id,
      client: e.client,
      period: e.period,
      status: e.status,
      purged: !!e.purged_at,
      my_role: e.role,
      can_delete: e.status === "open",
    })),
    files: files.map((f) => ({
      id: f.id,
      engagement_id: f.engagement_id,
      name: f.name,
      ext: extOf(f.name),
      size: f.size,
      sha256: f.sha256,
      uploaded_at: f.uploaded_at,
      uploaded_by: f.uploaded_by,
      in_latest_run: !!inLatest.get(f.engagement_id)?.has(f.id),
    })),
  });
}
