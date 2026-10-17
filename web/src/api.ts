import { bi, locale, t } from "./i18n";

// Worker API calls. State changes carry x-ac-csrf, which the Worker requires.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; bytes?: Blob } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.bytes ? "POST" : "GET");
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["x-ac-csrf"] = "1";
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  let r: Response;
  try {
    r = await fetch(path, { method, headers, body: opts.bytes ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined), credentials: "same-origin" });
  } catch {
    throw new ApiError(0, t("เชื่อมต่อ server ไม่ได้", "Cannot reach the server"));
  }
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, b.error ?? b.answer ?? `HTTP ${r.status}`);
  return b as T;
}

export interface User {
  id: string;
  email: string;
  name: string;
  initials: string;
  firm_role: "admin" | "member";
  must_change: boolean;
  disabled: boolean;
  demo?: boolean;
}

export type Role = "auditor";
export const ROLE_LABEL: Record<string, string> = bi({ auditor: ["ผู้สอบบัญชี", "Auditor"] });

export interface Engagement {
  id: string;
  client: string;
  period: string | null;
  synthetic: boolean;
  status: "open" | "closed";
  /** Sign-off of the current results, if any (separate from closing the company). */
  signoff?: { by: string; at: string } | null;
  /** False for the main demo company when signed in as the shared demo account. */
  can_delete?: boolean;
  created_at: string;
  closed_at: string | null;
  purged_at: string | null;
  my_role: Role;
}

export interface FileRow {
  id: string;
  name: string;
  size: number;
  sha256: string;
  uploaded_at: string;
  uploaded_by: string;
}

export interface RunProgress {
  stage: "waking" | "download" | "ocr" | "read" | "pages" | "check" | "upload";
  done: number | null;
  total: number | null;
  file: string | null;
  at: string;
}

export interface Run {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  started_at: string;
  finished_at: string | null;
  result_run_id: string | null;
  summary: { flags: number; pending: number; documents: number; unreadable: number; files?: { name: string; sha256: string | null; read: boolean; reason: string | null }[] } | null;
  error: string | null;
  files: number;
  progress: RunProgress | null;
}

export interface EngagementDetail {
  engagement: Engagement;
  members: { id: string; name: string; initials: string; email: string; role: Role }[];
  files: FileRow[];
  runs: Run[];
  current_run: string | null;
  activity: { seq: number; at: string; actor: string; action: string; detail: Record<string, unknown> | null }[];
  pipeline_configured: boolean;
  retention_days: number;
  store_configured: boolean;
}

export interface ManagedFile {
  id: string;
  engagement_id: string;
  name: string;
  ext: string;
  size: number;
  sha256: string;
  uploaded_at: string;
  uploaded_by: string;
  in_latest_run: boolean;
}

export interface FilesOverview {
  storage: {
    quota: number;
    used: number;
    files: number;
    pages: number;
    others: number;
    overhead: number;
    by_type: { ext: string; bytes: number; count: number }[];
  };
  engagements: { id: string; client: string; period: string | null; status: "open" | "closed"; signoff?: { by: string; at: string } | null; purged: boolean; my_role: Role; can_delete: boolean }[];
  files: ManagedFile[];
}

export const when = (iso: string) => new Date(iso).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });
