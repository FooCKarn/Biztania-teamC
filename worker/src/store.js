// Encrypted file store on D1. AES-256-GCM per engagement: HKDF(FILES_KEY, "engagement:<id>"), with the
// object path as associated data. Refuses to work without FILES_KEY. Files are gzipped before encryption
// and split into ~1 MB rows (D1 row limit is 2 MB).

import { HttpError, nowIso } from "./http.js";
import { filesDb } from "./schema.js";

const CHUNK = 1_000_000;
const enc = new TextEncoder();

async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const isConfigured = (env) => typeof env.FILES_KEY === "string" && env.FILES_KEY.length >= 32;

const keyCache = new Map();
async function engagementKey(env, engagementId) {
  if (!isConfigured(env)) throw new HttpError(503, "ยังไม่ได้ตั้งค่ากุญแจเข้ารหัสไฟล์ (secret FILES_KEY)");
  const cacheKey = `${env.FILES_KEY.length}:${engagementId}`;
  if (!keyCache.has(cacheKey)) {
    const base = await crypto.subtle.importKey("raw", enc.encode(env.FILES_KEY), "HKDF", false, ["deriveKey"]);
    keyCache.set(
      cacheKey,
      crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: enc.encode("auditpal-files-v1"), info: enc.encode(`engagement:${engagementId}`) },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      ),
    );
  }
  return keyCache.get(cacheKey);
}

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function putBlob(env, engagementId, key, bytes, contentType) {
  if (!key.startsWith(`eng/${engagementId}/`)) throw new Error("blob key outside its engagement");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const compressed = await gzip(bytes);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(key) }, await engagementKey(env, engagementId), compressed),
  );
  const db = filesDb(env);
  const chunks = Math.max(1, Math.ceil(ct.length / CHUNK));
  await deleteBlob(env, key);
  // One statement per chunk keeps each request well under D1's size limits; the metadata row goes
  // last, so a half-written object is never readable (getBlob needs the row).
  for (let i = 0; i < chunks; i++)
    await db.prepare("INSERT INTO blob_chunks (key, idx, data) VALUES (?1, ?2, ?3)").bind(key, i, ct.subarray(i * CHUNK, (i + 1) * CHUNK)).run();
  await db
    .prepare("INSERT INTO blobs (key, engagement_id, content_type, size, chunks, iv, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(key, engagementId, contentType, bytes.length, chunks, b64(iv), nowIso())
    .run();
}

export async function getBlob(env, engagementId, key) {
  if (!key.startsWith(`eng/${engagementId}/`)) return null;
  const db = filesDb(env);
  const meta = await db.prepare("SELECT * FROM blobs WHERE key = ?1 AND engagement_id = ?2").bind(key, engagementId).first();
  if (!meta) return null;
  const { results } = await db.prepare("SELECT data FROM blob_chunks WHERE key = ?1 ORDER BY idx").bind(key).all();
  const parts = results.map((r) => new Uint8Array(r.data));
  const ct = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    ct.set(p, off);
    off += p.length;
  }
  const compressed = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(meta.iv), additionalData: enc.encode(key) },
    await engagementKey(env, engagementId),
    ct,
  );
  return { bytes: await gunzip(new Uint8Array(compressed)), contentType: meta.content_type };
}

export async function deleteBlob(env, key) {
  const db = filesDb(env);
  await db.batch([db.prepare("DELETE FROM blob_chunks WHERE key = ?1").bind(key), db.prepare("DELETE FROM blobs WHERE key = ?1").bind(key)]);
}

// Deletes every object of one engagement whose key matches the predicate. Returns how many.
export async function deleteWhere(env, engagementId, keep) {
  const db = filesDb(env);
  // Chunks without a metadata row (an interrupted upload) are found by their key prefix.
  const { results } = await db
    .prepare("SELECT key FROM blobs WHERE engagement_id = ?1 UNION SELECT DISTINCT key FROM blob_chunks WHERE key LIKE ?2")
    .bind(engagementId, `eng/${engagementId}/%`)
    .all();
  let n = 0;
  for (const { key } of results) {
    if (keep(key)) continue;
    await deleteBlob(env, key);
    n++;
  }
  return n;
}
