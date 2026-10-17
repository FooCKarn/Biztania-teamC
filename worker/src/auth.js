// Accounts and sessions.
//  - PBKDF2-SHA256, 100,000 rounds by default (PASSWORD_ITERATIONS can lower it); each hash keeps its own count.
//  - Session: random token in an HttpOnly, Secure, SameSite=Strict cookie; only its SHA-256 is stored.
//  - No self sign-up: the first admin uses SETUP_TOKEN, later accounts get a one-time password.
//  - Initials are unique and are the Audit Trail signer.

import { HttpError, json, readJson, nowIso, randomId, hex, sha256Hex, sameString, clientIp } from "./http.js";
import { ensureAppSchema } from "./schema.js";

const COOKIE = "ac_session";
const SESSION_HOURS = 12;
const PBKDF2_ITER = 100_000;
const MIN_PASSWORD = 10;
export const INITIALS_RE = /^[A-Z0-9ก-ฮ]{2,4}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
// Shared demo accounts (worker/src/demo.js). Many people log in with the same password, so nobody
// may change it; the firm admin resets them from the users page instead.
export const DEMO_DOMAIN = "demo.example.com";
export const isDemoEmail = (email) => String(email || "").endsWith(`@${DEMO_DOMAIN}`);
// The one-click demo entry (worker/src/demo.js) is on unless DEMO_MODE is "false", and never while real data is allowed.
export const demoEnabled = (env) => String(env.DEMO_MODE ?? "true") !== "false" && String(env.ALLOW_REAL_DATA || "false") !== "true";

async function pbkdf2(password, saltHex, iter = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g), (h) => parseInt(h, 16));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}

const iterations = (env) => Math.min(PBKDF2_ITER, Math.max(10_000, Number(env?.PASSWORD_ITERATIONS) || PBKDF2_ITER));

export async function hashPassword(password, env) {
  const salt = randomId(16);
  const iter = iterations(env);
  return { pw_salt: salt, pw_hash: await pbkdf2(password, salt, iter), pw_iter: iter };
}

function checkPassword(pw) {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) return `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัวอักษร`;
  if (pw.length > 200) return "รหัสผ่านยาวเกินไป";
  return null;
}

// Readable one-time password, e.g. "kq7m-2xpw-h9ra" (no 0/o/1/l).
export function tempPassword() {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(12));
  const s = [...b].map((x) => abc[x % abc.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  initials: u.initials,
  firm_role: u.firm_role,
  must_change: !!u.must_change,
  disabled: !!u.disabled,
  demo: isDemoEmail(u.email),
});

