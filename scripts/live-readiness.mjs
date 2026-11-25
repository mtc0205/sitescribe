/**
 * Live readiness — one command, no browser, that says whether the hosted app is
 * ready to record and to submit (night of 2026-11-26).
 *
 * Reads .env and reports, printing no key and no token:
 *   (a) the Firebase CLI is logged in, and the project the app is wired to
 *   (b) the hosting URL answers, and the page it serves is the build in dist/
 *       — the hashed asset names of the served index.html against dist/index.html
 *   (c) anonymous sign-in: POST accounts:signUp with an empty body. 200 = enabled;
 *       CONFIGURATION_NOT_FOUND / ADMIN_ONLY_OPERATION / OPERATION_NOT_ALLOWED =
 *       not enabled (it says which)
 *   (d) Gemini through AI Logic with the real SDK: the App Check debug token
 *       exchanged exactly as the SDK's debug provider does, then one
 *       generateContent — OK / FREE_TIER_UNAVAILABLE / GENAI_CONFIG_NOT_FOUND /
 *       APP_CHECK / NETWORK / OTHER
 * then a two-line verdict that names the user step that is still missing.
 *
 * Exit 0 only when every check is green; 1 when something is red; 2 when there
 * is no .env to check. (c) signs up one anonymous user when it succeeds — the
 * same probe firebase-bootstrap.mjs runs. Nothing here changes the project.
 *
 * Usage: node scripts/live-readiness.mjs [--model <name>]    (default gemini-3.8-flash)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvFile } from "./lib/bootstrap-env.mjs";
import { compareBundles, classifyAnonymousReply, classifyAiFailure, collapse, redactor, verdict } from "./lib/live-readiness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");
const DIST_INDEX = path.join(ROOT, "dist", "index.html");
// Same CLI firebase-bootstrap.mjs calls; `firebase` on PATH is the fallback.
const FIREBASE_BIN = "C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\firebase-tools\\lib\\bin\\firebase.js";

const args = process.argv.slice(2);
const model = args.includes("--model") && args[args.indexOf("--model") + 1] ? args[args.indexOf("--model") + 1] : "gemini-3.8-flash";

let red = (s) => String(s ?? "");
const say = (m) => console.log("[readiness] " + red(m));
const fail = (m) => console.error("[readiness] " + red(m));

/** A failure flattened for classifyAiFailure (scripts/lib/live-readiness.mjs). */
function failure(stage, error, extra = {}) {
  const cause = error?.cause;
  const code = error?.code;
  return {
    stage,
    message: typeof error?.message === "string" ? error.message : error == null ? "" : String(error),
    // A fetch that threw (TypeError), an abort, a socket / DNS error: nothing answered.
    network: error instanceof TypeError || error?.name === "TimeoutError" || error?.name === "AbortError" || /^(ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ERR_NETWORK|UND_ERR)/.test(String(code ?? cause?.code ?? "")),
    ...extra,
  };
}

