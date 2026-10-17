// Demo account and synthetic engagement. Admin-only, from the users page:
//   POST /api/users/demo/account     create or reset the shared account (password returned once)
//   POST /api/users/demo/engagement  create or reuse the open demo engagement
// The browser then uploads the sample set (without the answer key) and starts a run.

import { HttpError, json, nowIso, randomId, readJson, clientIp } from "./http.js";
import { ensureAppSchema } from "./schema.js";
import { requireUser, insertUser, hashPassword, tempPassword, publicUser, startSession, demoEnabled, isDemoEmail, DEMO_DOMAIN } from "./auth.js";
import { createEngagement, setMember, wipeEngagement } from "./engagements.js";

export const DEMO_ACCOUNT = { email: `auditor@${DEMO_DOMAIN}`, name: "ผู้สอบบัญชี (บัญชีทดลอง)", initials: "DA" };

// Matches pipeline/samples/tg_company/remember.json.
export const DEMO_ENGAGEMENT = { client: "บริษัท สยามออโต้พาร์ท จำกัด", period: "Q1 2026 (ข้อมูลสมมติ)", synthetic: true };

export async function handleDemo(request, env, path) {
  await ensureAppSchema(env);
  const me = await requireUser(request, env);
  if (me.firm_role !== "admin") throw new HttpError(403, "เฉพาะผู้ดูแลระบบของสำนักงาน");
  if (request.method !== "POST") throw new HttpError(405, "ใช้ POST");
  const db = env.AUDIT_DB;

  if (path === "/api/users/demo/account") {
    const a = DEMO_ACCOUNT;
    const pw = tempPassword();
    const existing = await db.prepare("SELECT * FROM users WHERE email = ?1").bind(a.email).first();
    if (!existing) {
      const u = await insertUser(env, { email: a.email, name: a.name, initials: a.initials }, "member", pw, false);
      return json({ user: publicUser(u), password: pw }, 201);
    }
    // Again = a new password (everyone signed in with the old one is signed out) and the account is re-enabled.
    const h = await hashPassword(pw, env);
    await db.batch([
      db
        .prepare("UPDATE users SET pw_salt = ?1, pw_hash = ?2, pw_iter = ?3, must_change = 0, disabled = 0, firm_role = 'member' WHERE id = ?4")
        .bind(h.pw_salt, h.pw_hash, h.pw_iter, existing.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(existing.id),
    ]);
    return json({ user: publicUser({ ...existing, must_change: 0, disabled: 0, firm_role: "member" }), password: pw });
  }

  if (path === "/api/users/demo/engagement") {
    const account = await db.prepare("SELECT * FROM users WHERE email = ?1 AND disabled = 0").bind(DEMO_ACCOUNT.email).first();
    if (!account) throw new HttpError(409, "ยังไม่มีบัญชีทดลอง กรุณาสร้างบัญชีก่อน");

    // Reuse the open demo engagement if there is one (a tester may have closed the last one).
    let e = await db
      .prepare(
        "SELECT e.* FROM engagements e JOIN members m ON m.engagement_id = e.id AND m.user_id = ?1 WHERE e.status = 'open' AND e.deleted_at IS NULL AND e.synthetic = 1 AND e.client = ?2 ORDER BY e.created_at DESC LIMIT 1",
      )
      .bind(account.id, DEMO_ENGAGEMENT.client)
      .first();
    const created = !e;
    if (created) e = await createEngagement(env, me, DEMO_ENGAGEMENT);
    const { results: team } = await db.prepare("SELECT user_id FROM members WHERE engagement_id = ?1").bind(e.id).all();
    // The admin stays on the team so this page can upload the sample set even if a tester left it.
    if (!team.some((t) => t.user_id === me.id)) await setMember(env, e.id, me, me);
    if (!team.some((t) => t.user_id === account.id)) await setMember(env, e.id, me, account);
    const { results: files } = await db.prepare("SELECT name FROM files WHERE engagement_id = ?1 AND deleted_at IS NULL").bind(e.id).all();
    const run = await db.prepare("SELECT status FROM runs WHERE engagement_id = ?1 AND status IN ('running', 'done') LIMIT 1").bind(e.id).first();
    return json({ engagement: { id: e.id, client: e.client, created }, files: files.map((f) => f.name), has_run: !!run, at: nowIso() }, created ? 201 : 200);
  }

  throw new HttpError(404, "ไม่มีบริการนี้");
}

// ---------- One-click demo entry (DEMO_MODE=true) ----------
//   POST /api/auth/demo-login  signs the visitor in as the shared demo account, no password, and
//                               makes sure the synthetic engagement exists with that account on its team
//   POST /api/auth/demo-reset  (signed in as the demo account) wipes the demo engagement and starts a new one
// The session is an ordinary one for the demo account; the user directory, team changes, closing, password
// change and account admin are closed to it (auth.js, engagements.js). Runs only when DEMO_MODE is "true"
// and ALLOW_REAL_DATA is not.

const memoryHits = new Map(); // fallback when no KV namespace is bound (per Worker instance only)
const ENTRY_LIMIT = 40; // demo entries/resets per IP per 15 minutes

async function takeEntry(env, ip) {
  const k = `demo:${ip}:${Math.floor(Date.now() / 900_000)}`;
  const n = Number(env.RATE ? (await env.RATE.get(k)) || 0 : memoryHits.get(k) || 0);
  if (n >= ENTRY_LIMIT) throw new HttpError(429, "ใช้เดโมถี่เกินไป กรุณารอสักครู่");
  if (env.RATE) await env.RATE.put(k, String(n + 1), { expirationTtl: 1800 });
  else memoryHits.set(k, n + 1);
}

// The shared demo account. Created without any usable password (a random hash nobody can match),
// so it is reachable only through the demo entry, never by typing a password.
async function demoUser(env) {
  const a = DEMO_ACCOUNT;
  const db = env.AUDIT_DB;
  const found = await db.prepare("SELECT * FROM users WHERE email = ?1").bind(a.email).first();
  if (found) {
    if (found.disabled) throw new HttpError(403, "บัญชีเดโมถูกปิดโดยผู้ดูแลระบบ");
    return found;
  }
  const row = { id: randomId(8), email: a.email, name: a.name, initials: a.initials, firm_role: "member", pw_salt: randomId(16), pw_hash: randomId(32), pw_iter: 100_000, must_change: 0, disabled: 0, created_at: nowIso() };
  await db
    .prepare("INSERT INTO users (id, email, name, initials, firm_role, pw_salt, pw_hash, pw_iter, must_change, disabled, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
    .bind(row.id, row.email, row.name, row.initials, row.firm_role, row.pw_salt, row.pw_hash, row.pw_iter, row.must_change, row.disabled, row.created_at)
    .run();
  return row;
}

const openDemoEngagement = (db, userId) =>
  db
    .prepare(
      "SELECT e.* FROM engagements e JOIN members m ON m.engagement_id = e.id AND m.user_id = ?1 WHERE e.status = 'open' AND e.deleted_at IS NULL AND e.synthetic = 1 AND e.client = ?2 ORDER BY e.created_at DESC LIMIT 1",
    )
    .bind(userId, DEMO_ENGAGEMENT.client)
    .first();

// The open demo engagement (made if missing) with the demo account on its team.
async function ensureDemoEngagement(env, user) {
  const db = env.AUDIT_DB;
  let e = await openDemoEngagement(db, user.id);
  if (!e) e = await createEngagement(env, user, DEMO_ENGAGEMENT);
  const { results: team } = await db.prepare("SELECT user_id FROM members WHERE engagement_id = ?1").bind(e.id).all();
  if (!team.some((t) => t.user_id === user.id)) await setMember(env, e.id, user, user);
  return e;
}

export async function handleDemoEntry(request, env, path) {
  if (!demoEnabled(env)) throw new HttpError(404, "ไม่ได้เปิดโหมดเดโม");
  if (request.method !== "POST") throw new HttpError(405, "ใช้ POST");
  await ensureAppSchema(env);
  await takeEntry(env, clientIp(request));

  if (path === "/api/auth/demo-login") {
    const user = await demoUser(env);
    const e = await ensureDemoEngagement(env, user);
    const res = await startSession(env, user);
    const out = await res.json();
    return json({ ...out, engagement: { id: e.id } }, 200, { "set-cookie": res.headers.get("set-cookie") });
  }

  // demo-reset
  const me = await requireUser(request, env);
  if (!isDemoEmail(me.email)) throw new HttpError(403, "รีเซ็ตได้เฉพาะบัญชีเดโม");
  const user = await demoUser(env);
  const old = await openDemoEngagement(env.AUDIT_DB, user.id);
  if (old) await wipeEngagement(env, old.id, me.initials);
  const e = await ensureDemoEngagement(env, user);
  return json({ ok: true, engagement: { id: e.id } });
}
