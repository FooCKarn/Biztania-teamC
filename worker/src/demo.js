// Demo accounts and a synthetic engagement, so people outside the firm can try the deployed app.
//
// Only a firm admin can call these, from the users page (web/src/pages/Users.tsx):
//   POST /api/users/demo/account/<role>  create or reset one shared account, returns its password once
//   POST /api/users/demo/engagement      create (or reuse) the open demo engagement and put the three
//                                        accounts on its team; returns the files it already has
// The browser then uploads the sample set (built into web/dist/demo/tg_company/ from
// pipeline/samples/tg_company, without the answer key) through the normal upload API and starts a run.
// One request per step keeps each one inside the Free plan's CPU and D1 query limits.
//
// Passwords are generated here and shown only to the admin; none is stored in the repo. Demo accounts
// are ordinary members (not admins), never need a first-login change and cannot change their password.

import { HttpError, json, nowIso } from "./http.js";
import { ensureAppSchema } from "./schema.js";
import { requireUser, insertUser, hashPassword, tempPassword, publicUser, DEMO_DOMAIN } from "./auth.js";
import { createEngagement, setMember } from "./engagements.js";

export const DEMO_ACCOUNTS = [
  { role: "preparer", email: `preparer@${DEMO_DOMAIN}`, name: "ผู้จัดทำ (บัญชีทดลอง)", initials: "DP" },
  { role: "reviewer", email: `reviewer@${DEMO_DOMAIN}`, name: "ผู้สอบทาน (บัญชีทดลอง)", initials: "DR" },
  { role: "manager", email: `manager@${DEMO_DOMAIN}`, name: "Manager (บัญชีทดลอง)", initials: "DM" },
];

// Matches pipeline/samples/tg_company/remember.json.
export const DEMO_ENGAGEMENT = { client: "บริษัท สยามออโต้พาร์ท จำกัด", period: "Q1 2026 (ข้อมูลสมมติ)", tolerance_pct: 1, materiality_thb: 10000, synthetic: true };

export async function handleDemo(request, env, path) {
  await ensureAppSchema(env);
  const me = await requireUser(request, env);
  if (me.firm_role !== "admin") throw new HttpError(403, "เฉพาะผู้ดูแลระบบของสำนักงาน");
  if (request.method !== "POST") throw new HttpError(405, "ใช้ POST");
  const db = env.AUDIT_DB;

  const acc = path.match(/^\/api\/users\/demo\/account\/(preparer|reviewer|manager)$/);
  if (acc) {
    const a = DEMO_ACCOUNTS.find((x) => x.role === acc[1]);
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
    const { results: users } = await db
      .prepare(`SELECT * FROM users WHERE email IN (${DEMO_ACCOUNTS.map((_, i) => `?${i + 1}`).join(", ")}) AND disabled = 0`)
      .bind(...DEMO_ACCOUNTS.map((a) => a.email))
      .all();
    const byEmail = new Map(users.map((u) => [u.email, u]));
    const manager = byEmail.get(DEMO_ACCOUNTS.find((a) => a.role === "manager").email);
    if (!manager) throw new HttpError(409, "ยังไม่มีบัญชีทดลอง กรุณาสร้างบัญชีก่อน");

    // Reuse the open demo engagement if there is one (a tester may have closed the last one).
    let e = await db
      .prepare(
        "SELECT e.* FROM engagements e JOIN members m ON m.engagement_id = e.id AND m.user_id = ?1 WHERE e.status = 'open' AND e.synthetic = 1 AND e.client = ?2 ORDER BY e.created_at DESC LIMIT 1",
      )
      .bind(manager.id, DEMO_ENGAGEMENT.client)
      .first();
    const created = !e;
    if (created) e = await createEngagement(env, me, DEMO_ENGAGEMENT);
    const { results: team } = await db.prepare("SELECT user_id, role FROM members WHERE engagement_id = ?1").bind(e.id).all();
    // The admin stays a manager so this page can upload the sample set even if a tester changed the team.
    if (!team.some((t) => t.user_id === me.id && t.role === "manager")) await setMember(env, e.id, me, me, "manager");
    for (const a of DEMO_ACCOUNTS) {
      const u = byEmail.get(a.email);
      if (u && !team.some((t) => t.user_id === u.id && t.role === a.role)) await setMember(env, e.id, me, u, a.role);
    }
    const { results: files } = await db.prepare("SELECT name FROM files WHERE engagement_id = ?1 AND deleted_at IS NULL").bind(e.id).all();
    const run = await db.prepare("SELECT status FROM runs WHERE engagement_id = ?1 AND status IN ('running', 'done') LIMIT 1").bind(e.id).first();
    return json({ engagement: { id: e.id, client: e.client, created }, files: files.map((f) => f.name), has_run: !!run, at: nowIso() }, created ? 201 : 200);
  }

  throw new HttpError(404, "ไม่มีบริการนี้");
}
