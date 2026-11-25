/**
 * Unit tests for scripts/lib/live-readiness.mjs (pure helpers only — nothing here
 * touches the network, the CLI or the user's Firebase account).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashedAssets, compareBundles, classifyAnonymousReply, classifyAiFailure, collapse, redactor, verdict } from "../scripts/lib/live-readiness.mjs";

// ---- (b) which build a page is ----

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <script type="module" crossorigin src="/assets/index-AM4OATx5.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-CEjoi1k-.css">
  </head>
</html>`;

test("hashedAssets: the hashed js and css an index.html references, sorted — nothing else", () => {
  assert.deepEqual(hashedAssets(INDEX), ["/assets/index-AM4OATx5.js", "/assets/index-CEjoi1k-.css"]);
  assert.deepEqual(hashedAssets('<script src="/assets/a.js"></script><script src="/assets/b.js"></script>'), ["/assets/a.js", "/assets/b.js"]);
  assert.deepEqual(hashedAssets(""), []);
  assert.deepEqual(hashedAssets(null), []);
});

test("compareBundles: the same asset names are the same build", () => {
  const same = compareBundles(INDEX, INDEX.replace(/\s+/g, " ")); // whitespace may differ, the build is the same
  assert.equal(same.state, "same");
  assert.deepEqual(same.served, same.local);
});

test("compareBundles: a different hash is a different build; a page without hashed assets is not the app", () => {
  const other = compareBundles(INDEX, INDEX.replace("index-AM4OATx5.js", "index-ZZZZZZZZ.js"));
  assert.equal(other.state, "different");
  assert.deepEqual(other.local, ["/assets/index-CEjoi1k-.css", "/assets/index-ZZZZZZZZ.js"]);
  assert.equal(compareBundles("<html><body>Maintenance</body></html>", INDEX).state, "not-the-app");
  assert.equal(compareBundles(INDEX, null).state, "no-local-build");
});

// ---- (c) anonymous sign-in ----

test("classifyAnonymousReply: 200 means enabled", () => {
  const r = classifyAnonymousReply(200, { idToken: "secret", localId: "uid123" });
  assert.deepEqual([r.enabled, r.code], [true, null]);
  assert.doesNotMatch(r.detail, /secret|uid123/); // the detail names no token, no uid
});

test("classifyAnonymousReply: each 'not enabled' answer is told apart, and the server's spelling is kept", () => {
  for (const code of ["CONFIGURATION_NOT_FOUND", "ADMIN_ONLY_OPERATION", "OPERATION_NOT_ALLOWED"]) {
    const r = classifyAnonymousReply(400, { error: { code: 400, message: code } });
    assert.deepEqual([r.enabled, r.code], [false, code]);
    assert.equal(r.detail, `HTTP 400 ${code}`);
  }
  // The SDK's spelling of the third one (hyphenated, lower case) reads the same.
  assert.equal(classifyAnonymousReply(400, { error: { message: "operation-not-allowed" } }).code, "OPERATION_NOT_ALLOWED");
});

test("classifyAnonymousReply: anything else is 'could not tell', never 'not enabled'", () => {
  const badKey = classifyAnonymousReply(400, { error: { message: "API_KEY_SERVICE_BLOCKED" } });
  assert.deepEqual([badKey.enabled, badKey.code], [null, null]);
  assert.equal(classifyAnonymousReply(500, {}).enabled, null);
  assert.equal(classifyAnonymousReply(403, null).enabled, null);
  assert.equal(classifyAnonymousReply(429, { error: { message: "QUOTA_EXCEEDED" } }).code, null);
});

// ---- (d) why Gemini did not answer ----

// The refusal the project answered on 2026-11-26, as the AI Logic SDK delivered it.
const FRAME = "AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/sitescribe-5998a/models/gemini-3.8-flash:generateContent: ";
const CODE = " (AI/fetch-error)";
const FREE_TIER = "[403 Forbidden] The Gemini API free tier is not available for this project. To use the Gemini API, please set up billing to upgrade to the paid tier at https://aistudio.google.com/billing. For more information, see https://ai.google.dev/gemini-api/docs/troubleshooting#project-unavailable.";
const sdkFailure = (words, status, code = "fetch-error") => ({ stage: "gemini", status, code, message: FRAME + words + CODE, details: undefined });

test("classifyAiFailure: the free-tier refusal is FREE_TIER_UNAVAILABLE, framed by the SDK or not", () => {
  assert.equal(classifyAiFailure(sdkFailure(FREE_TIER, 403)).outcome, "FREE_TIER_UNAVAILABLE");
  // As the script hands it over — the server's words without the frame — it is quoted whole.
  assert.deepEqual(classifyAiFailure({ stage: "gemini", status: 403, code: "fetch-error", message: FREE_TIER }), { outcome: "FREE_TIER_UNAVAILABLE", detail: FREE_TIER });
  assert.ok(FREE_TIER.length <= 360, `the server's words are ${FREE_TIER.length} characters — within DETAIL_MAX, so nothing is cut`);
});

test("classifyAiFailure: another 403 is not the free-tier refusal", () => {
  assert.equal(classifyAiFailure(sdkFailure("[403 Forbidden] The caller does not have permission", 403)).outcome, "OTHER");
  assert.equal(classifyAiFailure(sdkFailure("[403 Forbidden] Permission denied on resource", 403)).outcome, "OTHER");
});

test("classifyAiFailure: the missing AI Logic config, by the backend's words or by the SDK's own code", () => {
  assert.equal(classifyAiFailure(sdkFailure("[404 Not Found] Firebase AI Logic genai config not found.", 404)).outcome, "GENAI_CONFIG_NOT_FOUND");
  assert.equal(classifyAiFailure(sdkFailure("The Firebase AI SDK requires the Firebase AI API to be enabled", 403, "api-not-enabled")).outcome, "GENAI_CONFIG_NOT_FOUND");
});

test("classifyAiFailure: App Check — a refused token exchange, or a refusal that names it", () => {
  assert.equal(classifyAiFailure({ stage: "app-check", status: 400, message: "App attestation failed" }).outcome, "APP_CHECK");
  assert.equal(classifyAiFailure({ stage: "app-check", status: 403, message: "Caller permission denied" }).outcome, "APP_CHECK");
  const named = classifyAiFailure({ stage: "gemini", status: 401, code: "error", message: "Error fetching from https://x: App Check token invalid", details: [{ reason: "ATTESTATION_FAILED" }] });
  assert.equal(named.outcome, "APP_CHECK");
});

test("classifyAiFailure: nothing answered — a thrown fetch, or the network's own words", () => {
  assert.equal(classifyAiFailure({ stage: "gemini", network: true, message: "fetch failed" }).outcome, "NETWORK");
  assert.equal(classifyAiFailure({ stage: "app-check", network: true, message: "fetch failed" }).outcome, "NETWORK"); // even at the exchange
  assert.equal(classifyAiFailure({ stage: "gemini", code: "error", message: "Error fetching from https://x: getaddrinfo ENOTFOUND x" }).outcome, "NETWORK");
});

test("classifyAiFailure: the rest is OTHER, and the message comes along as given", () => {
  // The script hands the server's words over without the SDK's frame ("AI: Error fetching from <url>: …").
  const words = "[400 Bad Request] API key not valid. Please pass a valid API key.";
  assert.deepEqual(classifyAiFailure({ stage: "gemini", status: 400, code: "fetch-error", message: words }), { outcome: "OTHER", detail: words });
  assert.equal(classifyAiFailure(sdkFailure("[429 Too Many Requests] Resource exhausted", 429)).outcome, "OTHER");
  assert.equal(classifyAiFailure(undefined).outcome, "OTHER");
});

// ---- printing safely ----

test("collapse: one line, cut with an ellipsis", () => {
  assert.equal(collapse("  a\n  b   c  "), "a b c");
  assert.equal(collapse("abcdefgh", 5), "abcd…");
  assert.equal(collapse("abcd", 5), "abcd");
  assert.equal(collapse(null), "");
});

test("redactor: every secret disappears from whatever is printed; short values are not secrets", () => {
  const red = redactor(["AIzaSyA-very-long-api-key-000000000", "11111111-2222-3333-4444-555555555555", "short"]);
  assert.equal(red(`GET /x?key=AIzaSyA-very-long-api-key-000000000 token=11111111-2222-3333-4444-555555555555 short`), "GET /x?key=<redacted> token=<redacted> short");
  assert.equal(red(undefined), "");
  assert.equal(red(42), "42");
  assert.equal(red("nothing to redact"), "nothing to redact");
});

// ---- the two-line verdict ----

const URLS = {
  hosting: "https://p-1234.web.app/",
  consoleAuth: "https://console.firebase.google.com/project/p-1234/authentication/providers",
  consoleAiLogic: "https://console.firebase.google.com/project/p-1234/ailogic",
  verify: "https://aistudio.google.com/verify?project=p-1234",
  billing: "https://aistudio.google.com/billing",
};
const CHECKS = {
  cli: { id: "cli", ok: true, state: "logged in" },
  hosting: { id: "hosting", ok: true, state: "HTTP 200" },
  bundle: { id: "bundle", ok: true, state: "same" },
  anonymous: { id: "anonymous", ok: true, state: "enabled" },
  gemini: { id: "gemini", ok: true, state: "OK" },
};
const withStates = (...changes) => Object.values({ ...CHECKS, ...Object.fromEntries(changes.map(([id, ok, state]) => [id, { id, ok, state }])) });

test("verdict: all green is READY, in two lines, with no user step left", () => {
  const v = verdict(withStates(), URLS);
  assert.equal(v.ready, true);
  assert.equal(v.lines.length, 2);
  assert.match(v.lines[0], /^READY — 5\/5 checks green/);
  assert.doesNotMatch(v.lines[1], /you —/);
});

test("verdict: the state of 2026-11-26 names both user steps with their addresses", () => {
  const v = verdict(withStates(["anonymous", false, "not enabled (CONFIGURATION_NOT_FOUND)"], ["gemini", false, "FREE_TIER_UNAVAILABLE"]), URLS);
  assert.equal(v.ready, false);
  assert.equal(v.lines.length, 2);
  assert.match(v.lines[0], /^NOT READY — 3\/5 checks green; red: anonymous: not enabled \(CONFIGURATION_NOT_FOUND\); gemini: FREE_TIER_UNAVAILABLE\.$/);
  assert.match(v.lines[1], /^Next \(2\): /);
  assert.match(v.lines[1], /you — enable anonymous sign-in .*: https:\/\/console\.firebase\.google\.com\/project\/p-1234\/authentication\/providers → Sign-in method → Anonymous → Enable → Save/);
  assert.match(v.lines[1], /you — the Gemini API free tier is unavailable for this Google account .*: verify a device at https:\/\/aistudio\.google\.com\/verify\?project=p-1234, or link billing at https:\/\/aistudio\.google\.com\/billing/);
});

test("verdict: each Gemini outcome names its own next step", () => {
  const line2 = (state) => verdict(withStates(["gemini", false, state]), URLS).lines[1];
  assert.match(line2("GENAI_CONFIG_NOT_FOUND"), /you — set up the Gemini Developer API provider .*: https:\/\/console\.firebase\.google\.com\/project\/p-1234\/ailogic → Get started/);
  assert.match(line2("APP_CHECK"), /register the App Check debug token of the deployed bundle/);
  assert.match(line2("NETWORK"), /this machine could not reach Google/);
  assert.match(line2("OTHER"), /look at the Gemini error reported above \(OTHER\)/);
  assert.doesNotMatch(line2("OTHER"), /free tier/); // never the free-tier advice for an error that is not it
});

test("verdict: an unlogged CLI, a dead hosting URL and a build that is not deployed are shift steps, not user steps", () => {
  assert.match(verdict(withStates(["cli", false, "not logged in"]), URLS).lines[1], /log the Firebase CLI in .*firebase-bootstrap\.mjs --login/);
  assert.match(verdict(withStates(["hosting", false, "no answer (ECONNREFUSED)"]), URLS).lines[1], /deploy first: node scripts\/firebase-bootstrap\.mjs --deploy-only \(https:\/\/p-1234\.web\.app\/ is not serving the app\)/);
  assert.match(verdict(withStates(["bundle", false, "different"]), URLS).lines[1], /the hosted site is not this build \(different\): node scripts\/firebase-bootstrap\.mjs --deploy-only/);
  assert.match(verdict(withStates(["bundle", false, "no-local-build"]), URLS).lines[1], /there is no local build to compare the hosted page with: npm run build/);
  assert.equal(verdict(withStates(["bundle", false, "no-local-build"]), URLS).ready, false); // not green without the comparison
});
