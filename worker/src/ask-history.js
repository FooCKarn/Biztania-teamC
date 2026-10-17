// Saved AI Q&A conversations: per engagement and per user, in D1. The model only sees the last few
// turns plus a one-line digest of older questions, so a long chat does not grow the prompt.
import { requireUser } from "./auth.js";
import { HttpError } from "./http.js";
import { ensureAppSchema } from "./schema.js";

export const RECENT_TURNS = 6; // question+answer pairs sent to the model verbatim
const MAX_DIGEST = 10;
const MAX_LIST = 50;
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// Messages (oldest first) → { digest, turns }. Turns are Gemini-shaped, alternating user/model and
// starting with a user message; older questions collapse into one short digest line.
export function buildHistory(messages) {
  const pairs = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user" && messages[i + 1]?.role === "assistant") pairs.push([messages[i], messages[++i]]);
  }
  const older = pairs.slice(0, Math.max(0, pairs.length - RECENT_TURNS)).slice(-MAX_DIGEST);
  const recent = pairs.slice(-RECENT_TURNS);
  return {
    digest: older.length ? `คำถามก่อนหน้าในบทสนทนานี้: ${older.map(([q]) => clip(q.content, 80)).join(" | ")}` : "",
    turns: recent.flatMap(([q, a]) => [
      { role: "user", parts: [{ text: clip(q.content, 300) }] },
      { role: "model", parts: [{ text: clip(a.content, 600) }] },
    ]),
  };
}

export async function loadConversation(env, engagementId, userId, convId) {
  const conv = await env.AUDIT_DB.prepare("SELECT id, title FROM ask_conversations WHERE id = ?1 AND engagement_id = ?2 AND user_id = ?3")
    .bind(convId, engagementId, userId)
    .first();
  if (!conv) return null;
  const { results } = await env.AUDIT_DB.prepare("SELECT role, content, cited, model, created_at FROM ask_messages WHERE conversation_id = ?1 ORDER BY id")
    .bind(convId)
    .all();
  return { ...conv, messages: results };
}

// Appends one question and its answer; starts the conversation when convId is empty. Returns its id.
export async function saveTurn(env, { engagementId, userId, convId, question, answer }) {
  const now = new Date().toISOString();
  const id = convId || crypto.randomUUID();
  const stmts = [];
  if (!convId)
    stmts.push(
      env.AUDIT_DB.prepare("INSERT INTO ask_conversations (id, engagement_id, user_id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)").bind(
        id,
        engagementId,
        userId,
        clip(question, 60),
        now,
      ),
    );
  else stmts.push(env.AUDIT_DB.prepare("UPDATE ask_conversations SET updated_at = ?2 WHERE id = ?1").bind(id, now));
  const msg = env.AUDIT_DB.prepare("INSERT INTO ask_messages (conversation_id, role, content, cited, model, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)");
  stmts.push(msg.bind(id, "user", question, null, null, now));
  stmts.push(msg.bind(id, "assistant", String(answer.answer), JSON.stringify(answer.cited || []), answer.model || null, now));
  await env.AUDIT_DB.batch(stmts);
  return id;
}

// GET /api/ask/conversations?engagement=ID            → the signed-in user's past conversations
// GET /api/ask/conversations?engagement=ID&id=CONV    → one conversation with its messages
export async function handleConversations(request, env) {
  if (request.method !== "GET") throw new HttpError(405, "ใช้ GET");
  const user = await requireUser(request, env);
  await ensureAppSchema(env);
  const url = new URL(request.url);
  const eng = url.searchParams.get("engagement") || "";
  const member = await env.AUDIT_DB.prepare("SELECT 1 AS ok FROM members WHERE engagement_id = ?1 AND user_id = ?2").bind(eng, user.id).first();
  if (!member) throw new HttpError(403, "คุณไม่ได้อยู่ในทีมของบริษัทนี้");
  const id = url.searchParams.get("id");
  if (id) {
    const conv = await loadConversation(env, eng, user.id, id);
    if (!conv) throw new HttpError(404, "ไม่พบบทสนทนา");
    return new Response(JSON.stringify({ conversation: conv }), { headers: { "content-type": "application/json; charset=utf-8" } });
  }
  const { results } = await env.AUDIT_DB.prepare(
    "SELECT id, title, updated_at FROM ask_conversations WHERE engagement_id = ?1 AND user_id = ?2 ORDER BY updated_at DESC LIMIT ?3",
  )
    .bind(eng, user.id, MAX_LIST)
    .all();
  return new Response(JSON.stringify({ conversations: results }), { headers: { "content-type": "application/json; charset=utf-8" } });
}
