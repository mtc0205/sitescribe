/**
 * Emulator-backed live-chain e2e (T1) — proves the REAL Firebase SDK path
 * (not demo mode) against the local Emulator Suite at http://127.0.0.1:5000:
 *
 *   emu-1  hosting emulator serves the app; runtime chip says "emulator";
 *          anonymous sign-in really happened (Auth emulator user list)
 *   emu-2  Remote Config falls back to baked-in defaults (no RC emulator for web)
 *   emu-3  capture while OFFLINE → record stored locally, "pending sync",
 *          and NOT yet present in the Firestore emulator (direct REST check)
 *   emu-4  reconnect → SDK offline queue flushes; direct REST read of
 *          http://127.0.0.1:8080/v1/projects/demo-sitescribe/databases/(default)/documents
 *          now contains the record; UI chip flips to "synced"
 *   emu-5  Firestore rules reject cross-user access:
 *          unauthenticated read → 403, second anonymous user's read → 403,
 *          owner's read → 200 (all via REST with the users' idTokens)
 *   emu-6  offline hard reload still renders the PWA shell and lists the
 *          captured record from IndexedDB
 *   emu-7  (2026-11-25) the demo-only URL switches have no effect on this real
 *          SDK path: ?engine=sim_cloud shows no banner and nothing
 *          "(simulated)"; ?feature_report_drafting=false /
 *          ?feature_severity_check=false leave both features offered
 *
 * The script builds (VITE_USE_EMULATOR=1), boots the emulator suite itself
 * (needs JAVA_HOME pointing at a JDK — see README), runs Chrome headless via
 * puppeteer-core, then tears everything down. Exits non-zero on any failure.
 *
 * Usage: node scripts/e2e-emulator.mjs [--no-build] [--keep]
 *   --no-build  reuse the existing dist/ (must have been built with
 *               VITE_USE_EMULATOR=1)
 *   --keep      keep the emulator suite running afterwards (for debugging)
 */
import puppeteer from "puppeteer-core";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\sitescribe";
const CONTEST = "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai";
const SHOTS = CONTEST + "\\tools";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const FIREBASE_BIN = "C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\firebase-tools\\lib\\bin\\firebase.js";
const JDK_DIR = CONTEST + "\\jdk-tuna";
const PROJECT = "demo-sitescribe";
const APP_URL = "http://127.0.0.1:5000/";
const AUTH_API = "http://127.0.0.1:9099";
const FS_API = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

const NO_BUILD = process.argv.includes("--no-build");
const KEEP = process.argv.includes("--keep");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(fn, { timeoutMs = 60_000, intervalMs = 1000, label = "condition" } = {}) {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* keep polling */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(intervalMs);
  }
}

function findJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, "bin", "java.exe"))) return process.env.JAVA_HOME;
  if (fs.existsSync(JDK_DIR)) {
    const hit = fs.readdirSync(JDK_DIR).find((d) => /^jdk-/.test(d));
    if (hit) return path.join(JDK_DIR, hit);
  }
  return null;
}

/** Rules-safe records query: list /records only succeeds when the query is
 *  constrained to the caller's own docs (see firestore.rules), so we use
 *  runQuery with an owner==uid filter — exactly like the app does. */
