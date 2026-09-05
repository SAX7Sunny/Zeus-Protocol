// ZEUS Protocol — metrics ingest (ROADMAP.md 5.3: Apple Health, Whoop).
//
// The Apple Shortcut that runs this daily cannot hold a Supabase session:
// access tokens expire after about an hour, so a session-based automation
// would break overnight. It carries a long-lived device token instead
// (device_tokens in zeus-schema.sql) — this function's whole job is to
// turn that token into a user_id, then write with the service-role key,
// which is only ever read from an env var here and never reaches a client.
//
// verify_jwt is off for this function (supabase/config.toml) since the
// caller never has a Supabase JWT at all — Authorization carries the
// device token instead, checked by hand below.
//
// Never logs a token value or payload contents — this is health-adjacent
// data. Only counts and outcomes.

import { createClient } from "@supabase/supabase-js";

const MAX_DAYS = 60;
const MAX_BODY_BYTES = 100 * 1024;
const ALLOWED_SOURCES = ["apple_health", "whoop"];

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Manual constant-time compare: always walks the full length of the
// longer string with no early exit, so how many leading characters
// matched never shows up as a timing difference.
function timingSafeEqualHex(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidDay(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return !Number.isNaN(new Date(s + "T00:00:00Z").getTime());
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed. Use POST." }, 405);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  const presentedToken = bearerMatch?.[1]?.trim();
  if (!presentedToken) {
    return json({ ok: false, error: "Missing bearer token." }, 401);
  }

  const declaredLength = Number(req.headers.get("Content-Length") || "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: "Request body too large." }, 400);
  }
  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: "Request body too large." }, 400);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "Body is not valid JSON." }, 400);
  }
  if (!isPlainObject(body)) {
    return json({ ok: false, error: "Body must be a JSON object." }, 400);
  }

  const { source, days } = body as { source?: unknown; days?: unknown };
  if (typeof source !== "string" || !ALLOWED_SOURCES.includes(source)) {
    return json(
      { ok: false, error: `"source" must be one of: ${ALLOWED_SOURCES.join(", ")}.` },
      400,
    );
  }
  if (!Array.isArray(days) || days.length === 0) {
    return json({ ok: false, error: '"days" must be a non-empty array.' }, 400);
  }
  if (days.length > MAX_DAYS) {
    return json({ ok: false, error: `"days" cannot exceed ${MAX_DAYS} entries.` }, 400);
  }
  for (const entry of days) {
    if (!isPlainObject(entry) || !isValidDay(entry.day)) {
      return json(
        { ok: false, error: 'Each entry in "days" must be an object with a valid "day" (YYYY-MM-DD).' },
        400,
      );
    }
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const presentedHash = await sha256Hex(presentedToken);

  // Fetched and compared in application code, not narrowed by an SQL
  // WHERE token_hash = ..., specifically so the match itself runs at a
  // constant time independent of which row (if any) it is.
  const { data: candidates, error: lookupError } = await admin
    .from("device_tokens")
    .select("id,user_id,token_hash")
    .is("revoked_at", null);
  if (lookupError) {
    console.error("ingest: device_tokens lookup failed");
    return json({ ok: false, error: "Internal error." }, 500);
  }

  let matched: { id: string; user_id: string } | null = null;
  for (const row of candidates ?? []) {
    if (timingSafeEqualHex(row.token_hash as string, presentedHash)) {
      matched = { id: row.id as string, user_id: row.user_id as string };
    }
  }
  if (!matched) {
    console.log("ingest: rejected — unknown or revoked token");
    return json({ ok: false, error: "Invalid or revoked token." }, 401);
  }

  const nowIso = new Date().toISOString();
  const rows = (days as Record<string, unknown>[]).map((entry) => {
    const { day, ...data } = entry;
    return { user_id: matched!.user_id, day, source, data, updated_at: nowIso };
  });

  const { error: upsertError } = await admin
    .from("metrics")
    .upsert(rows, { onConflict: "user_id,day,source" });
  if (upsertError) {
    console.error("ingest: metrics upsert failed, rows:", rows.length);
    return json({ ok: false, error: "Could not write metrics." }, 500);
  }

  const { error: touchError } = await admin
    .from("device_tokens")
    .update({ last_used: nowIso })
    .eq("id", matched.id);
  if (touchError) {
    // Not fatal — the metrics write already succeeded.
    console.error("ingest: last_used update failed");
  }

  console.log("ingest: wrote", rows.length, "day(s), source:", source);
  return json({ ok: true, written: rows.length });
});