function cookieOf(request) {
  const raw = request.headers.get("cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}

const setCookie = (token, maxAge) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

// Returns the logged-in user (row) or null.
export async function currentUser(request, env) {
  const token = cookieOf(request);
  if (!token || !env.AUDIT_DB) return null;
  await ensureAppSchema(env);
  const row = await env.AUDIT_DB.prepare(
    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND u.disabled = 0",
  )
    .bind(await sha256Hex(token), nowIso())
    .first();
  return row ?? null;
}

export async function requireUser(request, env, { allowMustChange = false } = {}) {
  const u = await currentUser(request, env);
  if (!u) throw new HttpError(401, "กรุณาเข้าสู่ระบบ");
  if (u.must_change && !allowMustChange) throw new HttpError(403, "กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน");
  return u;
}

export async function startSession(env, user) {
  const token = randomId(32);
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
  await env.AUDIT_DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(await sha256Hex(token), user.id, nowIso(), expires)
    .run();
  // Housekeeping: expired sessions are never needed again.
  await env.AUDIT_DB.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(nowIso()).run();
  return json({ user: publicUser(user) }, 200, { "set-cookie": setCookie(token, SESSION_HOURS * 3600) });
}

// Failed logins per IP and per e-mail within 15 minutes.
const failures = new Map();
const LOGIN_FAILS = 8;
async function failCount(env, key, add = 0) {
  const k = `login:${key}:${Math.floor(Date.now() / 900_000)}`;
  const n = Number(env.RATE ? (await env.RATE.get(k)) || 0 : failures.get(k) || 0) + add;
  if (add) {
    if (env.RATE) await env.RATE.put(k, String(n), { expirationTtl: 1800 });
    else failures.set(k, n);
  }
  return n;
}

function cleanNewUser(body) {
  const u = {
    email: String(body.email || "").trim().toLowerCase(),
    name: String(body.name || "").trim(),
    initials: String(body.initials || "").trim().toUpperCase(),
  };
  if (!EMAIL_RE.test(u.email)) throw new HttpError(400, "อีเมลไม่ถูกต้อง");
  if (u.name.length < 2 || u.name.length > 80) throw new HttpError(400, "ชื่อต้องยาว 2–80 ตัวอักษร");
  if (!INITIALS_RE.test(u.initials)) throw new HttpError(400, "ชื่อย่อต้องเป็นตัวอักษร 2–4 ตัว");
  return u;
}

export async function insertUser(env, u, firmRole, pw, mustChange) {
  const row = { id: randomId(8), ...u, firm_role: firmRole, ...(await hashPassword(pw, env)), must_change: mustChange ? 1 : 0, disabled: 0, created_at: nowIso() };
  try {
    await env.AUDIT_DB.prepare(
      "INSERT INTO users (id, email, name, initials, firm_role, pw_salt, pw_hash, pw_iter, must_change, disabled, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    )
      .bind(row.id, row.email, row.name, row.initials, row.firm_role, row.pw_salt, row.pw_hash, row.pw_iter, row.must_change, row.disabled, row.created_at)
      .run();
  } catch (e) {
    if (/UNIQUE|constraint/i.test(String(e?.message))) throw new HttpError(409, "อีเมลหรือชื่อย่อนี้มีผู้ใช้แล้ว");
    throw e;
  }
  return row;
}

const userCount = async (env) => (await env.AUDIT_DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n;

export async function handleAuth(request, env, path) {
  await ensureAppSchema(env);
  const db = env.AUDIT_DB;

  if (path === "/api/auth/me" && request.method === "GET") {
    const u = await currentUser(request, env);
    return json({ user: u ? publicUser(u) : null, setup_needed: (await userCount(env)) === 0 && !!env.SETUP_TOKEN, demo_mode: demoEnabled(env) });
  }

  if (request.method !== "POST") throw new HttpError(405, "ใช้ POST");

  if (path === "/api/auth/setup") {
    const body = await readJson(request);
    if (!env.SETUP_TOKEN) throw new HttpError(503, "ยังไม่ได้ตั้งค่า SETUP_TOKEN");
    if (!sameString(String(body.token || ""), env.SETUP_TOKEN)) throw new HttpError(403, "รหัสตั้งค่าไม่ถูกต้อง");
    if ((await userCount(env)) > 0) throw new HttpError(409, "ตั้งค่าบัญชีแรกไปแล้ว");
    const err = checkPassword(body.password);
    if (err) throw new HttpError(400, err);
    const u = await insertUser(env, cleanNewUser(body), "admin", body.password, false);
    return startSession(env, u);
  }

  if (path === "/api/auth/login") {
    const body = await readJson(request);
    const email = String(body.email || "").trim().toLowerCase();
    const ip = clientIp(request);
    if ((await failCount(env, `ip:${ip}`)) >= LOGIN_FAILS || (await failCount(env, `em:${email}`)) >= LOGIN_FAILS)
      throw new HttpError(429, "ลองเข้าสู่ระบบผิดหลายครั้ง กรุณารอ 15 นาที");
    const u = await db.prepare("SELECT * FROM users WHERE email = ?1").bind(email).first();
    // Hash even when the user does not exist, so timing does not reveal which e-mails have accounts.
    const hash = await pbkdf2(String(body.password || ""), u?.pw_salt ?? "00".repeat(16), u?.pw_iter ?? iterations(env));
    if (!u || u.disabled || !sameString(hash, u.pw_hash)) {
      await failCount(env, `ip:${ip}`, 1);
      await failCount(env, `em:${email}`, 1);
      throw new HttpError(401, "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
    }
    return startSession(env, u);
  }

  if (path === "/api/auth/logout") {
    const token = cookieOf(request);
    if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256Hex(token)).run();
    return json({ ok: true }, 200, { "set-cookie": setCookie("", 0) });
  }

  if (path === "/api/auth/password") {
    const u = await requireUser(request, env, { allowMustChange: true });
    if (isDemoEmail(u.email)) throw new HttpError(403, "บัญชีทดลองใช้ร่วมกันหลายคน จึงเปลี่ยนรหัสผ่านไม่ได้");
    const body = await readJson(request);
    if (!sameString(await pbkdf2(String(body.current || ""), u.pw_salt, u.pw_iter), u.pw_hash))
      throw new HttpError(403, "รหัสผ่านเดิมไม่ถูกต้อง");
    const err = checkPassword(body.next);
    if (err) throw new HttpError(400, err);
    if (body.next === body.current) throw new HttpError(400, "รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม");
    const h = await hashPassword(body.next, env);
    await db.batch([
      db.prepare("UPDATE users SET pw_salt = ?1, pw_hash = ?2, pw_iter = ?3, must_change = 0 WHERE id = ?4").bind(h.pw_salt, h.pw_hash, h.pw_iter, u.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(u.id), // sign out everywhere else
    ]);
    return startSession(env, { ...u, must_change: 0 });
  }

  throw new HttpError(404, "ไม่มีบริการนี้");
}

// Firm admin: list and create accounts, disable one, reset a password.
export async function handleUsers(request, env, path) {
  await ensureAppSchema(env);
  const me = await requireUser(request, env);
  const db = env.AUDIT_DB;

  if (path === "/api/users" && request.method === "GET") {
    // Everyone signed in may see the directory (to add team members); only admins see disabled accounts.
    const { results } = await db.prepare("SELECT * FROM users ORDER BY name").all();
    // A shared demo account sees only the demo accounts, never the firm's real users.
    const visible = results.filter((u) => (me.firm_role === "admin" || !u.disabled) && (!isDemoEmail(me.email) || isDemoEmail(u.email)));
    return json({ users: visible.map(publicUser) });
  }
  if (me.firm_role !== "admin") throw new HttpError(403, "เฉพาะผู้ดูแลระบบของสำนักงาน");
  if (request.method !== "POST") throw new HttpError(405, "ใช้ POST");

  if (path === "/api/users") {
    const body = await readJson(request);
    const role = body.firm_role === "admin" ? "admin" : "member";
    const pw = tempPassword();
    const u = await insertUser(env, cleanNewUser(body), role, pw, true);
    return json({ user: publicUser(u), temp_password: pw }, 201);
  }

  const m = path.match(/^\/api\/users\/([a-f0-9]{16})\/(disable|enable|reset)$/);
  if (!m) throw new HttpError(404, "ไม่มีบริการนี้");
  const [, id, op] = m;
  if (id === me.id) throw new HttpError(400, "แก้บัญชีของตัวเองจากหน้านี้ไม่ได้");
  const target = await db.prepare("SELECT * FROM users WHERE id = ?1").bind(id).first();
  if (!target) throw new HttpError(404, "ไม่พบผู้ใช้");
  if (op === "reset") {
    const pw = tempPassword();
    const h = await hashPassword(pw, env);
    const mustChange = isDemoEmail(target.email) ? 0 : 1; // a demo account cannot change its password
    await db.batch([
      db.prepare("UPDATE users SET pw_salt = ?1, pw_hash = ?2, pw_iter = ?3, must_change = ?4 WHERE id = ?5").bind(h.pw_salt, h.pw_hash, h.pw_iter, mustChange, id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(id),
    ]);
    return json({ user: publicUser({ ...target, must_change: mustChange }), temp_password: pw });
  }
  const disabled = op === "disable" ? 1 : 0;
  const stmts = [db.prepare("UPDATE users SET disabled = ?1 WHERE id = ?2").bind(disabled, id)];
  if (disabled) stmts.push(db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(id));
  await db.batch(stmts);
  return json({ user: publicUser({ ...target, disabled }) });
}