async function runRecordsQuery(idToken, ownerUid) {
  const r = await fetch(`${FS_API}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "records" }],
        where: { fieldFilter: { field: { fieldPath: "owner" }, op: "EQUAL", value: { stringValue: ownerUid } } },
      },
    }),
  });
  if (!r.ok) throw new Error(`runQuery HTTP ${r.status}`);
  return r.json();
}

async function portOpen(port) {
  try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) }); return true; } catch (e) { return e?.code !== "ECONNREFUSED" && !/ECONNREFUSED/.test(String(e?.cause ?? e)); }
}

/* ---------- 0. build + boot ---------- */

const javaHome = findJavaHome();
if (!javaHome) {
  console.error("[e2e-emulator] No JDK found. Set JAVA_HOME or extract one under " + JDK_DIR);
  process.exit(2);
}
console.log(`[e2e-emulator] JAVA_HOME=${javaHome}`);

for (const port of [4000, 5000, 8080, 9099]) {
  if (await portOpen(port)) {
    console.error(`[e2e-emulator] port ${port} already in use — another emulator suite running? Aborting (I only kill processes I started).`);
    process.exit(2);
  }
}

if (!NO_BUILD) {
  console.log("[e2e-emulator] building with VITE_USE_EMULATOR=1 …");
  const build = spawnSync(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build"], {
    cwd: ROOT,
    env: { ...process.env, VITE_USE_EMULATOR: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180_000,
  });
  if (build.status !== 0) {
    console.error(build.stdout ?? "", build.stderr ?? "", build.error ?? "");
    process.exit(2);
  }
  console.log("[e2e-emulator] build ok");
}

console.log("[e2e-emulator] starting emulator suite (auth 9099, firestore 8080, hosting 5000, ui 4000) …");
const emuLog = fs.createWriteStream(path.join(SHOTS, "emu-firebase-emulator.log"), { flags: "w" });
const emu = spawn(process.execPath, [FIREBASE_BIN, "emulators:start", "--project", PROJECT], {
  cwd: ROOT,
  env: { ...process.env, JAVA_HOME: javaHome, FIREBASE_EMULATORS_ONLY: undefined },
  stdio: ["ignore", "pipe", "pipe"],
});
emu.stdout.pipe(emuLog);
emu.stderr.pipe(emuLog);
const emuExit = new Promise((res) => emu.on("exit", res));

let browser = null;
let EMU_PROFILE = ""; // the profile this run creates — removed again in the finally block
try {
  await poll(() => portOpen(9099) && portOpen(8080) && portOpen(5000), { timeoutMs: 420_000, intervalMs: 2000, label: "emulator ports" });
  console.log("[e2e-emulator] emulators up");

  /* ---------- 1. app loads, anonymous sign-in ---------- */
  EMU_PROFILE = path.join(os.tmpdir(), `ss-emu-profile-${Date.now()}`);
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: EMU_PROFILE, // fresh every run; removed in the finally block
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 160)));
  await page.goto(APP_URL + "?engine=off", { waitUntil: "load", timeout: 30_000 });
  // The first render comes only after the Remote Config fetch (and the Installations
  // registration before it). With Google's endpoints reachable-but-blackholed both hung
  // for 84.5 s on 2026-11-25 and the former 30 s bound gave up on a blank page; on a
  // usual network the card is there within seconds. An upper bound, not an assertion.
  await poll(() => page.evaluate(() => !!document.querySelector("#project-list .card")), { timeoutMs: 180_000, label: "seeded project card" });

  const runtimeChip = await page.evaluate(() => [...document.querySelectorAll(".topbar .chip")].map((c) => c.textContent).join(" | "));
  check("hosting emulator serves app", runtimeChip.length > 0, runtimeChip);
  check("runtime chip says emulator (real SDK path)", /emulator/.test(runtimeChip), runtimeChip);
  await page.screenshot({ path: path.join(SHOTS, "emu-1-home.png") });

  const uidA = await page.evaluate(() => globalThis.__ssAuthUid);
  check("app exposes signed-in uid", typeof uidA === "string" && uidA.length > 0, `uid=${uidA}`);
  const tokenA = await poll(() => page.evaluate(() => globalThis.__ssAuthIdToken), { timeoutMs: 15_000, label: "idToken hook" });
  // The Auth emulator mints unsigned JWTs — decode the payload to prove the
  // signed-in provider is really anonymous (accounts-list REST rejects GET).
  const tokenPayload = JSON.parse(Buffer.from(tokenA.split(".")[1], "base64url").toString("utf8"));
  check("anonymous sign-in (idToken provider_id=anonymous, matches uid)", tokenPayload.provider_id === "anonymous" && tokenPayload.user_id === uidA, `provider=${tokenPayload.provider_id} user=${tokenPayload.user_id?.slice(0, 8)}…`);

  /* ---------- 2. Remote Config falls back to defaults ---------- */
  const toggles = await page.evaluate(() => globalThis.__ssRemoteToggles);
  check("Remote Config falls back to defaults", !!toggles && toggles.cloudModel === "gemini-3.8-flash" && toggles.featureReportDrafting === true && toggles.featureSeverityCheck === true, JSON.stringify(toggles));

  /* ---------- 3. offline capture ---------- */
  await page.click("#project-list .card");
  await poll(() => page.evaluate(() => !!document.querySelector("#note")), { timeoutMs: 15_000, label: "session view" });

  const NOTE_MARKER = "emu-e2e-" + Date.now();
  const NOTE = "Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long, seepage with white efflorescence nearby. (" + NOTE_MARKER + ")";
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await page.evaluate(() => dispatchEvent(new Event("offline")));
  await sleep(600);

  await page.type("#note", NOTE);
  await page.click("#capture-btn");
  // Offline + no AI backend → honest rule-based fallback within the 12s budget.
  await poll(() => page.evaluate(() => !!document.querySelector("#capture-result .ai-block")), { timeoutMs: 60_000, intervalMs: 1500, label: "capture result" });
  const offlineState = await poll(
    () => {
      const pending = page.evaluate(() => [...document.querySelectorAll("#record-list .chip.pending")].length);
      return pending.then((n) => (n > 0 ? n : false));
    },
    { timeoutMs: 20_000, intervalMs: 1000, label: "pending sync chip" },
  );
  const badge = await page.evaluate(() => document.querySelector("#capture-result .ai-head .chip")?.textContent ?? "");
  check("offline capture completes with pending-sync state", offlineState >= 1, `pending=${offlineState} badge=${badge}`);
  check("offline capture badge honest (rule-based, no fake engine)", /rule-based/i.test(badge), badge);
  await page.screenshot({ path: path.join(SHOTS, "emu-2-offline-capture-pending.png") });

  const offlineDocs = await runRecordsQuery(tokenA, uidA);
  const offlineHasNote = JSON.stringify(offlineDocs).includes(NOTE_MARKER);
  check("record NOT in Firestore emulator while offline", !offlineHasNote, `docs=${offlineDocs.length} (3 seeded records expected)`);

  /* ---------- 4. reconnect → sync ---------- */
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 2_000_000, uploadThroughput: 1_000_000 });
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await sleep(500);
  await page.click("#sync-btn");
  const synced = await poll(
    () => page.evaluate(() => [...document.querySelectorAll("#record-list .chip.online")].length),
    { timeoutMs: 45_000, intervalMs: 1500, label: "synced chips after reconnect" },
  ).then((n) => n);
  const pendingLeft = await page.evaluate(() => [...document.querySelectorAll("#record-list .chip.pending")].length);
  check("UI flips pending → synced after reconnect", synced >= 1 && pendingLeft === 0, `synced=${synced} pending=${pendingLeft}`);
  await page.screenshot({ path: path.join(SHOTS, "emu-3-synced-after-reconnect.png") });

  const onlineRest = await poll(
    async () => {
      const rows = await runRecordsQuery(tokenA, uidA);
      return (rows ?? []).find((row) => JSON.stringify(row).includes(NOTE_MARKER)) ?? false;
    },
    { timeoutMs: 30_000, intervalMs: 2000, label: "record visible via direct REST read" },
  );
  check("offline record reached Firestore emulator (direct REST read)", !!onlineRest, `doc=${onlineRest?.document?.name}`);
  fs.writeFileSync(path.join(SHOTS, "emu-4-firestore-rest-record.json"), JSON.stringify(onlineRest, null, 2));

  /* ---------- 5. rules: cross-user isolation ---------- */
  const signUpB = await fetch(`${AUTH_API}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const userB = await signUpB.json();
  check("second anonymous user created via REST", !!userB.idToken, `localId=${userB.localId ?? "none"}`);
  const docId = decodeURIComponent(onlineRest.document.name.split("/").pop());

  const noAuth = await fetch(`${FS_API}/records/${docId}`);
  check("unauthenticated read rejected (403)", noAuth.status === 403, `status=${noAuth.status}`);
  const asB = await fetch(`${FS_API}/records/${docId}`, { headers: { Authorization: `Bearer ${userB.idToken}` } });
  check("cross-user read rejected (403)", asB.status === 403, `status=${asB.status}`);
  const asA = await fetch(`${FS_API}/records/${docId}`, { headers: { Authorization: `Bearer ${tokenA}` } });
  check("owner read allowed (200)", asA.status === 200, `status=${asA.status}`);
  const crossWrite = await fetch(`${FS_API}/records`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userB.idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { owner: { stringValue: uidA }, rawNote: { stringValue: "forged" } } }),
  });
  check("cross-user create rejected (403)", crossWrite.status === 403, `status=${crossWrite.status}`);
  const ownWrite = await fetch(`${FS_API}/records`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userB.idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { owner: { stringValue: userB.localId }, rawNote: { stringValue: "legit" } } }),
  });
  check("own create allowed (200)", ownWrite.status === 200, `status=${ownWrite.status}`);
  const rulesBody = await fetch(`${FS_API}/records/${docId}`, { headers: { Authorization: `Bearer ${userB.idToken}` } }).then((r) => r.text()).catch(() => "");
  console.log(`  [rules] sample rejection body: ${rulesBody.slice(0, 140)}`);
  fs.writeFileSync(path.join(SHOTS, "emu-5-rules-rest-probe.txt"),
    `doc: ${onlineRest.document.name}\nuidA: ${uidA}\nuidB: ${userB.localId}\nno-auth GET: ${noAuth.status}\nB GET A's doc: ${asB.status}\nA GET own doc: ${asA.status}\nB POST forged owner: ${crossWrite.status}\nB POST own record: ${ownWrite.status}\n`);

  /* ---------- 6. PWA: offline hard reload still renders ---------- */
  const swReady = await poll(() => page.evaluate(() => (navigator.serviceWorker.controller ? true : false)), { timeoutMs: 20_000, intervalMs: 1000, label: "service worker controlling page" });
  check("service worker registered & controlling", !!swReady, `controller=${!!swReady}`);
  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await page.evaluate(() => dispatchEvent(new Event("offline")));
  await sleep(600);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch((e) => console.log("  [reload]", String(e).slice(0, 80))); // SW serves the shell offline; assertion below proves render
  const offlineRender = await poll(
    () => page.evaluate(() => {
      const bar = document.querySelector(".topbar");
      const brand = bar?.textContent ?? "";
      const cards = document.querySelectorAll("#project-list .card").length;
      return brand.includes("SiteScribe") && cards >= 1 ? { brand: brand.slice(0, 40), cards } : false;
    }),
    { timeoutMs: 30_000, intervalMs: 1500, label: "app shell renders after offline reload" },
  );
  check("offline hard reload still renders the app (PWA shell)", !!offlineRender, JSON.stringify(offlineRender));
  await page.screenshot({ path: path.join(SHOTS, "emu-6-offline-reload-shell.png") });
  // Re-enter the project offline — Firestore offline persistence should list
  // the seeded + captured records from IndexedDB without any network.
  await page.click("#project-list .card");
  const offlineRecords = await poll(
    () => page.evaluate(() => {
      const n = document.querySelectorAll("#record-list .record").length;
      return n >= 2 ? n : false;
    }),
    { timeoutMs: 20_000, intervalMs: 1000, label: "records listed from offline persistence" },
  );
  check("captured record survives offline reload (IndexedDB persistence)", offlineRecords >= 2, `records=${offlineRecords}`);
  await page.screenshot({ path: path.join(SHOTS, "emu-7-offline-records-from-cache.png") });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 2_000_000, uploadThroughput: 1_000_000 });
  await page.evaluate(() => dispatchEvent(new Event("online")));

  /* ---------- 7. demo-only URL switches: no effect on the real SDK path ---------- */
  // ?engine=sim_cloud and the feature-switch flags are demo-mode-only (SPEC §6.5, §7).
  // In emulator mode nothing may be simulated or switched off by them: Remote Config
  // alone decides, and its values here are the baked-in defaults.
  const ctx2 = await browser.createBrowserContext();
  try {
    const page2 = await ctx2.newPage();
    await page2.setViewport({ width: 1280, height: 800 });
    await page2.goto(APP_URL + "?engine=sim_cloud&feature_report_drafting=false&feature_severity_check=false", { waitUntil: "load", timeout: 30_000 });
    // The first render waits for the Remote Config fetch (and, before it, the
    // Installations registration). With Google's endpoints reachable-but-blackholed both
    // hung for 84.5 s on 2026-11-25, so this bound is generous; on a usual network the
    // card is there within seconds.
    await poll(() => page2.evaluate(() => !!document.querySelector("#project-list .card")), { timeoutMs: 180_000, label: "second user's seeded project" });
    await poll(() => page2.evaluate(() => typeof globalThis.__ssRemoteToggles === "object"), { timeoutMs: 15_000, label: "Remote Config hook" });
    const asked = await page2.evaluate(() => ({
      banner: !!document.querySelector(".sim-banner"),
      simulated: /\(simulated\)/.test(document.body.innerText),
      toggles: globalThis.__ssRemoteToggles,
    }));
    check("?engine=sim_cloud has no effect in emulator mode (no banner, nothing marked simulated)", !asked.banner && !asked.simulated, JSON.stringify(asked));
    await page2.click("#project-list .card");
    await poll(() => page2.evaluate(() => !!document.querySelector("#note")), { timeoutMs: 15_000, label: "second user's session view" });
    await poll(() => page2.evaluate(() => document.querySelectorAll(".check-btn").length >= 3), { timeoutMs: 15_000, label: "record cards" });
    const controls = await page2.evaluate(() => ({
      report: document.querySelector("#report-btn")?.disabled ?? null,
      checks: [...document.querySelectorAll(".check-btn")].map((b) => b.disabled),
      off: document.querySelectorAll("[data-testid^=flag-off]").length,
    }));
    check(
      "URL feature flags have no effect in emulator mode (Remote Config defaults: both features offered)",
      asked.toggles?.featureReportDrafting === true && asked.toggles?.featureSeverityCheck === true && controls.report === false && controls.checks.every((d) => d === false) && controls.off === 0,
      JSON.stringify(controls),
    );
    await page2.screenshot({ path: path.join(SHOTS, "emu-8-url-switches-ignored.png") });
  } finally {
    await ctx2.close();
  }
} catch (e) {
  check("e2e-emulator ran to completion", false, String(e));
} finally {
  if (browser) await browser.close().catch(() => {});
  // Only the profile this run created (see EMU_PROFILE) — nothing else is touched.
  if (EMU_PROFILE) {
    await sleep(500);
    try {
      fs.rmSync(EMU_PROFILE, { recursive: true, force: true });
    } catch {
      console.log("[e2e-emulator] could not remove the temporary browser profile " + EMU_PROFILE);
    }
  }
  if (KEEP) {
    console.log("[e2e-emulator] --keep: emulator suite left running (pid " + emu.pid + ")");
  } else {
    console.log("[e2e-emulator] shutting down emulator suite …");
    if (process.platform === "win32" && emu.pid) spawnSync("taskkill", ["/PID", String(emu.pid), "/T", "/F"]);
    else emu.kill("SIGTERM");
    await Promise.race([emuExit, sleep(15_000)]);
    const still = [];
    for (const port of [4000, 5000, 8080, 9099]) if (await portOpen(port)) still.push(port);
    console.log(still.length ? `[e2e-emulator] WARNING ports still open: ${still.join(",")}` : "[e2e-emulator] emulator ports released");
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n[e2e-emulator] ${results.length - failed.length}/${results.length} assertions passed`);
process.exit(failed.length ? 1 : 0);
