import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";
import { _resetSchemaCache } from "../src/trail.js";
import { purgeExpired } from "../src/engagements.js";
import { signRequest } from "../src/http.js";

const MAP = JSON.parse(readFileSync(new URL("../../web/public/data/conflict_map.json", import.meta.url)));
const FLAG = MAP.flags[0].id;
const SECRET = "pipeline-secret-for-tests";
const PDF = new TextEncoder().encode("%PDF-1.4\nINV-TG-101 ยอดรวมทั้งสิ้น 150,000.00\n%%EOF");
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function fakeD1() {
  const sql = new DatabaseSync(":memory:");
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    all: async () => ({ results: sql.prepare(q).all(...args) }),
    first: async () => sql.prepare(q).get(...args) ?? null,
    run: async () => {
      const r = sql.prepare(q).run(...args);
      return { success: true, meta: { changes: r.changes } };
    },
  });
  // D1 runs a batch as one transaction.
  const batch = async (list) => {
    sql.exec("BEGIN");
    try {
      const out = [];
      for (const s of list) out.push(await s.run());
      sql.exec("COMMIT");
      return out;
    } catch (e) {
      sql.exec("ROLLBACK");
      throw e;
    }
  };
  return { sql, prepare: (q) => stmt(q), batch };
}

let env;
let jobs;
const realFetch = globalThis.fetch;
beforeEach(() => {
  _resetSchemaCache();
  env = {
    ASSETS: { fetch: async () => new Response("static") },
    AUDIT_DB: fakeD1(),
    FILES_DB: fakeD1(),
    FILES_KEY: "k".repeat(48),
    SETUP_TOKEN: "setup-token-123",
    PIPELINE_URL: "https://pipeline.test",
    PIPELINE_SECRET: SECRET,
  };
  jobs = [];
  globalThis.fetch = async (url, init) => {
    jobs.push({ url: String(url), init, body: JSON.parse(init.body) });
    return new Response("{}", { status: 202 });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// A tiny browser: keeps the session cookie, sends the CSRF header like the web app does.
function browser() {
  let cookie = "";
  const call = async (method, path, body, headers = {}) => {
    const isBytes = body instanceof Uint8Array;
    const res = await worker.fetch(
      new Request(`https://app.test${path}`, {
        method,
        headers: {
          ...(cookie && { cookie }),
          ...(method !== "GET" && { "x-ac-csrf": "1" }),
          ...(body && !isBytes && { "content-type": "application/json" }),
          ...headers,
        },
        body: body ? (isBytes ? body : JSON.stringify(body)) : undefined,
      }),
      env,
    );
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const ct = res.headers.get("content-type") || "";
    return { status: res.status, body: ct.includes("json") ? await res.json() : new Uint8Array(await res.arrayBuffer()) };
  };
  return { get: (p) => call("GET", p), post: (p, b, h) => call("POST", p, b, h), raw: call };
}

// Signed call from the pipeline host.
async function internal(method, path, body = new Uint8Array(), secret = SECRET) {
  const { pathname } = new URL(`https://app.test${path}`);
  const headers = await signRequest(secret, method, pathname, body);
  const res = await worker.fetch(new Request(`https://app.test${path}`, { method, headers, body: method === "GET" ? undefined : body }), env);
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
}

async function setupFirm() {
  const admin = browser();
  assert.equal((await admin.get("/api/auth/me")).body.setup_needed, true);
  const user = { email: "mgr@firm.test", name: "Manager One", initials: "MG", password: "correct horse battery" };
  assert.equal((await admin.post("/api/auth/setup", { ...user, token: "wrong" })).status, 403);
  const r = await admin.post("/api/auth/setup", { ...user, token: "setup-token-123" });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.firm_role, "admin");
  assert.equal((await admin.post("/api/auth/setup", { ...user, email: "x@y.z", initials: "XX", token: "setup-token-123" })).status, 409);

  const people = {};
  for (const [key, initials] of [
    ["prep", "PR"],
    ["rev", "RV"],
    ["out", "OT"],
  ]) {
    const c = await admin.post("/api/users", { email: `${key}@firm.test`, name: `User ${key}`, initials });
    assert.equal(c.status, 201);
    const b = browser();
    assert.equal((await b.post("/api/auth/login", { email: `${key}@firm.test`, password: c.body.temp_password })).status, 200);
    assert.equal((await b.get("/api/engagements")).status, 403, "must change the one-time password first");
    assert.equal((await b.post("/api/auth/password", { current: c.body.temp_password, next: "a new long password" })).status, 200);
    people[key] = { b, id: c.body.user.id };
  }
  const e = await admin.post("/api/engagements", { client: "บริษัท ทดสอบ จำกัด", tolerance_pct: 1, materiality_thb: 10000, synthetic: false });
  assert.equal(e.status, 201);
  assert.equal(e.body.engagement.synthetic, true, "real data stays off until ALLOW_REAL_DATA");
  const id = e.body.engagement.id;
  assert.equal((await admin.post(`/api/engagements/${id}/members`, { user_id: people.prep.id, role: "preparer" })).status, 200);
  assert.equal((await admin.post(`/api/engagements/${id}/members`, { user_id: people.rev.id, role: "reviewer" })).status, 200);
  return { admin, ...people, id };
}

test("signature format is shared with the pipeline (same vector as pipeline/tests/test_server.py)", async () => {
  const h = await signRequest("s3cret", "POST", "/jobs", new TextEncoder().encode('{"a":1}'), 1700000000);
  assert.equal(h["x-ac-signature"], "57a512c101447c650964f207bffaa39f89b8e0fbbd61afc5dd84571f0ebcfaa4");
});

test("login: wrong password is refused, state changes need the CSRF header, logout ends the session", async () => {
  const { admin } = await setupFirm();
  const b = browser();
  assert.equal((await b.post("/api/auth/login", { email: "mgr@firm.test", password: "nope nope nope" })).status, 401);
  assert.equal((await b.post("/api/auth/login", { email: "mgr@firm.test", password: "correct horse battery" })).status, 200);
  const noCsrf = await b.raw("POST", "/api/engagements", { client: "X Co" }, { "x-ac-csrf": "0" });
  assert.equal(noCsrf.status, 403);
  assert.equal((await b.post("/api/auth/logout")).status, 200);
  assert.equal((await b.get("/api/engagements")).status, 401);
  assert.equal((await admin.get("/api/engagements")).status, 200, "other sessions are unaffected");
});

test("full engagement: upload → pipeline run → sign-off by role → close → purge after 90 days", async () => {
  const { admin, prep, rev, out, id } = await setupFirm();

  // Isolation: someone outside the team sees nothing.
  assert.equal((await out.b.get(`/api/engagements/${id}`)).status, 403);
  assert.deepEqual((await out.b.get("/api/engagements")).body.engagements, []);

  // Upload: content must match the extension; stored encrypted.
  assert.equal((await prep.b.post(`/api/engagements/${id}/files?name=fake.pdf`, PNG)).status, 415);
  assert.equal((await prep.b.post(`/api/engagements/${id}/files?name=../x.pdf`, PDF)).status, 400);
  assert.equal((await out.b.post(`/api/engagements/${id}/files?name=INV-1.pdf`, PDF)).status, 403);
  const up = await prep.b.post(`/api/engagements/${id}/files?name=${encodeURIComponent("ใบแจ้งหนี้ 1.pdf")}`, PDF);
  assert.equal(up.status, 201);
  const fid = up.body.file.id;
  const chunks = env.FILES_DB.sql.prepare("SELECT data FROM blob_chunks").all();
  assert.ok(chunks.length > 0);
  assert.ok(!Buffer.from(chunks[0].data).toString("latin1").includes("%PDF"), "file bytes are encrypted at rest");
  const dl = await rev.b.get(`/api/engagements/${id}/files/${fid}`);
  assert.deepEqual(dl.body, PDF);

  // Run: the Worker hands the pipeline file ids, never file bytes or storage credentials.
  const r = await prep.b.post(`/api/engagements/${id}/runs`);
  assert.equal(r.status, 202);
  assert.equal(jobs.length, 1);
  const job = jobs[0].body;
  assert.equal(jobs[0].url, "https://pipeline.test/jobs");
  assert.deepEqual(job.files.map((f) => f.id), [fid]);
  assert.equal(job.settings.client, "บริษัท ทดสอบ จำกัด");
  assert.equal((await prep.b.post(`/api/engagements/${id}/runs`)).status, 409, "one run at a time");

  // Pipeline side: signed requests only, and only files listed in this run.
  assert.equal((await internal("GET", `/api/internal/runs/${job.run}/files/${fid}`, undefined, "wrong")).status, 401);
  assert.equal((await internal("GET", `/api/internal/runs/${job.run}/files/${"0".repeat(16)}`)).status, 403);
  const got = await internal("GET", `/api/internal/runs/${job.run}/files/${fid}`);
  assert.equal(got.status, 200);
  assert.deepEqual(got.bytes, PDF);
  const page = MAP.documents.find((d) => d.page)?.page.image ?? "pages/INV-BS-201.png";
  assert.equal((await internal("POST", `/api/internal/runs/${job.run}/asset?path=${page}&result=${MAP.run_id}`, PNG)).status, 200);
  const done = await internal("POST", `/api/internal/runs/${job.run}/done`, new TextEncoder().encode(JSON.stringify(MAP)));
  assert.equal(done.status, 200);
  assert.equal((await internal("POST", `/api/internal/runs/${job.run}/done`, new TextEncoder().encode(JSON.stringify(MAP)))).status, 409, "finished runs accept nothing more");

  const view = await rev.b.get(`/api/engagements/${id}`);
  assert.equal(view.body.current_run, MAP.run_id);
  assert.equal(view.body.runs[0].status, "done");
  assert.equal(view.body.runs[0].summary.flags, MAP.flags.length);
  const data = await rev.b.get(`/api/engagements/${id}/data/${MAP.run_id}/conflict_map.json`);
  assert.equal(data.body.run_id, MAP.run_id);
  assert.equal((await out.b.get(`/api/engagements/${id}/data/${MAP.run_id}/conflict_map.json`)).status, 403);

  // Sign-off: the account signs (body actor ignored); review needs the reviewer role and another person.
  const trail = `/api/engagements/${id}/trail?run=${MAP.run_id}`;
  const p1 = await prep.b.post(trail, { run: MAP.run_id, action: "prepare", target: FLAG, value: "issue", reason: "ไม่มีใบอนุมัติ", actor: "ZZ" });
  assert.equal(p1.status, 201);
  assert.equal(p1.body.event.actor, "PR");
  assert.equal((await prep.b.post(trail, { run: MAP.run_id, action: "review", target: FLAG })).status, 403, "preparer role cannot review");
  const r1 = await rev.b.post(trail, { run: MAP.run_id, action: "review", target: FLAG });
  assert.equal(r1.status, 201);
  assert.equal(r1.body.event.actor, "RV");
  const t = await rev.b.get(trail);
  assert.equal(t.body.chain_ok, true);
  assert.equal(t.body.state.flags[FLAG].review.by, "RV");
  // The demo route cannot read or write an engagement's trail.
  assert.equal((await worker.fetch(new Request(`https://app.test/api/trail?ws=eng-${id}&run=${MAP.run_id}`), env)).status, 403);

  // Q&A only for members, from this engagement's results.
  const ask = await rev.b.post("/api/ask", { question: "รายการไหนควรตรวจ", engagement: id, run: MAP.run_id });
  assert.equal(ask.status, 200);
  assert.equal(ask.body.configured, false);
  assert.equal((await out.b.post("/api/ask", { question: "x", engagement: id, run: MAP.run_id })).status, 403);

  // Close: manager only; then read-only.
  assert.equal((await prep.b.post(`/api/engagements/${id}/close`)).status, 403);
  assert.equal((await admin.post(`/api/engagements/${id}/close`)).status, 200);
  assert.equal((await prep.b.post(`/api/engagements/${id}/files?name=INV-2.pdf`, PDF)).status, 409);
  assert.equal((await prep.b.post(trail, { run: MAP.run_id, action: "reopen", target: FLAG })).status, 409);

  // Retention: nothing happens before 90 days; after, raw files and page images go, the working paper stays.
  assert.deepEqual((await purgeExpired(env, Date.now() + 89 * 86400_000)).purged, []);
  const res = await purgeExpired(env, Date.now() + 91 * 86400_000);
  assert.equal(res.purged.length, 1);
  assert.equal(res.purged[0].objects, 2, "raw PDF + page image");
  assert.equal((await rev.b.get(`/api/engagements/${id}/files/${fid}`)).status, 404);
  assert.equal((await rev.b.get(`/api/engagements/${id}/data/${MAP.run_id}/${page}`)).status, 404);
  assert.equal((await rev.b.get(`/api/engagements/${id}/data/${MAP.run_id}/conflict_map.json`)).status, 200);
  assert.equal((await rev.b.get(trail)).body.events.length, 2, "Audit Trail is kept");
  const after = await rev.b.get(`/api/engagements/${id}`);
  assert.ok(after.body.engagement.purged_at);
  assert.deepEqual(after.body.files, []);
  assert.deepEqual(
    after.body.activity.map((a) => a.action).reverse(),
    ["create", "member", "member", "upload", "download", "run", "run_done", "close", "purge"],
  );
  assert.equal(env.FILES_DB.sql.prepare("SELECT COUNT(*) AS n FROM blob_chunks").get().n, 1, "only conflict_map.json left");
});

test("a key from another engagement cannot decrypt (per-engagement keys)", async () => {
  const { admin, prep, id } = await setupFirm();
  const e2 = (await admin.post("/api/engagements", { client: "อีกบริษัท" })).body.engagement.id;
  const up = await prep.b.post(`/api/engagements/${id}/files?name=a.pdf`, PDF);
  // Move the encrypted rows under the other engagement, as a hand edit of the database would.
  const key = `eng/${id}/raw/${up.body.file.id}`;
  const moved = `eng/${e2}/raw/${up.body.file.id}`;
  env.FILES_DB.sql.prepare("UPDATE blob_chunks SET key = ? WHERE key = ?").run(moved, key);
  env.FILES_DB.sql.prepare("UPDATE blobs SET key = ?, engagement_id = ? WHERE key = ?").run(moved, e2, key);
  const { getBlob } = await import("../src/store.js");
  await assert.rejects(getBlob(env, e2, moved));
});

test("a failed dispatch marks the run failed, stale runs time out, uploads need FILES_KEY", async () => {
  const { prep, id } = await setupFirm();
  await prep.b.post(`/api/engagements/${id}/files?name=a.pdf`, PDF);
  globalThis.fetch = async () => {
    throw new Error("down");
  };
  assert.equal((await prep.b.post(`/api/engagements/${id}/runs`)).status, 502);
  assert.equal((await prep.b.get(`/api/engagements/${id}`)).body.runs[0].status, "failed");

  globalThis.fetch = async () => new Response("{}", { status: 202 });
  assert.equal((await prep.b.post(`/api/engagements/${id}/runs`)).status, 202);
  const res = await purgeExpired(env, Date.now() + 31 * 60_000);
  assert.equal(res.stale_runs, 1);

  delete env.FILES_KEY;
  assert.equal((await prep.b.post(`/api/engagements/${id}/files?name=b.pdf`, PDF)).status, 503);
});

test("demo: admin creates shared accounts and the synthetic engagement; demo passwords cannot be changed", async () => {
  const { admin, prep } = await setupFirm();
  assert.equal((await prep.b.post("/api/users/demo/account/preparer")).status, 403, "admins only");
  assert.equal((await admin.post("/api/users/demo/engagement")).status, 409, "accounts first");

  const pw = {};
  for (const role of ["preparer", "reviewer", "manager"]) {
    const r = await admin.post(`/api/users/demo/account/${role}`);
    assert.equal(r.status, 201);
    assert.equal(r.body.user.firm_role, "member");
    assert.equal(r.body.user.must_change, false);
    pw[role] = r.body.password;
  }
  const e = await admin.post("/api/users/demo/engagement");
  assert.equal(e.status, 201);
  const id = e.body.engagement.id;
  assert.deepEqual(e.body.files, []);
  assert.equal((await admin.post(`/api/engagements/${id}/files?name=INV-TG-101.pdf`, PDF)).status, 201);

  const dm = browser();
  assert.equal((await dm.post("/api/auth/login", { email: "manager@demo.example.com", password: pw.manager })).status, 200);
  const list = (await dm.get("/api/engagements")).body.engagements;
  assert.equal(list.length, 1);
  assert.equal(list[0].my_role, "manager");
  assert.equal(list[0].synthetic, true);
  assert.equal((await dm.post("/api/auth/password", { current: pw.manager, next: "someone else's password" })).status, 403);

  // Again: the same engagement (with its files), a new password, old sessions signed out.
  const again = await admin.post("/api/users/demo/account/manager");
  assert.equal(again.status, 200);
  assert.notEqual(again.body.password, pw.manager);
  assert.equal((await dm.get("/api/engagements")).status, 401);
  const e2 = await admin.post("/api/users/demo/engagement");
  assert.equal(e2.status, 200);
  assert.equal(e2.body.engagement.id, id);
  assert.deepEqual(e2.body.files, ["INV-TG-101.pdf"]);
  const team = (await admin.get(`/api/engagements/${id}`)).body.members.map((m) => `${m.initials}:${m.role}`).sort();
  assert.deepEqual(team, ["DM:manager", "DP:preparer", "DR:reviewer", "MG:manager"]);
});

test("a run whose callbacks never arrive does not block the engagement until the daily cron", async () => {
  const { prep, id } = await setupFirm();
  await prep.b.post(`/api/engagements/${id}/files?name=a.pdf`, PDF);
  globalThis.fetch = async () => new Response("{}", { status: 202 });
  assert.equal((await prep.b.post(`/api/engagements/${id}/runs`)).status, 202);
  assert.equal((await prep.b.post(`/api/engagements/${id}/runs`)).status, 409, "still running");

  const old = new Date(Date.now() - 31 * 60_000).toISOString();
  await env.AUDIT_DB.prepare("UPDATE runs SET started_at = ?1 WHERE engagement_id = ?2").bind(old, id).run();
  const runs = (await prep.b.get(`/api/engagements/${id}`)).body.runs;
  assert.equal(runs[0].status, "failed");
  assert.equal((await prep.b.post(`/api/engagements/${id}/runs`)).status, 202, "can retry");
});
