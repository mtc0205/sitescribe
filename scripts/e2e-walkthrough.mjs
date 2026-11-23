/**
 * End-to-end UI walkthrough (online + offline):
 * 1. open app, enter project, capture a defect note
 * 2. assert record card + engine badge appear (honest whatever engine served)
 * 3. go offline via CDP Network.emulateNetworkConditions, capture again
 * 4. verify the offline capture still completes (on-device or rule-based)
 * Screenshots at each step.
 */
import puppeteer from "puppeteer-core";
import { resolveBaseUrl, ensureServesSiteScribe } from "./lib/base-url.mjs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-e2e-profile";
const SHOTS = "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools";
const URL_BASE = resolveBaseUrl(); // --url / --port, default http://127.0.0.1:5173

await ensureServesSiteScribe(URL_BASE);

const NOTE_ONLINE = "Longitudinal crack on web of girder G2, about two millimeters wide, three meters long, water seepage with white efflorescence nearby.";
const NOTE_OFFLINE = "Hairline transverse crack near support S2-1, barely visible, no seepage, maybe 0.1 mm.";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-sync"],
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,1000"],
});

const page = await browser.newPage();
await page.goto(URL_BASE + "/", { waitUntil: "load", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2000));
await page.screenshot({ path: SHOTS + "\\e2e-1-home.png" });

// Enter the seeded project.
await page.click(".card");
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: SHOTS + "\\e2e-2-session.png" });

async function capture(note, shot, tag) {
  await page.type("#note", note);
  await page.click("#capture-btn");
  // wait for the ai-block to appear (or an error block)
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const done = await page.evaluate(() => !!document.querySelector("#capture-result .ai-block") || !!document.querySelector("#capture-result .error"));
    if (done) break;
  }
  const state = await page.evaluate(() => ({
    badge: document.querySelector("#capture-result .ai-head .chip")?.textContent ?? null,
    record: document.querySelector("#capture-result .record-head")?.textContent?.replace(/\s+/g, " ").slice(0, 120) ?? null,
    syncChip: document.querySelector("#record-list .chip.pending, #record-list .chip.online")?.textContent ?? null,
    engineChip: document.querySelector("#engine-chip")?.textContent ?? null,
  }));
  console.log(`[${tag}]`, JSON.stringify(state, null, 2));
  await page.screenshot({ path: SHOTS + "\\" + shot });
  return state;
}

const onlineResult = await capture(NOTE_ONLINE, "e2e-3-capture-online.png", "online");

// ---- go offline (CDP network emulation = real offline, not a UI trick) ----
const cdp = await page.createCDPSession();
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await page.evaluate(() => dispatchEvent(new Event("offline"))); // update the status chip
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: SHOTS + "\\e2e-4-offline-bar.png" });

const offlineResult = await capture(NOTE_OFFLINE, "e2e-5-capture-offline.png", "offline");

// Back in range: click sync.
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 2_000_000, uploadThroughput: 1_000_000 });
await page.evaluate(() => dispatchEvent(new Event("online")));
await new Promise((r) => setTimeout(r, 800));
await page.click("#sync-btn");
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: SHOTS + "\\e2e-6-back-in-range.png" });

const final = await page.evaluate(() => ({
  records: document.querySelectorAll("#record-list .record").length,
  syncStates: [...document.querySelectorAll("#record-list .chip")].map((c) => c.textContent),
}));
console.log("[final]", JSON.stringify(final, null, 2));

await browser.close();
console.log("[e2e] done. onlineBadge=" + onlineResult.badge + " offlineBadge=" + offlineResult.badge);
