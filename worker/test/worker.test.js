import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker, { askGemini, buildContext, handleAsk, modelChain, takeQuota } from "../src/index.js";

const MAP = JSON.parse(readFileSync(new URL("../../web/public/data/conflict_map.json", import.meta.url)));

const assets = {
  fetch: async (req) => {
    const path = new URL(req.url).pathname;
    return path === "/data/conflict_map.json" ? Response.json(MAP) : new Response("static " + path);
  },
};
const ask = (q, ip = "1.1.1.1") =>
  new Request("https://demo.test/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ question: q }),
  });

test("context carries flags and rules but no document dumps or account tokens", () => {
  const ctx = buildContext(MAP);
  assert.equal(ctx.flags.length, MAP.flags.length);
  const s = JSON.stringify(ctx);
  assert.ok(!s.includes("sha256"));
  assert.ok(!s.includes("account_token"));
  assert.ok(!/\d{3}-\d-\d{5}-\d/.test(s), "no unmasked bank account");
});

test("without a key the Worker answers from keyword search and says it is not configured", async () => {
  const r = await handleAsk(ask("บัญชี vendor"), { ASSETS: assets });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.configured, false);
  assert.ok(body.cited.length > 0);
});

test("with a key the Worker calls Gemini with the key in a header and drops invented flag ids", async () => {
  let seen;
  const fakeFetch = async (url, init) => {
    seen = { url, init };
    const text = JSON.stringify({ answer: "ควรตรวจ F001", cited: ["F001", "F999"] });
    return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
  };
  const env = { ASSETS: assets, GEMINI_API_KEY: "k-test", DAILY_LIMIT_PER_IP: "5", DAILY_LIMIT_TOTAL: "50" };
  const r = await handleAsk(ask("มีอะไรควรตรวจ", "2.2.2.2"), env, fakeFetch);
  const body = await r.json();
  assert.equal(seen.init.headers["x-goog-api-key"], "k-test");
  assert.ok(!seen.url.includes("k-test"), "key not in URL");
  assert.deepEqual(body.cited, MAP.flags.some((f) => f.id === "F001") ? ["F001"] : []);
});

test("daily per-IP limit returns 429", async () => {
  const env = { ASSETS: assets, GEMINI_API_KEY: "k", DAILY_LIMIT_PER_IP: "2", DAILY_LIMIT_TOTAL: "100" };
  const ok = async () => Response.json({ candidates: [{ content: { parts: [{ text: '{"answer":"x","cited":[]}' }] } }] });
  assert.equal((await handleAsk(ask("a b", "3.3.3.3"), env, ok)).status, 200);
  assert.equal((await handleAsk(ask("a b", "3.3.3.3"), env, ok)).status, 200);
  assert.equal((await handleAsk(ask("a b", "3.3.3.3"), env, ok)).status, 429);
});

test("quota uses KV when bound", async () => {
  const store = new Map();
  const RATE = { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v) };
  const env = { RATE, DAILY_LIMIT_PER_IP: "1", DAILY_LIMIT_TOTAL: "10" };
  assert.equal(await takeQuota(env, "9.9.9.9", "2026-10-16"), true);
  assert.equal(await takeQuota(env, "9.9.9.9", "2026-10-16"), false);
});

test("rejects empty or too-long questions, unknown API routes and GET on /api/ask", async () => {
  const env = { ASSETS: assets };
  assert.equal((await handleAsk(ask(""), env)).status, 400);
  assert.equal((await handleAsk(ask("ก".repeat(301)), env)).status, 400);
  assert.equal((await worker.fetch(new Request("https://demo.test/api/upload", { method: "POST" }), env)).status, 404);
  assert.equal((await worker.fetch(new Request("https://demo.test/api/ask"), env)).status, 405);
  assert.equal(await (await worker.fetch(new Request("https://demo.test/"), env)).text(), "static /");
});

test("Gemini failure falls back to keyword answer with 502", async () => {
  const env = { ASSETS: assets, GEMINI_API_KEY: "k", DAILY_LIMIT_PER_IP: "5", DAILY_LIMIT_TOTAL: "50" };
  const r = await handleAsk(ask("ซ้ำ", "4.4.4.4"), env, async () => new Response("no", { status: 500 }));
  const body = await r.json();
  assert.equal(r.status, 502);
  assert.match(body.answer, /^บริการ AI ขัดข้อง/);
});

