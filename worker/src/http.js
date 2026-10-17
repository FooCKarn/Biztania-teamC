// Small helpers shared by the Worker modules.

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function readJson(request, max = 4096) {
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, "คำขอใหญ่เกินไป");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new HttpError(400, "รูปแบบคำขอไม่ถูกต้อง");
  }
}

export const nowIso = () => new Date().toISOString();

export function randomId(bytes = 16) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

// Constant-time string comparison for hashes and signatures.
export function sameString(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

// Worker ↔ pipeline requests are signed with the shared PIPELINE_SECRET:
// signature = HMAC-SHA256(secret, `${ts}\n${METHOD}\n${path}\n${sha256(body)}`), same in pipeline/server.py.
export async function signRequest(secret, method, path, body, ts = Math.floor(Date.now() / 1000)) {
  const bodyHash = await sha256Hex(body ?? new Uint8Array());
  const msg = `${ts}\n${method.toUpperCase()}\n${path}\n${bodyHash}`;
  const sig = hex(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(msg)));
  return { "x-ac-timestamp": String(ts), "x-ac-signature": sig };
}

export async function verifySigned(request, secret, body, maxSkew = 300) {
  if (!secret) return false;
  const ts = Number(request.headers.get("x-ac-timestamp"));
  const sig = request.headers.get("x-ac-signature") || "";
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > maxSkew) return false;
  const { pathname } = new URL(request.url);
  const expected = await signRequest(secret, request.method, pathname, body, ts);
  return sameString(expected["x-ac-signature"], sig);
}

export const clientIp = (request) => request.headers.get("cf-connecting-ip") || "unknown";
