/**
 * Engine-panel + badge-four-states smoke test (demo mode, no cloud needed):
 *  1. home with ?engine=sim_fallback → panel facts + simulated chip visible
 *  2. capture → "Fell back to cloud · (simulated)" amber badge
 *  3. ?engine=off + CDP offline → capture → rule-based badge (dual-fail state)
 * Screenshots to tools/e2e-7-engine-panel.png / e2e-8-sim-fallback.png /
 * e2e-9-dual-fail-rulebased.png. Uses its own profile.
 * Base URL: --url / --port (default http://127.0.0.1:5173 — see lib/base-url.mjs).
 */
import puppeteer from "puppeteer-core";
import { resolveBaseUrl, ensureServesSiteScribe } from "./lib/base-url.mjs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-smoke-profile";
const SHOTS = "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools";
const URL_BASE = resolveBaseUrl();

await ensureServesSiteScribe(URL_BASE);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-sync"],
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,1100"],
});

async function state(page) {
  return page.evaluate(() => ({
    engineFacts: document.querySelector("#engine-facts")?.textContent?.replace(/\s+/g, " ") ?? null,
    badges: [...document.querySelectorAll(".badge-gallery .chip")].map((c) => c.textContent),
    simChip: document.querySelector("#engine-facts .chip")?.textContent ?? null,
    engineChip: document.querySelector("#engine-chip")?.textContent ?? null,
  }));
}

// --- 1. home with simulation=fallback ---
const page = await browser.newPage();
await page.goto(URL_BASE + "/?engine=sim_fallback", { waitUntil: "load", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
const s1 = await state(page);
console.log("[1 home sim_fallback]", JSON.stringify(s1, null, 2));
await page.screenshot({ path: SHOTS + "\\e2e-7-engine-panel.png", fullPage: true });

// --- 2. capture → simulated fallback badge ---
await page.click(".card");
await new Promise((r) => setTimeout(r, 1000));
await page.type("#note", "Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long, seepage with white efflorescence nearby.");
await page.click("#capture-btn");
await new Promise((r) => setTimeout(r, 4000));
const s2 = await page.evaluate(() => ({
  captureBadge: document.querySelector("#capture-result .ai-head .chip")?.textContent ?? null,
  recordHead: document.querySelector("#capture-result .record-head")?.textContent?.replace(/\s+/g, " ").slice(0, 100) ?? null,
  engineChip: document.querySelector("#engine-chip")?.textContent ?? null,
  logRows: [...document.querySelectorAll("#record-list .record")].slice(0, 1).map((r2) => r2.textContent?.replace(/\s+/g, " ").slice(0, 120)),
}));
console.log("[2 capture simulated]", JSON.stringify(s2, null, 2));
await page.screenshot({ path: SHOTS + "\\e2e-8-sim-fallback.png" });

// --- 3. engine=off + offline → dual-fail rule-based ---
await page.goto(URL_BASE + "/?engine=off", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 1500));
await page.click(".card");
await new Promise((r) => setTimeout(r, 800));
const cdp = await page.createCDPSession();
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await page.evaluate(() => dispatchEvent(new Event("offline")));
await new Promise((r) => setTimeout(r, 600));
await page.type("#note", "Hairline transverse crack near support S2-1, barely visible, maybe 0.1 mm, no seepage.");
await page.click("#capture-btn");
// dual-fail: demo cloud is unreachable → 12s budget → rule-based. Wait up to 25s.
let s3 = null;
for (let i = 0; i < 25; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  s3 = await page.evaluate(() => ({
    captureBadge: document.querySelector("#capture-result .ai-head .chip")?.textContent ?? null,
    offlineChip: document.querySelector(".topbar .chip.offline")?.textContent ?? null,
    syncChip: document.querySelector("#capture-result .record-head .chip.pending")?.textContent ?? null,
  }));
  if (s3.captureBadge) break;
}
console.log("[3 offline dual-fail]", JSON.stringify(s3, null, 2));
await page.screenshot({ path: SHOTS + "\\e2e-9-dual-fail-rulebased.png" });

await browser.close();
const ok2 = s2.captureBadge?.includes("(simulated)") && s2.captureBadge?.includes("Fell back");
const ok3 = s3?.captureBadge?.includes("Rule-based");
console.log(`[summary] simFallbackBadge=${!!ok2} dualFailBadge=${!!ok3}`);
process.exit(ok2 && ok3 ? 0 : 1);