test("Gemma: no JSON mode in the request, thinking parts dropped, fenced JSON parsed", async () => {
  let sent;
  const fakeFetch = async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return Response.json({
      candidates: [
        {
          content: {
            parts: [
              { text: "internal reasoning F005", thought: true },
              { text: 'คำตอบ:\n```json\n{"answer": "ควรตรวจ F005", "cited": ["F005"]}\n```' },
            ],
          },
        },
      ],
    });
  };
  const env = { ASSETS: assets, GEMINI_API_KEY: "k", GEMINI_MODEL: "gemma-4-26b-a4b-it", DAILY_LIMIT_PER_IP: "5", DAILY_LIMIT_TOTAL: "50" };
  const body = await (await handleAsk(ask("บัญชีปลายทาง", "5.5.5.5"), env, fakeFetch)).json();
  assert.match(sent.url, /models\/gemma-4-26b-a4b-it:generateContent$/);
  assert.equal(sent.body.generationConfig.responseMimeType, undefined);
  assert.ok(sent.body.systemInstruction);
  assert.equal(body.answer, "ควรตรวจ F005");
  assert.deepEqual(body.cited, ["F005"]);
});

const okReply = (answer) =>
  Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer, cited: [] }) }] } }] });
const modelOf = (url) => url.match(/models\/([^:]+):/)[1];

test("model chain: comma list, trimmed, de-duplicated; falls back to GEMINI_MODEL", () => {
  assert.deepEqual(modelChain({ GEMINI_MODELS: " a, b ,a,," }), ["a", "b"]);
  assert.deepEqual(modelChain({ GEMINI_MODEL: "solo" }), ["solo"]);
});

test("fallback: 429, token-limit 400, 404 and empty answers move to the next model", async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    const m = modelOf(url);
    calls.push(m);
    if (m === "fb-quota") return new Response("quota", { status: 429 });
    if (m === "fb-tokens") return new Response("input token count exceeds", { status: 400 });
    if (m === "fb-missing") return new Response("not found", { status: 404 });
    if (m === "fb-empty") return Response.json({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] });
    return okReply(`from ${m}`);
  };
  const env = { GEMINI_API_KEY: "k", GEMINI_MODELS: "fb-quota,fb-tokens,fb-missing,fb-empty,fb-good,fb-never" };
  const out = await askGemini(env, "q", buildContext(MAP), fakeFetch);
  assert.deepEqual(calls, ["fb-quota", "fb-tokens", "fb-missing", "fb-empty", "fb-good"]);
  assert.equal(out.model, "fb-good");
  assert.equal(out.answer, "from fb-good");
});

test("a model that hit its quota is skipped for a minute, then tried again", async () => {
  const calls = [];
  let quotaFull = true;
  const fakeFetch = async (url) => {
    const m = modelOf(url);
    calls.push(m);
    return m === "cd-first" && quotaFull ? new Response("quota", { status: 429 }) : okReply(m);
  };
  const env = { GEMINI_API_KEY: "k", GEMINI_MODELS: "cd-first,cd-second" };
  const t0 = 1_000_000;
  await askGemini(env, "q", buildContext(MAP), fakeFetch, t0);
  await askGemini(env, "q", buildContext(MAP), fakeFetch, t0 + 30_000);
  quotaFull = false;
  const later = await askGemini(env, "q", buildContext(MAP), fakeFetch, t0 + 61_000);
  assert.deepEqual(calls, ["cd-first", "cd-second", "cd-second", "cd-first"]);
  assert.equal(later.model, "cd-first");
});

test("a rejected key stops the chain instead of trying every model", async () => {
  const calls = [];
  const fakeFetch = async (url) => (calls.push(modelOf(url)), new Response("bad key", { status: 403 }));
  const env = { GEMINI_API_KEY: "bad", GEMINI_MODELS: "key-a,key-b,key-c" };
  await assert.rejects(askGemini(env, "q", buildContext(MAP), fakeFetch), /all models failed/);
  assert.deepEqual(calls, ["key-a"]);
});