async function main() {
  // ---------- .env ----------
  if (!fs.existsSync(ENV_PATH)) {
    fail(`no .env in ${ROOT} — run node scripts/firebase-bootstrap.mjs --login first`);
    console.log("NOT READY — there is no wired project to check.");
    console.log("Next (1): wire the project (your Google login): node scripts/firebase-bootstrap.mjs --login");
    return 2;
  }
  const env = parseEnvFile(fs.readFileSync(ENV_PATH, "utf8"));
  const unquote = (v) => String(v ?? "").trim().replace(/^"|"$/g, "");
  let cfg;
  try {
    cfg = JSON.parse(env.VITE_FIREBASE_CONFIG ?? "");
  } catch {
    cfg = null;
  }
  if (!cfg?.apiKey || !cfg?.projectId || !cfg?.appId) {
    fail(".env has no valid VITE_FIREBASE_CONFIG (apiKey, projectId, appId needed)");
    return 2;
  }
  const siteKey = unquote(env.VITE_RECAPTCHA_SITE_KEY);
  const debugToken = unquote(env.VITE_APPCHECK_DEBUG_TOKEN);
  const providerKind = unquote(env.VITE_RECAPTCHA_PROVIDER).toLowerCase() === "enterprise" ? "enterprise" : "v3";

  // From here on every value that must stay out of a terminal is known, and
  // every line printed goes through `red` — including the SDKs' own console output.
  red = redactor([cfg.apiKey, env.VITE_FIREBASE_CONFIG, debugToken, siteKey]);
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = console[level].bind(console);
    console[level] = (...parts) => original(...parts.map((p) => (typeof p === "string" ? red(p) : p)));
  }

  const consoleBase = "https://console.firebase.google.com/project/" + cfg.projectId;
  const urls = {
    hosting: `https://${cfg.projectId}.web.app/`,
    consoleAuth: `${consoleBase}/authentication/providers`,
    consoleAiLogic: `${consoleBase}/ailogic`,
    verify: `https://aistudio.google.com/verify?project=${cfg.projectId}`,
    billing: "https://aistudio.google.com/billing",
  };
  const checks = [];
  const t0 = Date.now();

  // ---------- (a) CLI + project ----------
  let cli;
  const localCli = fs.existsSync(FIREBASE_BIN);
  const r = localCli
    ? spawnSync(process.execPath, [FIREBASE_BIN, "login:list"], { encoding: "utf8", timeout: 60_000 })
    : spawnSync("firebase", ["login:list"], { encoding: "utf8", timeout: 60_000, shell: true });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (localCli || r.error === undefined) cli = /[\w.+-]+@[\w.-]+\.\w+/.test(out) ? "logged in" : "not logged in";
  else cli = "CLI not found";
  checks.push({ id: "cli", ok: cli === "logged in", state: cli });
  say(`(a) Firebase CLI: ${cli} ${checks.at(-1).ok ? "✓" : "✗"}${localCli ? "" : cli === "logged in" ? " (from PATH)" : ""}`);
  say(`(a) project ${cfg.projectId} · web app ${cfg.appId} (from .env)${env.VITE_USE_EMULATOR === "1" ? " · WARNING: VITE_USE_EMULATOR=1" : ""}`);

  // ---------- (b) hosting + bundle ----------
  let servedHtml = null;
  let hosting;
  try {
    const res = await fetch(urls.hosting, { redirect: "follow", headers: { "cache-control": "no-cache", pragma: "no-cache" }, signal: AbortSignal.timeout(20_000) });
    servedHtml = await res.text();
    hosting = { ok: res.ok && /SiteScribe/i.test(servedHtml), state: `HTTP ${res.status}${res.ok && !/SiteScribe/i.test(servedHtml) ? " — not the SiteScribe page" : ""}` };
  } catch (e) {
    hosting = { ok: false, state: `no answer (${collapse(e?.cause?.code ?? e?.message ?? e, 80)})` };
  }
  checks.push({ id: "hosting", ok: hosting.ok, state: hosting.state });
  say(`(b) hosting ${urls.hosting}: ${hosting.state} ${hosting.ok ? "✓" : "✗"}`);

  const bundle = compareBundles(servedHtml, fs.existsSync(DIST_INDEX) ? fs.readFileSync(DIST_INDEX, "utf8") : null);
  const bundleOk = bundle.state === "same";
  checks.push({ id: "bundle", ok: bundleOk, state: bundle.state });
  say(
    `(b) served bundle vs dist/index.html: ${
      bundle.state === "same" ? `same build ✓ (${bundle.served.join(", ")})` :
      bundle.state === "different" ? `DIFFERENT ✗ — served ${bundle.served.join(", ") || "(no hashed asset)"} · local ${bundle.local.join(", ") || "(none)"}` :
      bundle.state === "not-the-app" ? "the served page references no hashed asset ✗" :
      "no local build to compare with ✗ (dist/index.html missing)"
    }`,
  );

  // ---------- (c) anonymous sign-in ----------
  let anon = { enabled: null, code: null, detail: "not probed" };
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(20_000),
    });
    anon = classifyAnonymousReply(res.status, await res.json().catch(() => ({})));
  } catch (e) {
    anon = { enabled: null, code: null, detail: `no answer: ${collapse(e?.message ?? e)}` };
  }
  checks.push({
    id: "anonymous",
    ok: anon.enabled === true,
    state: anon.enabled === true ? "enabled" : anon.enabled === false ? `not enabled (${anon.code})` : "could not tell",
  });
  say(`(c) anonymous sign-in: ${anon.enabled === true ? "ENABLED ✓" : anon.enabled === false ? `NOT ENABLED ✗ ${anon.code}` : "UNKNOWN ✗"} — ${anon.detail}`);

  // ---------- (d) Gemini through AI Logic ----------
  const bundleAttestation = siteKey ? `reCAPTCHA ${providerKind}` : "registered debug token";
  let gemini = { ok: false, state: "NOT_PROBED", detail: `the deployed bundle attests with ${bundleAttestation}, and this script can only exchange a debug token — open the hosting URL in a browser instead` };
  let appCheckLine = `App Check: not attempted`;
  if (debugToken) {
    const { initializeApp } = await import("firebase/app");
    const { initializeAppCheck, CustomProvider } = await import("firebase/app-check");
    const { getAI, GoogleAIBackend, getGenerativeModel } = await import("firebase/ai");
    let appCheckFailure = null;
    // Exactly the request the App Check SDK's debug provider sends.
    const exchange = async () => {
      const t = Date.now();
      let res;
      try {
        res = await fetch(
          `https://firebaseappcheck.googleapis.com/v1beta/projects/${cfg.projectId}/apps/${cfg.appId}:exchangeDebugToken?key=${cfg.apiKey}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ debug_token: debugToken }), signal: AbortSignal.timeout(20_000) },
        );
      } catch (e) {
        throw failure("app-check", e);
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const f = failure("app-check", null, { status: res.status, message: body.error?.message ?? `HTTP ${res.status}`, details: body.error?.details });
        appCheckFailure = f;
        throw new Error(f.message);
      }
      appCheckLine = `App Check debug token exchanged ✓ in ${Date.now() - t} ms (TTL ${body.ttl ?? "?"})`;
      return { token: body.token, expireTimeMillis: Date.now() + 45 * 60 * 1000 };
    };
    const app = initializeApp(cfg);
    initializeAppCheck(app, { provider: new CustomProvider({ getToken: exchange }), isTokenAutoRefreshEnabled: false });
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    const m = getGenerativeModel(ai, { model });
    const t = Date.now();
    try {
      const res = await Promise.race([
        m.generateContent("Reply with the single word OK."),
        new Promise((_, reject) => setTimeout(() => { const e = new Error("no answer within 45 s"); e.name = "TimeoutError"; reject(e); }, 45_000)),
      ]);
      const out = res.response;
      gemini = { ok: true, state: "OK", status: null, detail: `answered in ${Date.now() - t} ms · text ${JSON.stringify(collapse(out.text, 40))} · inferenceSource ${out.inferenceSource ?? "n/a"} · modelVersion ${out.modelVersion ?? "n/a"}` };
    } catch (e) {
      // The AI Logic request fails with the App Check error when the exchange did; report that one.
      const f = appCheckFailure ?? failure("gemini", e, { status: e?.customErrorData?.status, code: e?.code, details: e?.customErrorData?.errorDetails });
      // What a person reads: the server's own words. The SDK frames them as
      // "AI: Error fetching from <url>: … (AI/fetch-error)" and repeats the code in `code`.
      const words = String(f.message).replace(/^AI: Error fetching from \S+: /i, "").replace(/ \(AI\/[\w-]+\)$/i, "");
      const c = classifyAiFailure({ ...f, message: words });
      gemini = { ok: false, status: f.status ?? null, state: c.outcome, detail: c.detail };
      if (appCheckFailure) appCheckLine = "App Check exchange REFUSED ✗";
    }
  }
  checks.push({ id: "gemini", ok: gemini.ok, state: gemini.state });
  say(`(d) Gemini via AI Logic (${model}; the deployed bundle attests with: ${bundleAttestation}) — ${appCheckLine}`);
  say(`(d) outcome: ${gemini.state} ${gemini.ok ? "✓" : "✗"}${gemini.status ? ` (HTTP ${gemini.status})` : ""} — ${gemini.detail}`);

  // ---------- verdict ----------
  const v = verdict(checks, urls);
  for (const line of v.lines) console.log(red(line));
  console.log(`[readiness] took ${((Date.now() - t0) / 1000).toFixed(1)} s · exit ${v.ready ? 0 : 1}`);
  return v.ready ? 0 : 1;
}

let code = 2;
try {
  code = await main();
} catch (e) {
  fail(`ABORT: ${collapse(e?.stack ?? e?.message ?? e, 400)}`);
  code = 2;
}
process.exit(code); // the SDKs keep timers alive; everything has been printed
