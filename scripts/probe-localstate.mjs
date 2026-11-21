/**
 * Enable chrome://flags experiments via Local State (the correct store),
 * after killing all Chrome processes so nothing overwrites the file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";
const LOCAL_STATE = PROFILE + "\\Local State";

const FLAGS = [
  "prompt-api-for-gemini-nano@1",
  "prompt-api-for-gemini-nano-multimodal-input@1",
];

try { execSync("taskkill /F /IM chrome.exe /T", { stdio: "ignore" }); console.log("[proc] chrome killed"); } catch { console.log("[proc] no chrome to kill"); }
await new Promise((r) => setTimeout(r, 2000));

const ls = JSON.parse(readFileSync(LOCAL_STATE, "utf8"));
ls.browser = ls.browser ?? {};
const prev = ls.browser.enabled_labs_experiments ?? [];
ls.browser.enabled_labs_experiments = [...new Set([...FLAGS, ...prev])];
writeFileSync(LOCAL_STATE, JSON.stringify(ls));
console.log("[local-state] enabled_labs_experiments =", JSON.stringify(ls.browser.enabled_labs_experiments));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,1000"],
});

const f = await browser.newPage();
await f.goto("chrome://flags/#prompt-api-for-gemini-nano-multimodal-input", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2500));
await f.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\flags-localstate.png" });

const p = await browser.newPage();
await p.goto("about:blank", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 1500));
const probe = await p.evaluate(async () => {
  const out = { hasLanguageModel: "LanguageModel" in self };
  if (out.hasLanguageModel) {
    try { out.availability = await LanguageModel.availability(); } catch (e) { out.availabilityError = String(e); }
  }
  return out;
});
console.log("[after-local-state]", JSON.stringify(probe, null, 2));
await browser.close();
