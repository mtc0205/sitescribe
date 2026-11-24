/**
 * Full offline-first walkthrough (demo mode, engine=off — no cloud, no fakes):
 *  e2e-10  online capture          (demo cloud unreachable → honest rule-based badge)
 *  e2e-11  offline capture         (pending sync chip)
 *  e2e-12  F4 severity check while offline (rule-based cross-check)
 *  e2e-13  F2 field Q&A while offline      (honest "no engine" answer)
 *  e2e-14  F3 report while offline         ("needs a connection")
 *  e2e-15  back in range → sync            (all pending → synced)
 * plus regressions from the 2026-11-24 polish night:
 *  - a FRESH profile per run (first-time visitor), so the demo seeds must read
 *    "synced" (they used to be stored as "pending sync")
 *  - record timestamps are local time with an explicit zone (were raw UTC)
 *  - a connectivity change does not wipe a half-typed note (the view used to
 *    re-render on online/offline events)
 *  - an online capture is "synced" at once in demo mode (live mode keeps the
 *    record pending until Firestore acks — that is e2e-emulator's job)
 * and from the 2026-11-25 audit night:
 *  - the two F1 edge cases, with the SDK's cloud reply canned in (e2e-16/17):
 *    a reply that is not usable JSON, and a reply without `inferenceSource`
 * Asserts the full loop; exits non-zero on any failure.
 *
 * Base URL: --url <base> or --port <n> (default http://127.0.0.1:5173, the
 * `npm run dev` port). The script refuses to run (exit 2) against a server
 * that is not SiteScribe — e.g. when the default port is taken by another
 * project: `npm run dev -- --port 5187 --strictPort` + `--port 5187`.
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveBaseUrl, ensureServesSiteScribe } from "./lib/base-url.mjs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL_BASE = resolveBaseUrl();
const PROFILE = path.join(os.tmpdir(), `ss-e2e-full-profile-${Date.now()}`); // fresh every run
const SHOTS = "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools";

const NOTE_ONLINE = "Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long, water seepage with white efflorescence nearby.";
const NOTE_OFFLINE = "Spalling with exposed rebar on pier P1, roughly 30 cm patch, active seepage.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OFFLINE = { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 };
const ONLINE = { offline: false, latency: 40, downloadThroughput: 2_000_000, uploadThroughput: 1_000_000 };

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
}

await ensureServesSiteScribe(URL_BASE);
console.log(`[e2e-full] base URL ${URL_BASE} · fresh profile ${PROFILE}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-sync"],
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,1100"],
});

try {
const page = await browser.newPage();
await page.goto(URL_BASE + "/?engine=off", { waitUntil: "load", timeout: 30000 });
await sleep(2000);

// enter seeded project
await page.click(".card");
await sleep(1000);

/** Type `note` into the capture box of `pg`, click Capture, wait for the result.
 *  Returns the answer badge, the preview's head row and the newest list card's sync chip. */
async function captureOn(pg, note) {
  await pg.type("#note", note);
  await pg.click("#capture-btn");
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    const done = await pg.evaluate(() => !!document.querySelector("#capture-result .ai-block"));
    if (done) break;
  }
  return pg.evaluate(() => ({
    badge: document.querySelector("#capture-result .ai-head .chip")?.textContent ?? null,
    record: document.querySelector("#capture-result .record-head")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    syncChip: document.querySelector("#record-list .record .chip.pending, #record-list .record .chip.online")?.textContent ?? null,
  }));
}
const capture = (note) => captureOn(page, note);

