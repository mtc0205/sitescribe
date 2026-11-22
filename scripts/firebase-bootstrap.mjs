/**
 * One-command Firebase bootstrap for SiteScribe (run #15, 2026-11-23).
 *
 * Turns "user logs in with Google" into a ~10-minute guided flow:
 *   0. checks `firebase login:list`; `--login` opens a VISIBLE console window
 *      running `firebase login` and polls until you're authenticated
 *   1. `firebase projects:create <unique-id>`
 *   2. `firebase apps:create web` (reuses the existing web app if present)
 *   3. `firebase apps:sdkconfig web <appId>` → writes `.env` (git-ignored,
 *      preserving any App Check keys you already filled in)
 *   4. `firebase use <project>` + `firebase firestore:databases:create`
 *   5. `npm run build` + `firebase deploy` (hosting + Firestore rules/indexes
 *      + Remote Config template)
 *   6. VERIFIES what it can automatically:
 *        - anonymous sign-in enabled? POST accounts:signUp with the apiKey
 *          (200 = enabled — this is the #1 console toggle people miss)
 *        - hosting URL answers? fetch https://<project>.web.app
 *      then prints the remaining console clicks with exact navigation paths.
 *
 * Usage:
 *   node scripts/firebase-bootstrap.mjs                 # full flow
 *   node scripts/firebase-bootstrap.mjs --dry-run       # print every step, touch nothing
 *   node scripts/firebase-bootstrap.mjs --login         # also open the login window
 *   node scripts/firebase-bootstrap.mjs --deploy-only   # after pasting App Check keys:
 *                                                        # rebuild + redeploy + re-verify
 * Options: --project-id <id>  --display-name <n>  --app-name <n>  --location <loc>
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSdkConfigOutput, parseAppIdFromCreate, buildEnvFile, parseEnvFile, checkAnonymousAuth, checkHostingUrl } from "./lib/bootstrap-env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIREBASE_BIN = "C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\firebase-tools\\lib\\bin\\firebase.js";
const ENV_PATH = path.join(ROOT, ".env");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};
const DRY = args.includes("--dry-run");
const WANT_LOGIN = args.includes("--login");
const DEPLOY_ONLY = args.includes("--deploy-only");
const PROJECT_ID = opt("project-id", "sitescribe-" + Math.random().toString(36).slice(2, 6));
const DISPLAY_NAME = opt("display-name", "SiteScribe");
const APP_NAME = opt("app-name", "SiteScribe Web");
const LOCATION = opt("location", "nam5");

const log = (m) => console.log("[bootstrap] " + m);
const die = (m) => { console.error("[bootstrap] ABORT: " + m); process.exit(1); };

/** Run firebase <args…>; returns {code, out}. `fatal` aborts the script. */
function fb(cmdArgs, { fatal = true, timeoutMs = 300_000 } = {}) {
  log(`$ firebase ${cmdArgs.join(" ")}`);
  if (DRY) return { code: 0, out: "(dry-run: not executed)" };
  const r = spawnSync(process.execPath, [FIREBASE_BIN, ...cmdArgs], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0 && fatal) die(`command failed (${r.status}):\n${out.slice(-2000)}`);
  return { code: r.status ?? -1, out };
}

function npmBuild() {
  log("$ npm run build (tsc --noEmit && vite build)");
  if (DRY) return 0;
  const tsc = spawnSync(process.execPath, [path.join(ROOT, "node_modules", "typescript", "bin", "tsc"), "--noEmit"], { cwd: ROOT, encoding: "utf8", timeout: 180_000 });
  if (tsc.status !== 0) { console.error(tsc.stdout, tsc.stderr); return tsc.status ?? -1; }
  const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build"], { cwd: ROOT, encoding: "utf8", timeout: 300_000 });
  if (r.status !== 0) console.error(r.stdout, r.stderr);
  return r.status ?? -1;
}

function loggedIn() {
  const r = spawnSync(process.execPath, [FIREBASE_BIN, "login:list"], { encoding: "utf8", timeout: 30_000 });
  return /[\w.+-]+@[\w.-]+\.\w+/.test(`${r.stdout}${r.stderr}`);
}

/* ---------- step 0: login ---------- */

