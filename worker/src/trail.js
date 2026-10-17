// Audit Trail: the auditor's decisions, sign-offs and pair confirmations, stored server-side in D1.
//  - GET  /api/trail?ws=<workspace>&run=<run_id> → events + current state + whether the hash chain holds
//  - POST /api/trail                              → append one event (never update, never delete)
//
// Append-only by construction: the Worker only ever INSERTs, and SQLite triggers reject UPDATE and
// DELETE on the table. Each event carries the SHA-256 of the previous one, so editing a row by
// hand (e.g. from the dashboard console) breaks the chain and GET reports chain_ok: false.
//
// The server, not the browser, decides: the time stamp, whether the action is allowed in the
// current state (review needs a different person than the preparer), and the evidence reference,
// which it copies from the published conflict_map.json (doc, file, locator, file SHA-256).
//
// Demo safety: no file uploads, small JSON bodies only, a daily write limit per IP, and each
// browser gets its own workspace unless a ?ws= link is shared. Initials are self-declared
// until there is a login; the trail records them as typed.

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export const GENESIS = "0".repeat(64);
const MAX_BODY = 2048;
const MAX_REASON = 500;
const WS_RE = /^[a-z0-9-]{4,40}$/;
const ACTOR_RE = /^[A-Z0-9ก-ฮ]{2,4}$/;
const ACTIONS = new Set(["prepare", "review", "unreview", "reopen", "pair"]);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS trail_events (
    workspace TEXT NOT NULL,
    run_id    TEXT NOT NULL,
    seq       INTEGER NOT NULL,
    at        TEXT NOT NULL,
    actor     TEXT NOT NULL,
    action    TEXT NOT NULL,
    target    TEXT NOT NULL,
    value     TEXT,
    reason    TEXT,
    evidence  TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash      TEXT NOT NULL,
    PRIMARY KEY (workspace, run_id, seq)
  )`,
  `CREATE TRIGGER IF NOT EXISTS trail_no_update BEFORE UPDATE ON trail_events
   BEGIN SELECT RAISE(ABORT, 'audit trail is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS trail_no_delete BEFORE DELETE ON trail_events
   BEGIN SELECT RAISE(ABORT, 'audit trail is append-only'); END`,
];

let schemaReady = null; // per Worker instance; CREATE ... IF NOT EXISTS makes a rerun harmless
export function ensureSchema(db) {
  schemaReady ??= db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => {
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}
export const _resetSchemaCache = () => void (schemaReady = null);

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Fixed field order, so the same event always hashes the same way.
export function hashEvent(e) {
  return sha256(
    JSON.stringify([e.prev_hash, e.workspace, e.run_id, e.seq, e.at, e.actor, e.action, e.target, e.value ?? null, e.reason ?? null, e.evidence]),
  );
}

export async function verifyChain(events) {
  let prev = GENESIS;
  for (const e of events) {
    if (e.prev_hash !== prev || (await hashEvent(e)) !== e.hash) return false;
    prev = e.hash;
  }
  return true;
}

// Replay the log into the state the screen shows. The same rules decide whether a new event is allowed.
export function replay(events) {
  const flags = {};
  const pairs = {};
  for (const e of events) {
    if (e.action === "pair") pairs[e.target.replace(/^pair:/, "")] = e.value;
    else if (e.action === "prepare") flags[e.target] = { verdict: e.value, reason: e.reason, at: e.at, by: e.actor };
    else if (e.action === "review" && flags[e.target]) flags[e.target] = { ...flags[e.target], review: { by: e.actor, at: e.at } };
    else if (e.action === "unreview" && flags[e.target]) {
      const { review, ...rest } = flags[e.target];
      flags[e.target] = rest;
    } else if (e.action === "reopen") delete flags[e.target];
  }
  return { flags, pairs };
}

// Returns an error message (Thai, shown to the auditor) or null when the action fits the current state.
export function checkAction(a, state, map) {
  if (!ACTIONS.has(a.action)) return "ไม่รู้จักการกระทำนี้";
  if (!ACTOR_RE.test(a.actor)) return "ชื่อย่อต้องเป็นตัวอักษร 2–4 ตัว";
  if (a.reason.length > MAX_REASON) return `เหตุผลยาวเกิน ${MAX_REASON} ตัวอักษร`;

  if (a.action === "pair") {
    const p = (map.pending || []).find((x) => `pair:${x.doc}` === a.target);
    if (!p) return "ไม่พบเอกสารนี้ในรายการรอจับคู่";
    if (!p.candidates.includes(a.value)) return "คู่ที่เลือกไม่อยู่ในตัวเลือก";
    return null;
  }

  if (!(map.flags || []).some((f) => f.id === a.target)) return "ไม่พบรายการนี้ในผลการตรวจ";
  const cur = state.flags[a.target];
  switch (a.action) {
    case "prepare":
      if (cur) return "รายการนี้ลงนามผู้จัดทำแล้ว ต้องกดแก้ไขก่อน";
      if (a.value !== "issue" && a.value !== "not_issue") return "ผลการพิจารณาไม่ถูกต้อง";
      if (a.reason.length < 5) return "ต้องใส่เหตุผลอย่างน้อย 5 ตัวอักษร";
      return null;
    case "review":
      if (!cur) return "ต้องให้ผู้จัดทำลงนามก่อน";
      if (cur.review) return "รายการนี้สอบทานแล้ว";
      if (cur.by === a.actor) return "ผู้สอบทานต้องไม่ใช่คนเดียวกับผู้จัดทำ";
      return null;
    case "unreview":
      return cur?.review ? null : "รายการนี้ยังไม่ได้สอบทาน";
    case "reopen":
      return cur ? null : "รายการนี้ยังไม่ได้ลงนาม";
  }
  return "ไม่รู้จักการกระทำนี้";
}

// What the decision was based on, copied from the published results (never from the request).
export function evidenceRef(a, map) {
  const sha = new Map((map.documents || []).map((d) => [d.id, d.sha256]));
  if (a.action === "pair") {
    const doc = a.target.replace(/^pair:/, "");
    return [doc, a.value].map((id) => ({ doc: id, sha256: sha.get(id) ?? null }));
  }
  const flag = map.flags.find((f) => f.id === a.target);
  return (flag.evidence || []).map((e) => ({ doc: e.doc, file: e.file, locator: e.locator, sha256: sha.get(e.doc) ?? null }));
}

const writeCounts = new Map(); // fallback when no KV namespace is bound (per Worker instance only)
async function takeWrite(env, ip, today) {
  const limit = Number(env.TRAIL_WRITES_PER_IP || 200);
  const key = `trail:${today}:${ip}`;
  const n = Number(env.RATE ? (await env.RATE.get(key)) || 0 : writeCounts.get(key) || 0);
  if (n >= limit) return false;
  if (env.RATE) await env.RATE.put(key, String(n + 1), { expirationTtl: 60 * 60 * 26 });
  else writeCounts.set(key, n + 1);
  return true;
}

async function loadEvents(db, ws, run) {
  const { results } = await db
    .prepare("SELECT * FROM trail_events WHERE workspace = ?1 AND run_id = ?2 ORDER BY seq")
    .bind(ws, run)
    .all();
  return results.map((r) => ({ ...r, evidence: JSON.parse(r.evidence) }));
}

const publicEvent = ({ workspace, ...e }) => e;

async function loadMap(request, env) {
  const res = await env.ASSETS.fetch(new Request(new URL("/data/conflict_map.json", request.url)));
  return res.ok ? res.json() : null;
}

const notConfigured = () =>
  json({ configured: false, error: "ยังไม่ได้ผูกฐานข้อมูล Audit Trail (D1 binding AUDIT_DB)" }, 503);

export async function handleTrailGet(request, env) {
  if (!env.AUDIT_DB) return notConfigured();
  const url = new URL(request.url);
  const ws = url.searchParams.get("ws") || "";
  const run = url.searchParams.get("run") || "";
  if (!WS_RE.test(ws) || !run) return json({ error: "ต้องระบุ ws และ run" }, 400);
  await ensureSchema(env.AUDIT_DB);
  const events = await loadEvents(env.AUDIT_DB, ws, run);
  return json({ configured: true, events: events.map(publicEvent), state: replay(events), chain_ok: await verifyChain(events) });
}

export async function handleTrailPost(request, env) {
  if (!env.AUDIT_DB) return notConfigured();
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: "คำขอใหญ่เกินไป" }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, 400);
  }
  const ws = String(body.ws || "");
  const run = String(body.run || "");
  if (!WS_RE.test(ws)) return json({ error: "workspace ไม่ถูกต้อง" }, 400);
  const a = {
    action: String(body.action || ""),
    target: String(body.target || ""),
    value: body.value == null ? null : String(body.value),
    reason: String(body.reason || "").trim(),
    actor: String(body.actor || "").trim().toUpperCase(),
  };

  const map = await loadMap(request, env);
  if (!map) return json({ error: "ไม่พบผลการตรวจ (conflict_map.json)" }, 500);
  if (run !== map.run_id) return json({ error: "ผลการตรวจถูกรันใหม่แล้ว กรุณาโหลดหน้าใหม่" }, 409);

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await takeWrite(env, ip, new Date().toISOString().slice(0, 10))))
    return json({ error: "บันทึกครบโควตาของเดโมวันนี้แล้ว" }, 429);

  const db = env.AUDIT_DB;
  await ensureSchema(db);
  // Two writers can read the same last seq; the primary key rejects the second insert, so re-read and retry.
  for (let attempt = 0; attempt < 3; attempt++) {
    const events = await loadEvents(db, ws, run);
    const err = checkAction(a, replay(events), map);
    if (err) return json({ error: err }, 409);
    const last = events.at(-1);
    const e = {
      workspace: ws,
      run_id: run,
      seq: (last?.seq ?? 0) + 1,
      at: new Date().toISOString(),
      ...a,
      reason: a.reason || null,
      evidence: evidenceRef(a, map),
      prev_hash: last?.hash ?? GENESIS,
    };
    e.hash = await hashEvent(e);
    try {
      await db
        .prepare(
          "INSERT INTO trail_events (workspace, run_id, seq, at, actor, action, target, value, reason, evidence, prev_hash, hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        )
        .bind(e.workspace, e.run_id, e.seq, e.at, e.actor, e.action, e.target, e.value, e.reason, JSON.stringify(e.evidence), e.prev_hash, e.hash)
        .run();
    } catch (x) {
      if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(x?.message))) continue;
      throw x;
    }
    const all = [...events, e];
    return json({ configured: true, event: publicEvent(e), state: replay(all), chain_ok: await verifyChain(all) }, 201);
  }
  return json({ error: "มีผู้อื่นบันทึกพร้อมกัน กรุณาลองใหม่" }, 409);
}
