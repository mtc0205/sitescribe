/**
 * On-device inference proof (run #15, 2026-11-23).
 *
 * Proves the F1/F2 on-device path with REAL SDK telemetry — the assertions
 * accept ONLY a genuine "⚡ On-device · Gemini Nano" badge (driven by
 * GenerateContentResponse.inferenceSource === "on_device"). A rule-based,
 * simulated or cloud badge fails the run. Nothing here can fake a pass.
 *
 * Requirements (see README "Launching Chrome for on-device runs"):
 *  - Chromium's OptimizationHints must stay enabled, so we drop puppeteer's
 *    default `--disable-features` arg (A/B verified 2026-11-23: with the
 *    default args LanguageModel.availability() is permanently "unavailable").
 *  - The Gemini Nano model component must already be installed in the Chrome
 *    profile — pass the shared evidence profile via --profile (default:
 *    ../tools/nano2/profiles/E1b, which has the ~4 GB model downloaded).
 *
 * Flow: launch -> probe availability (honest early exit if the model is not
 * installed) -> go OFFLINE (CDP) -> F1: type a field note + click ⚡ Capture
 * (real user gesture) -> assert on-device badge -> F2: ask one question ->
 * assert on-device badge -> write ../tools/ondevice-proof.json + screenshot.
 *
 * Usage:
 *   node scripts/e2e-ondevice.mjs                        # shared evidence profile
 *   node scripts/e2e-ondevice.mjs --profile <dir>        # another profile
 *   node scripts/e2e-ondevice.mjs --headed               # show the window
 *   node scripts/e2e-ondevice.mjs --url https://…        # hosted URL (post-deploy)
 * Exit codes: 0 = on-device proof captured; 1 = assertion failed;
 *             2 = model not available (honest skip, try again later).
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROOF = path.resolve(ROOT, "..", "tools", "ondevice-proof.json");
const SHOT = path.resolve(ROOT, "..", "tools", "ondevice-proof.png");
const DEFAULT_PROFILE = path.resolve(ROOT, "..", "tools", "nano2", "profiles", "E1b");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};
const PROFILE = opt("profile", DEFAULT_PROFILE);
const URL_BASE = opt("url", "http://127.0.0.1:5173");
const HEADLESS = !args.includes("--headed");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
}

function writeProof(obj) {
  fs.writeFileSync(PROOF, JSON.stringify(obj, null, 2));
  console.log(`[ondevice] proof written → ${PROOF}`);
}

console.log(`[ondevice] profile: ${PROFILE}`);
console.log(`[ondevice] url:     ${URL_BASE}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: HEADLESS,
  userDataDir: PROFILE,
  // CRITICAL: keep OptimizationHints enabled (puppeteer's default
  // --disable-features arg disables the on-device model stack).
  ignoreDefaultArgs: ["--disable-features"],
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,900"],
});

const proof = {
  timestamp: new Date().toISOString(),
  url: URL_BASE,
  profile: PROFILE,
  headless: HEADLESS,
  offlineAtCapture: null,
  availability: null,
  promptApiExposed: null,
  f1: null,
  f2: null,
  status: "incomplete",
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 160)));

  await page.goto(URL_BASE + "/?engine=off", { waitUntil: "load", timeout: 60_000 });
  await page.waitForSelector("#project-list .card", { timeout: 60_000 });

  // ---- 0. honest availability probe (never fabricated) ----
  const probe = await page.evaluate(async () => {
    if (!("LanguageModel" in self)) return { exposed: false, availability: null };
    try {
      return { exposed: true, availability: await self.LanguageModel.availability() };
    } catch (e) {
      return { exposed: true, availability: "probe-error: " + String(e).slice(0, 80) };
    }
  });
  proof.promptApiExposed = probe.exposed;
  proof.availability = probe.availability;
  console.log(`[ondevice] Prompt API exposed: ${probe.exposed}, availability: ${probe.availability}`);

  if (!probe.exposed || probe.availability !== "available") {
    proof.status = "model-not-available";
    proof.offlineAtCapture = false;
    writeProof(proof);
    console.log(
      "\n[ondevice] HONEST SKIP — the on-device model is not available in this profile/browser yet\n" +
        `            (exposed=${probe.exposed}, availability=${probe.availability}).\n` +
        "            No inference was run and nothing was faked. Once the Gemini Nano\n" +
        "            component finishes downloading into the profile, rerun:\n" +
        "              node scripts/e2e-ondevice.mjs            (shared evidence profile)\n" +
        "              node scripts/e2e-ondevice.mjs --headed   (if headless reports unavailable)",
    );
    await page.screenshot({ path: SHOT }).catch(() => {});
    process.exit(2);
  }

  // ---- go offline BEFORE capture: on-device must serve with zero network ----
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await page.evaluate(() => dispatchEvent(new Event("offline")));
  proof.offlineAtCapture = true;
  await sleep(600);

  await page.click("#project-list .card");
  await page.waitForSelector("#note", { timeout: 30_000 });

  async function capture(note) {
    const t0 = Date.now();
    await page.type("#note", note);
    await page.click("#capture-btn"); // real user gesture (Chrome requirement)
    for (let i = 0; i < 120; i++) {
      await sleep(1000);
      const done = await page.evaluate(() => !!document.querySelector("#capture-result .ai-block"));
      if (done) break;
    }
    return page.evaluate(() => ({
      badge: document.querySelector("#capture-result .ai-head .chip")?.textContent ?? "",
      text: document.querySelector("#capture-result .ai-body")?.textContent?.slice(0, 200) ?? "",
    })).then((r) => ({ ...r, latencyMs: Date.now() - t0 }));
  }

  // ---- F1: offline note structuring ----
  const f1 = await capture("Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long, seepage with white efflorescence nearby.");
  proof.f1 = f1;
  check("F1 badge is genuinely on-device (SDK inferenceSource)", /on-device/i.test(f1.badge) && !/simulated|rule-based|cloud/i.test(f1.badge), `"${f1.badge}" in ${Math.round(f1.latencyMs / 1000)}s`);

  // ---- F2: offline field Q&A ----
  const t2 = Date.now();
  await page.type("#qa-input", "What does efflorescence on a bridge girder usually indicate?");
  await page.click("#qa-btn");
  let f2 = null;
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    f2 = await page.evaluate(() => ({
      badge: document.querySelector("#qa-out .ai-head .chip")?.textContent ?? "",
      text: document.querySelector("#qa-out .ai-body")?.textContent?.slice(0, 160) ?? "",
    }));
    if (f2.badge && !/thinking/.test(f2.text)) break;
  }
  proof.f2 = { ...f2, latencyMs: Date.now() - t2 };
  check("F2 badge is genuinely on-device", /on-device/i.test(f2?.badge ?? "") && !/simulated|rule-based|cloud/i.test(f2?.badge ?? ""), `"${f2?.badge}"`);

  await page.screenshot({ path: SHOT });
  const failed = results.filter((r) => !r.ok);
  proof.status = failed.length ? "assertion-failed" : "on-device-proven";
  writeProof(proof);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 2_000_000, uploadThroughput: 1_000_000 });
  console.log(`\n[ondevice] ${results.length - failed.length}/${results.length} assertions passed`);
  process.exit(failed.length ? 1 : 0);
} catch (e) {
  proof.status = "error: " + String(e).slice(0, 200);
  writeProof(proof);
  console.error("[ondevice] error:", e);
  process.exit(1);
} finally {
  await browser.close().catch(() => {});
}
