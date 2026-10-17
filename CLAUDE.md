# Project context — AI Audit Concierge (MoGate, Biztania Camp 2026)

Context file for anyone (human or AI assistant) picking up work in this repo.
Source of truth so far: the team's business pitch deck *Biztania26_Business_MoGate* (12 slides, Canva, Oct 2026).
The human-readable summary is in [`README.md`](README.md).

## What this is

- **Event:** CU-TU Biztania Camp 2026 (business case competition). Repo is Team C.
- **Team name:** MoGate. Members: Sudpidchaya Khonsak, Tiptanya Khunchana.
- **Product:** *AI Audit Concierge* — a B2B SaaS assistant for financial auditors that gathers,
  links and analyses audit evidence across many data sources and flags anomalies with evidence.
- **Current stage:** business concept / pitch plus a conflict-map MVP on synthetic data
  (`pipeline/` Python, `web/` React + TSX, `worker/` Cloudflare Worker JS; see `docs/mvp.md`).
  The plan is a pilot with one small audit firm on one engagement before commercial rollout.
- **MVP rules:** code (not the LLM) decides conflicts; every value needs a verified source quote;
  unclear OCR never raises a flag; ambiguous pairs go to "รอจับคู่" unchecked; bank accounts are
  tokenised at ingestion and only shown masked. Sign-offs and decisions go to an append-only, hash-chained
  Audit Trail in D1 (`worker/src/trail.js`); the server stamps time and evidence refs. `pipeline/samples/tg_company/expected.json` is the
  answer key the tests score against.
- **Engagements (uploads):** login with per-engagement roles preparer / reviewer / manager (the signer is the account);
  every API checks team membership; files are AES-GCM encrypted per engagement in D1 `auditpal-files`; the Python
  pipeline runs on a stateless Render container called with HMAC (`pipeline/auditconcierge/server.py`); raw files and
  page images are deleted `RETENTION_DAYS` (90) after closing, the working paper and trail stay. `ALLOW_REAL_DATA`
  stays false (synthetic only) until the AI provider is switched. Deploy steps: `docs/deploy-pipeline.md`.
  Demo for outside users: an admin button on the users page creates shared accounts `{preparer,reviewer,manager}@demo.example.com`
  (no password change, passwords shown once, never in the repo) and a synthetic engagement with the sample set (`worker/src/demo.js`, `docs/demo.md`).

## Core principles (keep these consistent in any material or prototype)

1. **Assistant, not replacement.** The AI never declares fraud or that a transaction is definitely wrong.
   It highlights items that look abnormal or deserve a closer look.
2. **Human in the loop.** Professional Judgment always stays with the auditor; the AI hands over
   findings plus evidence and the auditor decides.
3. **Explainability & traceability.** Every flag must cite its reasoning and source documents
   (Audit Trail).
4. **Security first.** Audit data is confidential: access control, encryption, per-client data isolation,
   usage logging.
5. **Cross-source, context-aware.** Value comes from connecting data across sources *and* applying each
   company's own rules (something normal in one company may be abnormal in another).

## The 5-step AI pipeline

| Step | Does | Running example from the deck |
| --- | --- | --- |
| Remember | Store per-company context: policies, approval rules, issues from previous audits | "Purchases over 100,000 THB need manager approval" |
| Understand | Read/interpret Invoice, Excel, Bank Statement, Contract | `TG Company` → Vendor; `Invoice No. 001` → invoice number; `Total ฿150,000` → amount |
| Retrieve | Auditor asks in natural language; AI pulls relevant data from many files | No more opening files one by one |
| Connect | Join transactions with remembered context; show relationships and anomalies | A 120,000 THB auto-parts purchase is matched against the approval rule |
| Reason | Rate risk, give reasons + cited evidence, suggest follow-up questions | Approval missing → flag with evidence for the auditor to decide |

Data sources named in the deck: ERP, Invoice, PO, Bank Statement, Vendor data, Contracts, Excel/PDF.
Features named: document reading (OCR), 3-Way Matching, anomaly & risk detection, multi-source
reconciliation, follow-up, dashboards, ERP/accounting integration, custom risk rules.

## Users and stakeholders

- **Users:** Auditor (Staff/Senior), Audit Junior, Audit Team, Internal Auditor.
- **Payer:** the **Audit Firm** (mid-sized, non-Big 4) — buys the subscription.
- **Audit Partner & Manager:** oversee engagements; want risk prioritisation and traceable evidence.
- **Audit Client:** the audited company's finance team; owns the data; wants fewer repeat document
  requests and safe handling of their data.

## Business model (numbers as stated in the deck)

- SaaS, **tiered annual subscription** sold to audit firms. Prices are explicitly a *business assumption*,
  not market prices.
  - Starter: 1–5 auditors, ~300,000 THB/yr
  - Professional: 6–20 auditors, ~900,000 THB/yr
  - Enterprise: 20+ auditors, ~2,000,000 THB/yr
- Rationale: audits recur yearly; ongoing costs (cloud, AI processing, storage, security, maintenance);
  avoids a ~5M THB up-front purchase.
- Market: TAM ≈ USD 1,165M (≈ 41,000M THB) global AI-for-audit market in 2026; SAM ≈ 71M THB/yr in Thailand
  (~0.17% of TAM).
- SOM / revenue projection: Y1 5 clients (3 Starter, 2 Pro) 2.7M THB (~3.8%); Y2 9 clients (6/3) 4.5M THB
  (~6.3%); Y3 13 clients (8/5) 7.1M THB (~9.7%).
  - Note: 8×300k + 5×900k = 6.9M, not 7.1M; the deck's Y3 figure is slightly off from its own pricing.
    Recheck before reusing.
- Target market: non-Big 4 audit firms serving listed companies, plus internal audit teams of large
  organisations. Deck cites 96.9% of Thai audit firms without in-house AI vs. 3.1% Big 4.
- Thai enterprise AI adoption cited: 40.5% (2022) → 47.0% (2025) → 61.0% (2026).
- Tailwinds: Big 4 already normalised AI in audit; mandatory annual audits; SEC (ก.ล.ต.) tightening audit
  quality. Constraints: small Thai market; Big 4 build in-house; long enterprise sales cycles; foreign
  competitors entering.

## Feasibility and roadmap

- Feasibility: technology High, data integration Medium, auditor collaboration High, data security Medium,
  user acceptance Medium, business model High.
- Roadmap: **Pilot** (1 small firm, 1 engagement, real data, controlled scope) → **Measure** (time saved,
  extraction accuracy, anomalies found, error count, auditor acceptance, ROI) → **Improve** (accuracy,
  integrations, security, UX, per-company policy understanding) → **Scale** commercially.

## Working conventions

- The team writes in **Thai**; keep user-facing docs in Thai, with English for technical/business terms
  (as the deck does). Code, identifiers and commit messages in English.
- When adding numbers or claims, keep them consistent with this file or update this file in the same change.