log("step 0: checking `firebase login:list` …");
if (DRY) {
  log("(dry-run) would check login and continue with the full flow");
} else if (!loggedIn()) {
  if (!WANT_LOGIN) {
    console.log(`
You are not logged in to the Firebase CLI. Either:
  1. run:  node scripts/firebase-bootstrap.mjs --login
     (opens a console window with \`firebase login\` — complete it there,
      this script waits and continues automatically), or
  2. run \`firebase login\` yourself in any terminal, then rerun this script.`);
    process.exit(3);
  }
  log("opening a VISIBLE console window for `firebase login` …");
  spawnSync("powershell.exe", [
    "-NoProfile", "-Command",
    "Start-Process cmd -ArgumentList '/k','firebase login' ",
  ], { encoding: "utf8", timeout: 30_000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 8 * 60_000) {
    await new Promise((r) => setTimeout(r, 4000));
    if (loggedIn()) { log("login detected — continuing."); break; }
    process.stdout.write(".");
  }
  if (!loggedIn()) die("login window timed out after 8 minutes — rerun this script once logged in.");
} else {
  log("already logged in.");
}

/* ---------- steps 1-4: project, app, .env, firestore ---------- */

let appId = null;
let sdkConfig = null;

if (DEPLOY_ONLY) {
  if (!fs.existsSync(ENV_PATH)) die("--deploy-only needs an existing .env — run the full flow first.");
  sdkConfig = parseEnvFile(fs.readFileSync(ENV_PATH, "utf8"))["VITE_FIREBASE_CONFIG"];
  sdkConfig = (() => { try { return JSON.parse(sdkConfig); } catch { return null; } })();
  if (!sdkConfig?.projectId) die(".env has no valid VITE_FIREBASE_CONFIG.");
  log(`deploy-only: project ${sdkConfig.projectId}`);
} else {
  log(`step 1: creating project ${PROJECT_ID} ("${DISPLAY_NAME}") …`);
  fb(["projects:create", PROJECT_ID, "-n", DISPLAY_NAME]);

  log("step 2: creating the web app (or reusing it) …");
  const created = fb(["apps:create", "web", APP_NAME, "--project", PROJECT_ID], { fatal: false });
  appId = parseAppIdFromCreate(created.out) ?? (DRY ? "1:000000000000:web:dryrun0000000000000" : null);
  if (!appId) {
    const listed = fb(["apps:list", "web", "--project", PROJECT_ID], { fatal: false });
    appId = parseAppIdFromCreate(listed.out);
    if (!appId) die("could not create or find the web app — check the output above.");
  }
  log(`web app id: ${appId}`);

  log("step 3: fetching SDK config → writing .env …");
  const cfg = fb(["apps:sdkconfig", "web", appId, "--project", PROJECT_ID]);
  sdkConfig = parseSdkConfigOutput(cfg.out) ?? (DRY ? { apiKey: "dry-run-key", projectId: PROJECT_ID } : null);
  if (!sdkConfig?.apiKey) die("could not parse `apps:sdkconfig` output.");
  if (!DRY) {
    const prev = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
    fs.writeFileSync(ENV_PATH, buildEnvFile(sdkConfig, prev));
    log(`wrote ${ENV_PATH} (App Check keys preserved from previous file)`);
  }

  log("step 4: firebase use + creating the Firestore database …");
  fb(["use", PROJECT_ID]);
  fb(["firestore:databases:create", "(default)", "--location", LOCATION, "--project", PROJECT_ID], { fatal: false }); // exists → non-fatal
}

/* ---------- step 5: build + deploy ---------- */

log("step 5: build + deploy (hosting, firestore rules/indexes, remote-config) …");
if (npmBuild() !== 0) die("npm run build failed.");
fb(["deploy", "--project", sdkConfig.projectId, "--only", "hosting,firestore:rules,firestore:indexes,remote-config", "--force"]);

/* ---------- step 6: verification ---------- */

const hostingUrl = `https://${sdkConfig.projectId}.web.app/`;
log("step 6: verifying …");
const anon = DRY ? { enabled: null, detail: "(dry-run)" } : await checkAnonymousAuth(sdkConfig.apiKey);
console.log(`  anonymous sign-in: ${anon.enabled === true ? "ENABLED ✓" : anon.enabled === false ? "NOT ENABLED ✗ (console click needed)" : "unknown: " + anon.detail}`);
const hosting = DRY ? { ok: null, detail: "(dry-run)" } : await checkHostingUrl(hostingUrl);
console.log(`  hosting ${hostingUrl}: ${hosting.ok === true ? "live ✓ " + hosting.detail : hosting.ok === false ? "not answering ✗ " + hosting.detail : hosting.detail}`);
const rcKey = !DRY && fs.existsSync(ENV_PATH) ? parseEnvFile(fs.readFileSync(ENV_PATH, "utf8")) : {};
const appCheckSet = Boolean(rcKey.VITE_RECAPTCHA_SITE_KEY || rcKey.VITE_APPCHECK_DEBUG_TOKEN);
console.log(`  App Check key in .env: ${appCheckSet ? "present ✓ (redeployed above)" : "absent ✗ (pick option a or b below)"}`);

console.log(`
=====================================================================
 Remaining console clicks (Firebase console → project ${sdkConfig.projectId})
=====================================================================
 1. Authentication → Sign-in method → Anonymous → Enable → Save        (~40s)
      current status: ${anon.enabled === true ? "already enabled ✓ (verified)" : "NOT enabled — do it now"}
 2. AI Logic (Firebase AI) → Get started → continue with the
    "Gemini Developer API" provider → Create/Use API key               (~40s)
    (text inference is free within usage limits; no card needed)
 3. App Check (required by AI Logic, enforced since 2026-11-02).
    Pick ONE:
      a) RECOMMENDED — real attestation for judges:
         Security → App Check → Apps → your web app → Register with
         reCAPTCHA v3 (create the site key when prompted; no billing),
         copy the SITE key into .env as VITE_RECAPTCHA_SITE_KEY=…
      b) Debug token (explicitly accepted by the hackathon rules):
         run \`npm run dev\` locally, open http://127.0.0.1:5173, copy the
         "AppCheck debug token: …" line from the browser console, register
         it (App Check → Apps → ⋮ → Manage debug tokens), paste it into
         .env as VITE_APPCHECK_DEBUG_TOKEN=…
    Then run:  node scripts/firebase-bootstrap.mjs --deploy-only
 4. Final check: open ${hostingUrl} — capture a record; the badge should
    show a real engine (not rule-based) once App Check is set up.
=====================================================================
Hosted URL: ${hostingUrl}
`);
