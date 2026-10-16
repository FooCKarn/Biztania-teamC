import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";
import { _resetSchemaCache, verifyChain } from "../src/trail.js";

const MAP = JSON.parse(readFileSync(new URL("../../web/public/data/conflict_map.json", import.meta.url)));
const RUN = MAP.run_id;
const FLAG = MAP.flags[0].id;
const PEND = MAP.pending[0];

const assets = {
  fetch: async (req) =>
    new URL(req.url).pathname === "/data/conflict_map.json" ? Response.json(MAP) : new Response("static"),
};

// Minimal D1 on top of real SQLite, so the append-only triggers are exercised for real.
function fakeD1() {
  const sql = new DatabaseSync(":memory:");
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    all: async () => ({ results: sql.prepare(q).all(...args) }),
    first: async () => sql.prepare(q).get(...args) ?? null,
    run: async () => (sql.prepare(q).run(...args), { success: true }),
  });
  return { sql, prepare: (q) => stmt(q), batch: async (list) => Promise.all(list.map((s) => s.run())) };
}

let env;
let ipN = 0;
beforeEach(() => {
  _resetSchemaCache();
  env = { ASSETS: assets, AUDIT_DB: fakeD1() };
});

const post = (body, ip = `10.0.0.${++ipN}`) =>
  worker.fetch(
    new Request("https://demo.test/api/trail", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ ws: "test-ws", run: RUN, ...body }),
    }),
    env,
  );
const get = (ws = "test-ws") => worker.fetch(new Request(`https://demo.test/api/trail?ws=${ws}&run=${RUN}`), env);

test("prepare then review by another person is stored with server time, evidence and a hash chain", async () => {
  const r1 = await post({ action: "prepare", target: FLAG, value: "issue", reason: "ไม่มีเอกสารอนุมัติ", actor: "sk" });
  assert.equal(r1.status, 201);
  const e1 = (await r1.json()).event;
  assert.equal(e1.actor, "SK");
  assert.equal(e1.seq, 1);
  assert.ok(Math.abs(Date.parse(e1.at) - Date.now()) < 5000, "server sets the time");
  assert.deepEqual(
    e1.evidence.map((e) => e.doc),
    MAP.flags[0].evidence.map((e) => e.doc),
  );
  assert.ok(e1.evidence.every((e) => /^[0-9a-f]{64}$/.test(e.sha256)), "evidence pinned to file hashes");

  assert.equal((await post({ action: "review", target: FLAG, actor: "TK" })).status, 201);
  const body = await (await get()).json();
  assert.equal(body.chain_ok, true);
  assert.equal(body.events.length, 2);
  assert.equal(body.events[1].prev_hash, body.events[0].hash);
  assert.deepEqual(body.state.flags[FLAG].review.by, "TK");
  assert.equal(body.state.flags[FLAG].by, "SK");
  assert.ok(!("workspace" in body.events[0]));
});

test("the browser cannot choose the time or the evidence", async () => {
  const r = await post({ action: "prepare", target: FLAG, value: "not_issue", reason: "มีหนังสือแจ้ง", actor: "SK", at: "2000-01-01", evidence: [{ doc: "FAKE" }] });
  const e = (await r.json()).event;
  assert.notEqual(e.at, "2000-01-01");
  assert.ok(!e.evidence.some((x) => x.doc === "FAKE"));
});

test("state rules: same person cannot review, reason required, no double prepare, unknown flag rejected", async () => {
  assert.equal((await post({ action: "prepare", target: FLAG, value: "issue", reason: "สั้น", actor: "SK" })).status, 409);
  assert.equal((await post({ action: "review", target: FLAG, actor: "TK" })).status, 409);
  assert.equal((await post({ action: "prepare", target: FLAG, value: "issue", reason: "เหตุผลยาวพอ", actor: "SK" })).status, 201);
  assert.equal((await post({ action: "prepare", target: FLAG, value: "issue", reason: "เหตุผลยาวพอ", actor: "SK" })).status, 409);
  const same = await post({ action: "review", target: FLAG, actor: "sk" });
  assert.equal(same.status, 409);
  assert.match((await same.json()).error, /ไม่ใช่คนเดียวกับ/);
  assert.equal((await post({ action: "prepare", target: "F999", value: "issue", reason: "เหตุผลยาวพอ", actor: "SK" })).status, 409);
  assert.equal((await post({ action: "prepare", target: FLAG, value: "maybe", reason: "เหตุผลยาวพอ", actor: "SK" })).status, 409);
  assert.equal((await post({ action: "delete", target: FLAG, actor: "SK" })).status, 409);
  assert.equal((await post({ action: "prepare", target: FLAG, value: "issue", reason: "x".repeat(10), actor: "S" })).status, 409);
});

