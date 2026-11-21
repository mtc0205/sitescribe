/**
 * Deterministically enable chrome://flags experiments by editing the profile's
 * Preferences file directly (browser must be closed).
 * Format: browser.enabled_labs_experiments = ["flag-name@2", ...]  (@2 = Enabled)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";
const PREFS = PROFILE + "\\Default\\Preferences";

const FLAGS = [
  "prompt-api-for-gemini-nano@2",
  "prompt-api-for-gemini-nano-multimodal-input@2",
];

if (existsSync(PREFS)) {
  const prefs = JSON.parse(readFileSync(PREFS, "utf8"));
  prefs.browser = prefs.browser ?? {};
  const prev = prefs.browser.enabled_labs_experiments ?? [];
  prefs.browser.enabled_labs_experiments = [...new Set([...FLAGS, ...prev])];
  writeFileSync(PREFS, JSON.stringify(prefs));
  console.log("[prefs] enabled_labs_experiments =", JSON.stringify(prefs.browser.enabled_labs_experiments));
} else {
  console.log("[prefs] Preferences file not found at", PREFS);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,900"],
});

const page = await browser.newPage();
await page.goto("about:blank", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 1500));

const probe = await page.evaluate(async () => {
  const out = {
    hasLanguageModel: "LanguageModel" in self,
    hasTranslator: "Translator" in self,
    hasSummarizer: "Summarizer" in self,
  };
  if (out.hasLanguageModel) {
    try { out.availability = await LanguageModel.availability(); } catch (e) { out.availabilityError = String(e); }
  }
  return out;
});
console.log("[after-flag-inject]", JSON.stringify(probe, null, 2));

await page.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\after-inject.png" });
await browser.close();
