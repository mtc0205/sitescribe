/**
 * Pure helpers for scripts/live-readiness.mjs — kept free of network and
 * side-effects so they can be unit-tested (tests/live-readiness.test.mjs).
 */

/**
 * The hashed asset paths an index.html references, sorted. They identify a
 * build: Vite renames them whenever the code — or the config baked into it —
 * changes, so two index.html files that name the same assets are the same build.
 */
export function hashedAssets(html) {
  const out = new Set();
  for (const m of String(html ?? "").matchAll(/["']([^"'\s]*\/assets\/[^"'\s]+\.(?:js|css))["']/g)) out.add(m[1]);
  return [...out].sort();
}

/**
 * (b) Is the page the hosting URL serves the build in `dist/`?
 * Returns one of:
 *   same            — the served index.html names the hashed assets of the local one
 *   different       — it names others: the hosted site is not this build (deploy it)
 *   not-the-app     — the served page references no hashed asset at all
 *   no-local-build  — there is no dist/index.html to compare with
 */
export function compareBundles(servedHtml, localHtml) {
  const served = hashedAssets(servedHtml);
  const local = hashedAssets(localHtml);
  if (localHtml == null) return { state: "no-local-build", served, local: [] };
  if (!served.length) return { state: "not-the-app", served, local };
  const same = served.length === local.length && served.every((a, i) => a === local[i]);
  return { state: same ? "same" : "different", served, local };
}

/** What Identity Toolkit answers when the project does not allow the sign-up. */
export const SIGNIN_NOT_ENABLED = ["CONFIGURATION_NOT_FOUND", "ADMIN_ONLY_OPERATION", "OPERATION_NOT_ALLOWED"];

/**
 * (c) What `accounts:signUp` with an empty body answered. `body` is the parsed
 * JSON ({} when it did not parse).
 *   200                  → { enabled: true }
 *   a "not enabled" code → { enabled: false, code } — which one, because they read the same
 *                         to a visitor and mean different console states
 *   anything else        → { enabled: null } — could not tell (bad key, blocked, …)
 */
export function classifyAnonymousReply(status, body) {
  if (status === 200) return { enabled: true, code: null, detail: `HTTP ${status} — signed up, so an anonymous user now exists` };
  const message = String(body?.error?.message ?? "").trim();
  const normalised = message.toUpperCase().replace(/-/g, "_");
  const code = SIGNIN_NOT_ENABLED.find((c) => normalised.includes(c)) ?? null;
  return { enabled: code ? false : null, code, detail: `HTTP ${status}${message ? ` ${message}` : ""}` };
}

/** One line, at most `max` characters, of a message that may run over several. */
export function collapse(text, max = 220) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** How much of a server message the report quotes: the whole human part of the longest
 *  one seen — the Gemini free-tier refusal, 289 characters (444 in the SDK's frame,
 *  which the script strips). */
export const DETAIL_MAX = 360;

/**
 * (d) Why a Gemini call through AI Logic did not answer, as one of
 * FREE_TIER_UNAVAILABLE / FREE_TIER_QUOTA / GENAI_CONFIG_NOT_FOUND / APP_CHECK /
 * NETWORK / OTHER.
 * `f` is the caught failure, flattened by the caller:
 *   { stage: "app-check" | "gemini", network, status?, code?, message?, details? }
 * The two that matter most read alike from the outside — a 403 — and mean
 * different things: "the Gemini API free tier is not available for this
 * project" is the account's standing with Google, anything else 403 is not.
 * A 429 that names the free-tier metric is the good news: the tier IS the
 * account's, and only today's free requests are spent.
 */
export function classifyAiFailure(f) {
  const message = String(f?.message ?? "");
  const details = typeof f?.details === "string" ? f.details : JSON.stringify(f?.details ?? "");
  const text = `${message} ${f?.code ?? ""} ${details}`;
  const status = Number(f?.status) || null;
  if (f?.network) return { outcome: "NETWORK", detail: collapse(message, DETAIL_MAX) };
  if (f?.stage === "app-check") return { outcome: "APP_CHECK", detail: collapse(message, DETAIL_MAX) };
  // What the backend answered before this project's AI Logic config existed (night of 2026-11-26),
  // and what the SDK calls it when the AI Logic API is disabled for the project.
  if (/genai config not found/i.test(text) || /api-not-enabled/i.test(String(f?.code ?? ""))) return { outcome: "GENAI_CONFIG_NOT_FOUND", detail: collapse(message, DETAIL_MAX) };
  if (status === 403 && /free tier is not available|project-unavailable|PROJECT_UNAVAILABLE/i.test(text)) return { outcome: "FREE_TIER_UNAVAILABLE", detail: collapse(message, DETAIL_MAX) };
  // The free tier is this account's, and today's free requests are spent. First seen the night of
  // 2026-11-27, when the 403 above had turned into this by 02:37. Nothing to fix — it refills by itself.
  if (status === 429 && /generate_content_free_tier_requests|exceeded your current quota/i.test(text)) return { outcome: "FREE_TIER_QUOTA", detail: collapse(message, DETAIL_MAX) };
  if ((status === 401 || status === 403) && /app[\s-]?check|attestation/i.test(text)) return { outcome: "APP_CHECK", detail: collapse(message, DETAIL_MAX) };
  if (/fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|UND_ERR|timed out|network/i.test(text)) return { outcome: "NETWORK", detail: collapse(message, DETAIL_MAX) };
  return { outcome: "OTHER", detail: collapse(message, DETAIL_MAX) };
}

/**
 * Replaces every secret with `<redacted>` before anything reaches the
 * terminal. The values never leave this closure; only strings that contain
 * none of them are printed.
 */
export function redactor(secrets) {
  const values = secrets.filter((s) => typeof s === "string" && s.length >= 8);
  return (text) => values.reduce((out, s) => out.split(s).join("<redacted>"), String(text ?? ""));
}

/**
 * The two-line verdict. `checks` is the five checks in report order, each
 * `{ id, ok, state }` with `state` a short noun phrase ("logged in", "same",
 * "FREE_TIER_UNAVAILABLE", …). `urls` carries the project-specific addresses
 * the next step names.
 */
export function verdict(checks, urls) {
  const by = Object.fromEntries(checks.map((c) => [c.id, c]));
  const green = checks.filter((c) => c.ok).length;
  const ready = checks.every((c) => c.ok);
  const next = [];
  if (!by.cli.ok) next.push("log the Firebase CLI in with your Google account: node scripts/firebase-bootstrap.mjs --login");
  if (!by.hosting.ok) next.push(`deploy first: node scripts/firebase-bootstrap.mjs --deploy-only (${urls.hosting} is not serving the app)`);
  if (!by.bundle.ok) {
    next.push(
      by.bundle.state === "no-local-build"
        ? "there is no local build to compare the hosted page with: npm run build"
        : `the hosted site is not this build (${by.bundle.state}): node scripts/firebase-bootstrap.mjs --deploy-only`,
    );
  }
  if (!by.anonymous.ok) {
    next.push(
      `you — enable anonymous sign-in (the hosted app has no projects without it; it reported ${by.anonymous.state}): ${urls.consoleAuth} → Sign-in method → Anonymous → Enable → Save`,
    );
  }
  if (!by.gemini.ok) {
    const how = by.gemini.state;
    if (how === "FREE_TIER_UNAVAILABLE") {
      next.push(`you — the Gemini API free tier is unavailable for this Google account (until then capture falls back to the rule-based structurer): verify a device at ${urls.verify}, or link billing at ${urls.billing}`);
    } else if (how === "FREE_TIER_QUOTA") {
      next.push("no user step — the Gemini free tier IS available to this account and today's free requests are spent; they refill by themselves (the message above names the metric), and no probe or rehearsal should spend a fresh refill before a recording");
    } else if (how === "GENAI_CONFIG_NOT_FOUND") {
      next.push(`you — set up the Gemini Developer API provider for this project: ${urls.consoleAiLogic} → Get started`);
    } else if (how === "APP_CHECK") {
      next.push("register the App Check debug token of the deployed bundle (App Check → Apps → ⋮ → Manage debug tokens) or set a reCAPTCHA site key, then redeploy");
    } else if (how === "NETWORK") {
      next.push("this machine could not reach Google — check the connection and run the script again");
    } else {
      next.push(`look at the Gemini error reported above (${how})`);
    }
  }
  const red = checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.state}`);
  const line1 = ready
    ? `READY — ${green}/${checks.length} checks green: the hosted app answers with this build, anonymous sign-in is enabled, Gemini answered through AI Logic.`
    : `NOT READY — ${green}/${checks.length} checks green; red: ${red.join("; ")}.`;
  const line2 = ready ? "Nothing is missing for the user. Next: smoke the hosted URL in a browser, then record." : `Next (${next.length}): ${next.join(" | ")}`;
  return { ready, lines: [line1, line2] };
}
