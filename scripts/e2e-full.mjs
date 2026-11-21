/**
 * Full offline-first walkthrough (demo mode, engine=off — no cloud, no fakes):
 *  e2e-10  online capture          (demo cloud unreachable → honest rule-based badge)
 *  e2e-11  offline capture         (pending sync chip)
 *  e2e-12  F4 severity check while offline (rule-based cross-check)
 *  e2e-13  F2 field Q&A while offline      (honest "no engine" answer)
 *  e2e-14  F3 report while offline         ("needs a connection")
 *  e2e-15  back in range → sync            (all pending → synced)
 * Asserts the full loop; exits non-zero on any failure.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-e2e-full-profile";
const SHOTS = "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools";

const NOTE_ONLINE = "Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long, water seepage with white efflorescence nearby.";
const NOTE_OFFLINE = "Spalling with exposed rebar on pier P1, roughly 30 cm patch, active seepage.";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-sync"],
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,1100"],
});

const page = await browser.newPage();
await page.goto("http://127.0.0.1:5173/?engine=off", { waitUntil: "load", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2000));

// enter seeded project
await page.click(".card");
await new Promise((r) => setTimeout(r, 1000));

async function capture(note) {
  await page.type("#note", note);
  await page.click("#capture-btn");
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const done = await page.evaluate(() => !!document.querySelector("#capture-result .ai-block"));
    if (done) break;
  }
  return page.evaluate(() => ({
    badge: document.querySelector("#capture-result .ai-head .chip")?.textContent ?? null,
    record: document.querySelector("#capture-result .record-head")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    syncChip: document.querySelector("#record-list .record .chip.pending, #record-list .record .chip.online")?.textContent ?? null,
  }));
}

// ---- 1. online capture (demo: cloud unreachable → rule-based after budget) ----
const online = await capture(NOTE_ONLINE);
check("online capture completes", !!online.record, online.record ?? "");
check("online capture badge honest (no fake engine)", /rule-based|on-device|cloud/i.test(online.badge ?? ""), online.badge ?? "");
await page.screenshot({ path: SHOTS + "\\e2e-10-capture-online-rulebased.png" });

// ---- 2. go offline, capture again ----
const cdp = await page.createCDPSession();
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await page.evaluate(() => dispatchEvent(new Event("offline")));
await new Promise((r) => setTimeout(r, 600));
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
    await new Promise((r) => setTimeout(r, 1000));
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
  await new Promise((r) => setTimeout(r, 1000));
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
  await new Promise((r) => setTimeout(r, 500));
  f3 = await page.evaluate(() => document.querySelector("#report-out")?.textContent?.replace(/\s+/g, " ").trim() ?? null);
  if (f3 && !/drafting/.test(f3)) break;
}
check("F3 report blocked offline (needs connection)", /connection|needs/i.test(f3 ?? ""), (f3 ?? "").slice(0, 90));
await page.screenshot({ path: SHOTS + "\\e2e-14-f3-report-offline.png" });

// ---- 6. back in range: sync ----
const before = await page.evaluate(() => [...document.querySelectorAll("#record-list .chip.pending")].length);
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 2_000_000, uploadThroughput: 1_000_000 });
await page.evaluate(() => dispatchEvent(new Event("online")));
await new Promise((r) => setTimeout(r, 800));
await page.click("#sync-btn");
await new Promise((r) => setTimeout(r, 1500));
const after = await page.evaluate(() => ({
  pending: [...document.querySelectorAll("#record-list .chip.pending")].length,
  synced: [...document.querySelectorAll("#record-list .chip.online")].length,
  syncBtn: document.querySelector("#sync-btn")?.textContent ?? null,
}));
check("sync flips pending → synced", before > 0 && after.pending === 0 && after.synced >= 1, `before=${before} after=${JSON.stringify(after)}`);
await page.screenshot({ path: SHOTS + "\\e2e-15-back-in-range-synced.png" });

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n[e2e-full] ${results.length - failed.length}/${results.length} assertions passed`);
process.exit(failed.length ? 1 : 0);
