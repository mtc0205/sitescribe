/**
 * Pure helpers for scripts/firebase-bootstrap.mjs — kept free of any
 * side-effects so they can be unit-tested (tests/bootstrap-env.test.mjs).
 */
import { classifyAnonymousReply } from "./live-readiness.mjs";

/**
 * Extract the web SDK config object from `firebase apps:sdkconfig` output.
 * The CLI prints the config wrapped in different formats across versions
 * (`var firebaseConfig = {...};`, bare JSON, or JSON-in-array); we just take
 * the first balanced `{...}` block and parse it.
 */
export function parseSdkConfigOutput(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') inStr = !inStr;
    if (inStr) continue;
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Keys preserved from an existing .env when (re)writing it. */
export const PRESERVED_KEYS = ["VITE_RECAPTCHA_SITE_KEY", "VITE_RECAPTCHA_PROVIDER", "VITE_APPCHECK_DEBUG_TOKEN"];

/**
 * Read KEY=VALUE pairs from an .env file (comments with # ignored).
 */
export function parseEnvFile(content) {
  const out = {};
  for (const line of String(content ?? "").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Build the .env content: the Firebase web config on one line plus the
 * emulator flag, preserving any App Check keys the user already filled in.
 */
export function buildEnvFile(config, existingEnvContent = "") {
  if (!config || typeof config !== "object" || !config.apiKey || !config.projectId) {
    throw new Error("buildEnvFile: config must include at least apiKey and projectId");
  }
  const existing = parseEnvFile(existingEnvContent);
  const oneLine = JSON.stringify(config);
  if (oneLine.includes("\n")) throw new Error("config must serialize to one line");
  const lines = [
    "# Written by scripts/firebase-bootstrap.mjs — do not commit (.env is git-ignored).",
    `VITE_FIREBASE_CONFIG=${oneLine}`,
    "",
    "# Set to 1 to point Auth/Firestore at the local emulator suite.",
    `VITE_USE_EMULATOR=${existing.VITE_USE_EMULATOR === "1" ? "1" : "0"}`,
    "",
    "# ---- App Check (required by Firebase AI Logic) — fill ONE, then rerun",
    "#      `node scripts/firebase-bootstrap.mjs --deploy-only` ----",
    `VITE_RECAPTCHA_SITE_KEY=${existing.VITE_RECAPTCHA_SITE_KEY ?? ""}`,
    "# (empty = reCAPTCHA v3; set to enterprise if the console registered reCAPTCHA Enterprise)",
    `VITE_RECAPTCHA_PROVIDER=${existing.VITE_RECAPTCHA_PROVIDER ?? ""}`,
    `VITE_APPCHECK_DEBUG_TOKEN=${existing.VITE_APPCHECK_DEBUG_TOKEN ?? ""}`,
    "",
  ];
  return lines.join("\n");
}

/** Extract the web app id from `firebase apps:create` output. */
export function parseAppIdFromCreate(text) {
  const m = /1:\d+:web:[0-9A-Za-z]+/.exec(text);
  return m ? m[0] : null;
}

/**
 * Check whether anonymous sign-in is enabled for a project, using the public
 * Identity Toolkit REST endpoint (no admin credentials needed):
 * 200                   → enabled   (an anonymous user was actually created)
 * a "not enabled" code → disabled, and `code` says which (CONFIGURATION_NOT_FOUND,
 *                        ADMIN_ONLY_OPERATION, OPERATION_NOT_ALLOWED — the decision is
 *                        classifyAnonymousReply's, shared with live-readiness.mjs)
 * anything else         → could not tell (a bad key is not "disabled"); asked once more
 */
export function checkAnonymousAuth(apiKey, options) {
  return settleAuthProbe(() => askAnonymousAuth(apiKey), options);
}

/** What `firebase deploy --only` is given. `auth` only when firebase.json declares
 *  Authentication providers — that is how the anonymous provider is switched on without
 *  the console, as Firebase documents: "auth": { "providers": { "anonymous": true } }. */
export function deployTargets(firebaseConfig) {
  const targets = ["hosting", "firestore:rules", "firestore:indexes", "remote-config"];
  if (Object.keys(firebaseConfig?.auth?.providers ?? {}).length) targets.push("auth");
  return targets;
}

/** One Identity Toolkit round trip. Never throws: what it could not read is "could not tell". */
async function askAnonymousAuth(apiKey) {
  try {
    const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    });
    const body = await r.json().catch(() => ({}));
    const verdict = classifyAnonymousReply(r.status, body);
    if (verdict.enabled === true) return { enabled: true, code: null, detail: `signed up uid=${body.localId}` };
    return { enabled: verdict.enabled, code: verdict.code, detail: verdict.detail };
  } catch (e) {
    return { enabled: null, code: null, detail: String(e) };
  }
}

/**
 * Whether anonymous sign-in is enabled, asked for once more when the first answer told
 * neither way (a timeout, a 5xx, an unreadable body — "unknown: TimeoutError" is all the
 * bootstrap printed once on 2026-11-26, right after the provider had been switched on).
 * A settled answer — enabled, or a "not enabled" code — is final. `sleep` is a parameter
 * so the decision is unit-tested without waiting.
 */
export async function settleAuthProbe(ask, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), delayMs = 1_500 } = {}) {
  const first = await ask();
  if (first.enabled !== null) return first;
  await sleep(delayMs);
  const second = await ask();
  return second.enabled === null ? { ...second, detail: `asked twice: ${second.detail}` } : second;
}

/** Check the hosting URL answers (200 on the SPA shell). */
export async function checkHostingUrl(url) {
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    return { ok: r.ok, detail: `HTTP ${r.status} ${r.url}` };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}