// ---- 0. first-time visitor: demo seeds are synced, timestamps are local + zoned ----
const fresh = await page.evaluate(() => ({
  pending: document.querySelectorAll("#record-list .chip.pending").length,
  synced: document.querySelectorAll("#record-list .chip.online").length,
  time: document.querySelector("#record-list .record-time")?.textContent ?? null,
  engineChip: document.querySelector("#engine-chip")?.textContent ?? null,
}));
check("fresh profile: demo seeds are not stuck in pending sync", fresh.pending === 0 && fresh.synced >= 3, JSON.stringify(fresh));
check("record timestamp is local time with an explicit zone", /\d{2}:\d{2} \(UTC[+-]\d/.test(fresh.time ?? ""), fresh.time ?? "");
check("status-bar engine chip is a neutral statement (not '…' / 'idle')", !!fresh.engineChip && !/^…$|idle/i.test(fresh.engineChip), fresh.engineChip ?? "");

// ---- 0b. a connectivity change must not wipe a half-typed note ----
const cdp = await page.createCDPSession();
await cdp.send("Network.enable");
/** Take the page out of coverage, or back into it. Chrome's offline emulation fails
 *  simple requests at once but lets CORS preflights run: with the AI host unreachable
 *  (2026-11-25) the SDK's cloud call hung for 84.5 s, and F2–F4, which have no budget,
 *  stalled with it. A device out of coverage fails everything at once, so blocking the
 *  AI host is what "offline" has to mean here. No assertion depends on how the request
 *  fails — only on what the app does without an answer. */
const AI_HOSTS = ["*googleapis.com*"];
async function setCoverage(online) {
  await cdp.send("Network.emulateNetworkConditions", online ? ONLINE : OFFLINE);
  await cdp.send("Network.setBlockedURLs", { urls: online ? [] : AI_HOSTS });
  await page.evaluate((on) => dispatchEvent(new Event(on ? "online" : "offline")), online);
}
await page.type("#note", "half-typed");
await setCoverage(false);
await sleep(600);
const kept = await page.evaluate(() => ({ note: document.querySelector("#note").value, conn: document.querySelector(".topbar .chip.conn")?.textContent ?? null }));
check("connectivity change keeps a half-typed note (no re-render)", kept.note === "half-typed" && /offline/i.test(kept.conn ?? ""), JSON.stringify(kept));
// back in coverage for the online capture
await setCoverage(true);
await page.evaluate(() => { document.querySelector("#note").value = ""; });
await sleep(600);

// ---- 1. online capture (demo: cloud unreachable → rule-based after budget) ----
const online = await capture(NOTE_ONLINE);
check("online capture completes", !!online.record, online.record ?? "");
check("online capture badge honest (no fake engine)", /rule-based|on-device|cloud/i.test(online.badge ?? ""), online.badge ?? "");
check("online capture is marked synced right away (demo mode)", /synced/i.test(online.syncChip ?? ""), online.syncChip ?? "");
await page.screenshot({ path: SHOTS + "\\e2e-10-capture-online-rulebased.png" });

// ---- 2. go offline, capture again ----
await setCoverage(false);
await sleep(600);
const offline = await capture(NOTE_OFFLINE);
check("offline capture completes", !!offline.record, offline.record ?? "");
check("offline record pending sync", /pending/i.test(offline.syncChip ?? ""), offline.syncChip ?? "");
await page.screenshot({ path: SHOTS + "\\e2e-11-capture-offline-pending.png" });

// ---- 3. F4 severity check offline (first record card in list) ----
const checkBtn = await page.$("#record-list .record .check-btn");
if (checkBtn) {
  await checkBtn.click();
  let f4 = null;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    f4 = await page.evaluate(() => {
      const out = document.querySelector("#record-list .record .check-out");
      return out?.textContent?.replace(/\s+/g, " ").trim() ?? null;
    });
    if (f4 && !/checking/.test(f4)) break;
  }
  check("F4 severity check returns an answer offline", !!f4 && f4.length > 20, (f4 ?? "").slice(0, 90));
  await page.screenshot({ path: SHOTS + "\\e2e-12-f4-check-offline.png" });
} else {
  check("F4 check button present", false, "no .check-btn in record list");
}

// ---- 4. F2 field Q&A offline ----
await page.type("#qa-input", "What does efflorescence usually indicate?");
await page.click("#qa-btn");
let f2 = null;
for (let i = 0; i < 45; i++) {
  await sleep(1000);
  f2 = await page.evaluate(() => ({
    badge: document.querySelector("#qa-out .ai-head .chip")?.textContent ?? null,
    text: document.querySelector("#qa-out .ai-body")?.textContent?.slice(0, 120) ?? null,
  }));
  if (f2.text && !/thinking/.test(f2.text)) break;
}
check("F2 Q&A offline honest (no-engine badge, not an error)", /no engine|rule|unavailable|on-device|cloud/i.test(f2?.badge ?? ""), f2?.badge ?? "");
await page.screenshot({ path: SHOTS + "\\e2e-13-f2-qa-offline.png" });

// ---- 5. F3 report offline ----
await page.click("#report-btn");
let f3 = null;
for (let i = 0; i < 20; i++) {
  await sleep(500);
  f3 = await page.evaluate(() => document.querySelector("#report-out")?.textContent?.replace(/\s+/g, " ").trim() ?? null);
  if (f3 && !/drafting/.test(f3)) break;
}
check("F3 report blocked offline (needs connection)", /connection|needs/i.test(f3 ?? ""), (f3 ?? "").slice(0, 90));
await page.screenshot({ path: SHOTS + "\\e2e-14-f3-report-offline.png" });

