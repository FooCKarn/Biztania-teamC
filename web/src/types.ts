// Shape of pipeline/out conflict_map.json (schema_version 0.2).

export type Risk = "สูง" | "กลาง" | "ต่ำ";
export type MatchLevel = "sure" | "likely" | "pending" | "none";
export type Kind = "po" | "gr" | "invoice" | "payment" | "vendor" | "contract" | "policy";

export interface Field {
  name: string;
  value: string | number | null;
  quote: string;
  locator: string;
  verified: boolean;
  method: "template" | "llm" | "table" | "ocr";
  clear: boolean;
  bbox: number[] | null;
  crop: string | null;
}

export interface Doc {
  id: string;
  kind: Kind;
  file: string;
  format: string;
  sha256: string;
  fields: Record<string, Field>;
  vendor: string | null;
  vendor_how: string | null;
  link: { parent: string | null; level: MatchLevel; why: string } | null;
  in_flags: boolean;
  /** Page image for the document viewer (PDF/scan only); field and evidence bboxes are in its pixels. */
  page?: { image: string; width: number; height: number } | null;
}

export interface Evidence {
  doc: string;
  file: string;
  format: string;
  field: string;
  value: string | number | null;
  quote: string;
  locator: string;
  method: string;
  bbox: number[] | null;
}

export interface Flag {
  id: string;
  type: string;
  title: string;
  summary: string;
  docs: string[];
  transaction: string | null;
  evidence: Evidence[];
  basis: string | null;
  match: MatchLevel;
  at_stake_thb: number | null;
  severity: number;
  risk: Risk;
  status: string;
  questions: string[];
  ocr: boolean;
}

export interface Comparison {
  transaction: string;
  a: string;
  b: string;
  field: string;
  status: "agrees" | "conflicts";
}

export interface Transaction {
  id: string;
  members: string[];
  vendor: string | null;
  match: MatchLevel;
  links: Comparison[];
  flags: string[];
  pending: boolean;
}

export interface Pending {
  doc: string;
  kind: Kind;
  why: string;
  candidates: string[];
}

export interface Rule {
  id: string;
  kind: string;
  source_doc: string;
  source_quote: string;
  verified: boolean;
  threshold_thb?: number;
  required_role?: string;
}

export interface Vendor {
  code: string;
  name_th: string;
  name_en: string;
  tax_id: string;
  account_masked: string;
  record: string;
}

export interface ConflictMap {
  schema_version: string;
  run_id: string;
  engagement: { client: string; tolerance_pct: number; materiality_thb: number; synthetic: boolean };
  rules: Rule[];
  vendors: Vendor[];
  files: { file: string; sha256: string | null; read: boolean }[];
  documents: Doc[];
  transactions: Transaction[];
  flags: Flag[];
  pending: Pending[];
  coverage: {
    files: number;
    unreadable_files: string[];
    unclear_fields: { doc: string; field: string; locator: string; quote: string }[];
    unverified_fields: { doc: string; field: string }[];
  };
}

/** Working-paper sign-off: the preparer gives the verdict and reason, a different person reviews. */
export interface Decision {
  verdict: "issue" | "not_issue";
  reason: string;
  at: string;
  by?: string;
  review?: { by: string; at: string };
}

/** One append-only Audit Trail entry (from /api/trail; the server sets at, evidence and the hashes). */
export interface TrailEvent {
  run_id: string;
  seq: number;
  at: string;
  actor: string;
  action: "prepare" | "review" | "unreview" | "reopen" | "pair";
  /** Flag id (e.g. F001) or `pair:<doc id>`. */
  target: string;
  value: string | null;
  reason: string | null;
  evidence: { doc: string; file?: string; locator?: string; sha256: string | null }[];
  prev_hash: string;
  hash: string;
}
