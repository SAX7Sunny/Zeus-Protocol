# ZEUS Protocol — Roadmap

## Status

**Phase 4 — testing (current).** Single HTML file on GitHub Pages, all data in
browser local storage. Calendar subscriptions run through a Cloudflare Worker
CORS proxy. Biomarkers parsed from lab PDFs, stored locally.

Open before phase 5: JSON backup export, biomarker parser rewrite (92 vs 9
values), calendar colour picker, day view.

---

## Phase 5 — backend, accounts, integrations

The unifying idea: **the backend needed for multiple users is the same backend
that unlocks the device integrations.** Whoop and Apple Health both failed
until now for lack of a server-side component, not for lack of app code.

### 5.1 Foundation — Supabase

- Project in **eu-central-1 (Frankfurt)**, so data stays in the EU.
- Auth: email + password via `supabase-js` from CDN.
- Schema: one JSON row per user, mirroring what `saveAll()` already writes.
  Full schema and RLS policies live in `zeus-schema.sql` — do not duplicate
  them here.

**Deployed and verified.** Schema and policies are live on the Supabase
project (eu-central-1). RLS verified 2026-08-17 via `rls-check.sql`: reads
are scoped per user, and cross-user writes are rejected.

- Sync: local-first. Load on start, push on change.
- **Free tier pauses after 7 days of inactivity.** Keep alive with a GitHub
  Actions cron hitting the DB every 3 days (free on a public repo).
- **Free tier has no backups.** The JSON export stays the only safety net.

### 5.2 Test users and GDPR

- Consent gate after signup: no access until a row exists in `consents`.
  Store a `version` so the prompt can reappear when the text changes.
- Required alongside the consent button, not instead of it:
  - a privacy page stating what is stored, where, and for how long
  - a working **delete my account** button (cascades via `on delete cascade`)
  - data export on request — the JSON export covers this
- **Biomarkers stay device-local.** Never uploaded. This keeps Article 9
  health data out of the server entirely and removes most obligations.
  Revisit only with legal advice.

### 5.3 Integrations

| Source | Path | Notes |
|---|---|---|
| **Apple Health** | Shortcuts automation → POST to Edge Function | Only viable route; HealthKit has no web API. Each user installs the Shortcut once. Priority. |
| **Whoop** | OAuth 2.0 authorization code via Edge Function | Public API exists. Client secret lives server-side; function handles token refresh. |
| **Eight Sleep** | Deferred | No official API. Unofficial endpoints need account credentials — not acceptable for other people's accounts. Self-use only, if at all. |

Store fetched metrics per user and per day, keyed by source, so the agenda and
Bio tab can read them without caring where they came from.

### 5.4 Personalisation

- `display_name` in the profile. Header shows **"Mike's Protocol"** instead of
  "ZEUS Protocol"; fall back to "ZEUS Protocol" when unset.
- Per-user section toggles: each tab (Agenda, Routine, Supplements, Calendar,
  Bio) can be switched off and disappears from the tab bar.
- Bio tab specifically: off by default for new users, since most will not
  upload lab reports.
- Defaults: new accounts start from `DEFAULT_ROUTINES` / `DEFAULT_SUPPS`, then
  diverge freely. The existing `seenDefaults` merge logic already handles
  shipping new defaults without overwriting user edits.

---

## Constraints that must survive any rewrite

- Single self-contained HTML file — no build step, no bundler.
- Colours only via CSS variables, never hardcoded hex.
- `node --check` on the extracted script block after every change.
- Never edit `DEFAULT_ROUTINES` without considering the `seenDefaults` merge.
- Secrets — calendar URLs, API tokens — never in the repo.