// ---- 6. back in range: sync (fresh profile ⇒ exactly one pending record: the offline capture) ----
const before = await page.evaluate(() => ({
  pending: document.querySelectorAll("#record-list .chip.pending").length,
  synced: document.querySelectorAll("#record-list .chip.online").length,
}));
await setCoverage(true);
await sleep(800);
await page.click("#sync-btn");
await sleep(1500);
const after = await page.evaluate(() => ({
  pending: document.querySelectorAll("#record-list .chip.pending").length,
  synced: document.querySelectorAll("#record-list .chip.online").length,
  syncBtn: document.querySelector("#sync-btn")?.textContent ?? null,
}));
check(
  "sync flips pending → synced",
  before.pending === 1 && before.synced === 4 && after.pending === 0 && after.synced === 5,
  `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
);
await page.screenshot({ path: SHOTS + "\\e2e-15-back-in-range-synced.png" });

// ---- 7. the two F1 edge cases (2026-11-25), the SDK's cloud reply canned in ----
// Demo mode has no cloud, so the reply is answered inside the browser (CDP Fetch
// interception) before it leaves it. A canned reply can only ever lead this suite
// to a rule-based or an "Engine unknown" record — never to a model badge — which
// is exactly what these checks assert.
const CANNED_RECORD = { component: "web of girder G2", defectType: "longitudinal crack", quantity: "~2mm wide, ~3m long", severity: "moderate", notes: "canned reply for the e2e run" };
async function captureWithCannedReply(shot, text, { hideSource = false } = {}) {
  const p = await browser.newPage();
  if (hideSource) {
    // The installed SDK always sets `inferenceSource` (createEnhancedContentResponse
    // defaults it). The omission SPEC §6.1 allows is forced where the app reads it.
    await p.evaluateOnNewDocument(() => {
      Object.defineProperty(Object.prototype, "inferenceSource", { configurable: true, get() { return undefined; }, set() {} });
    });
  }
  const cdp = await p.createCDPSession();
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*generateContent*", requestStage: "Request" }] });
  let served = 0;
  cdp.on("Fetch.requestPaused", async (ev) => {
    const cors = [{ name: "Access-Control-Allow-Origin", value: "*" }];
    if (ev.request.method === "OPTIONS") {
      await cdp.send("Fetch.fulfillRequest", { requestId: ev.requestId, responseCode: 204, responseHeaders: [...cors, { name: "Access-Control-Allow-Methods", value: "POST, OPTIONS" }, { name: "Access-Control-Allow-Headers", value: ev.request.headers["Access-Control-Request-Headers"] ?? "*" }] });
      return;
    }
    served++;
    const body = { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }] };
    await cdp.send("Fetch.fulfillRequest", { requestId: ev.requestId, responseCode: 200, responseHeaders: [...cors, { name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
  });
  await p.goto(URL_BASE + "/?engine=off", { waitUntil: "load", timeout: 30000 });
  await p.waitForSelector("#project-list .card", { timeout: 30000 });
  await sleep(800);
  await p.click("#project-list .card");
  await sleep(800);
  const captured = await captureOn(p, NOTE_ONLINE);
  const state = await p.evaluate(() => {
    const newest = JSON.parse(localStorage.getItem("sitescribe.v1") ?? "{}").records?.[0] ?? null;
    return {
      previewChip: document.querySelector("#capture-result .record-chips [data-testid=record-engine]")?.textContent ?? null,
      listChip: document.querySelector("#record-list .record [data-testid=record-engine]")?.textContent ?? null,
      engineChip: document.querySelector("#engine-chip")?.textContent ?? null,
      notes: document.querySelector("#capture-result .record-notes")?.textContent ?? null,
      stored: newest ? { extractedBy: newest.extractedBy, component: newest.component, notes: newest.notes } : null,
    };
  });
  await p.screenshot({ path: SHOTS + "\\e2e-" + shot });
  return { ...captured, ...state, served };
}
const unusable = await captureWithCannedReply("16-unusable-reply-rulebased.png", "I'm sorry, I can't structure that note.");
check(
  "model reply that is not usable JSON: record is shown as rule-based, not with the model's chip",
  unusable.served === 1 && /^⚙ Rule-based \(/.test(unusable.badge ?? "") && /not with usable JSON/.test(unusable.badge ?? "") && unusable.previewChip === "⚙ rule-based" && unusable.listChip === "⚙ rule-based" && /Rule-based/.test(unusable.engineChip ?? ""),
  JSON.stringify(unusable),
);
check(
  "model reply that is not usable JSON: saved as rule_based, notes say the engine replied",
  unusable.stored?.extractedBy === "rule_based" && /\[Gemini replied, but its reply was not usable JSON — fields structured by rules\]/.test(unusable.stored?.notes ?? ""),
  JSON.stringify(unusable.stored),
);
const unnamed = await captureWithCannedReply("17-engine-unknown.png", JSON.stringify(CANNED_RECORD), { hideSource: true });
check(
  "reply without inferenceSource: badge, record chip and status chip say Engine unknown",
  unnamed.served === 1 && unnamed.badge === "⏳ Engine unknown" && unnamed.previewChip === "⏳ engine unknown" && unnamed.listChip === "⏳ engine unknown" && unnamed.engineChip === "⏳ Engine unknown",
  JSON.stringify(unnamed),
);
check(
  "reply without inferenceSource: saved as unknown — the model's fields, no rule marker",
  unnamed.stored?.extractedBy === "unknown" && unnamed.stored?.component === CANNED_RECORD.component && !/structured by rules/.test(unnamed.stored?.notes ?? ""),
  JSON.stringify(unnamed.stored),
);
} catch (e) {
  check("e2e-full ran to completion", false, String(e));
} finally {
  await browser.close().catch(() => {});
  // Remove only the fresh profile this run created (see PROFILE above).
  await sleep(500);
  fs.rmSync(PROFILE, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n[e2e-full] ${results.length - failed.length}/${results.length} assertions passed`);
process.exit(failed.length ? 1 : 0);