test("reopen keeps history: the old sign-off stays in the log and a new one is appended", async () => {
  await post({ action: "prepare", target: FLAG, value: "issue", reason: "รอบแรกเป็นประเด็น", actor: "SK" });
  assert.equal((await post({ action: "reopen", target: FLAG, actor: "SK", reason: "ได้เอกสารเพิ่ม" })).status, 201);
  await post({ action: "prepare", target: FLAG, value: "not_issue", reason: "ได้รับใบอนุมัติย้อนหลัง", actor: "SK" });
  const body = await (await get()).json();
  assert.deepEqual(body.events.map((e) => e.action), ["prepare", "reopen", "prepare"]);
  assert.equal(body.state.flags[FLAG].verdict, "not_issue");
  assert.equal(body.chain_ok, true);
});

test("pair confirmation must be one of the listed candidates", async () => {
  assert.equal((await post({ action: "pair", target: `pair:${PEND.doc}`, value: "PO-NOPE", actor: "SK" })).status, 409);
  assert.equal((await post({ action: "pair", target: `pair:${PEND.doc}`, value: PEND.candidates[1], actor: "SK" })).status, 201);
  const body = await (await get()).json();
  assert.equal(body.state.pairs[PEND.doc], PEND.candidates[1]);
});

test("the table rejects UPDATE and DELETE, and a hand-edited row breaks the chain", async () => {
  await post({ action: "prepare", target: FLAG, value: "issue", reason: "ไม่มีเอกสารอนุมัติ", actor: "SK" });
  await post({ action: "review", target: FLAG, actor: "TK" });
  const { sql } = env.AUDIT_DB;
  assert.throws(() => sql.prepare("UPDATE trail_events SET value = 'not_issue'").run(), /append-only/);
  assert.throws(() => sql.prepare("DELETE FROM trail_events").run(), /append-only/);

  const events = (await (await get()).json()).events.map((e) => ({ ...e, workspace: "test-ws" }));
  assert.equal(await verifyChain(events), true);
  events[0].reason = "แก้เหตุผลทีหลัง";
  assert.equal(await verifyChain(events), false);
});

test("workspaces are isolated", async () => {
  await post({ action: "prepare", target: FLAG, value: "issue", reason: "ไม่มีเอกสารอนุมัติ", actor: "SK" });
  const other = await (await get("other-ws")).json();
  assert.equal(other.events.length, 0);
});

test("demo safety: no DB → 503, stale run → 409, big body → 413, bad ws → 400, write limit → 429", async () => {
  const noDb = await worker.fetch(new Request(`https://demo.test/api/trail?ws=test-ws&run=${RUN}`), { ASSETS: assets });
  assert.equal(noDb.status, 503);
  assert.equal((await noDb.json()).configured, false);
  assert.equal((await post({ run: "old-run", action: "review", target: FLAG, actor: "TK" })).status, 409);
  assert.equal((await post({ action: "prepare", target: FLAG, value: "issue", reason: "ก".repeat(3000), actor: "SK" })).status, 413);
  assert.equal((await post({ ws: "BAD WS!", action: "review", target: FLAG, actor: "TK" })).status, 400);
  env.TRAIL_WRITES_PER_IP = "1";
  await post({ action: "reopen", target: FLAG, actor: "TK" }, "9.9.9.9");
  assert.equal((await post({ action: "reopen", target: FLAG, actor: "TK" }, "9.9.9.9")).status, 429);
  assert.equal((await worker.fetch(new Request("https://demo.test/api/trail", { method: "PUT" }), env)).status, 405);
});
