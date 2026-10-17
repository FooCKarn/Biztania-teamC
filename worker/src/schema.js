// Tables for accounts, engagements and their files (D1 / SQLite). Created on first use, like trail.js.
// The activity log is append-only (triggers), the same way as the Audit Trail.

const MEMBERS_TABLE = `CREATE TABLE IF NOT EXISTS members (
    engagement_id TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('auditor')),
    added_by      TEXT NOT NULL,
    added_at      TEXT NOT NULL,
    PRIMARY KEY (engagement_id, user_id)
  )`;

const APP_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    email      TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    initials   TEXT NOT NULL UNIQUE,
    firm_role  TEXT NOT NULL CHECK (firm_role IN ('admin', 'member')),
    pw_salt    TEXT NOT NULL,
    pw_hash    TEXT NOT NULL,
    pw_iter    INTEGER NOT NULL,
    must_change INTEGER NOT NULL DEFAULT 0,
    disabled   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS engagements (
    id             TEXT PRIMARY KEY,
    client         TEXT NOT NULL,
    period         TEXT,
    tolerance_pct  REAL NOT NULL,
    materiality_thb REAL NOT NULL,
    synthetic      INTEGER NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('open', 'closed')),
    created_by     TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    closed_by      TEXT,
    closed_at      TEXT,
    purged_at      TEXT
  )`,
  MEMBERS_TABLE,
  `CREATE TABLE IF NOT EXISTS files (
    id            TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL,
    name          TEXT NOT NULL,
    size          INTEGER NOT NULL,
    sha256        TEXT NOT NULL,
    uploaded_by   TEXT NOT NULL,
    uploaded_at   TEXT NOT NULL,
    deleted_at    TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS runs (
    id            TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
    file_ids      TEXT NOT NULL,
    started_by    TEXT NOT NULL,
    started_at    TEXT NOT NULL,
    finished_at   TEXT,
    result_run_id TEXT,
    summary       TEXT,
    error         TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS run_progress (
    run_id     TEXT PRIMARY KEY,
    stage      TEXT NOT NULL,
    done       INTEGER,
    total      INTEGER,
    file       TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activity (
    engagement_id TEXT NOT NULL,
    seq           INTEGER NOT NULL,
    at            TEXT NOT NULL,
    actor         TEXT NOT NULL,
    action        TEXT NOT NULL,
    detail        TEXT,
    PRIMARY KEY (engagement_id, seq)
  )`,
  `CREATE TRIGGER IF NOT EXISTS activity_no_update BEFORE UPDATE ON activity
   BEGIN SELECT RAISE(ABORT, 'activity log is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS activity_no_delete BEFORE DELETE ON activity
   BEGIN SELECT RAISE(ABORT, 'activity log is append-only'); END`,
];

// Encrypted file contents live in their own database (FILES_DB) so the 90-day purge and the
// size of client files never touch the Audit Trail database. Falls back to AUDIT_DB if unbound.
const BLOB_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS blobs (
    key           TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL,
    content_type  TEXT NOT NULL,
    size          INTEGER NOT NULL,
    chunks        INTEGER NOT NULL,
    iv            TEXT NOT NULL,
    created_at    TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS blob_chunks (
    key  TEXT NOT NULL,
    idx  INTEGER NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (key, idx)
  )`,
];

const ready = new WeakMap(); // database object → Map(schema name → promise), per Worker instance
function ensure(db, name, statements) {
  let m = ready.get(db);
  if (!m) ready.set(db, (m = new Map()));
  if (!m.has(name)) {
    m.set(
      name,
      (typeof statements === "function" ? statements(db) : db.batch(statements.map((s) => db.prepare(s)))).catch((e) => {
        m.delete(name);
        throw e;
      }),
    );
  }
  return m.get(name);
}

export const filesDb = (env) => env.FILES_DB ?? env.AUDIT_DB;

// Databases created before the single Auditor role still have members.role limited to
// preparer/reviewer/manager, so every new member insert (demo entry, new engagement, adding someone)
// failed its CHECK. CREATE TABLE IF NOT EXISTS cannot change a constraint, so move the old table aside
// as members_legacy (kept, nothing is deleted) and copy its rows into a new one as auditors, in one transaction.
async function migrateMembers(db) {
  const t = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'members'").first();
  if (!t || !/'preparer'/.test(t.sql)) return;
  const legacy = await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'members_legacy'").first();
  const aside = legacy ? `members_legacy_${Date.now()}` : "members_legacy";
  await db.batch(
    [
      `ALTER TABLE members RENAME TO ${aside}`,
      MEMBERS_TABLE,
      `INSERT OR IGNORE INTO members (engagement_id, user_id, role, added_by, added_at) SELECT engagement_id, user_id, 'auditor', added_by, added_at FROM ${aside}`,
    ].map((s) => db.prepare(s)),
  );
}

export async function ensureAppSchema(env) {
  await ensure(env.AUDIT_DB, "app", APP_SCHEMA);
  await ensure(env.AUDIT_DB, "members-auditor", migrateMembers);
  await ensure(filesDb(env), "blobs", BLOB_SCHEMA);
}
