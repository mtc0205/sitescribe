/**
 * Quick status probe: is the Prompt API (LanguageModel) exposed in this
 * profile, and is the on-device model available / downloadable right now?
 * Also reads chrome://components for the Optimization Guide model entry.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: [
    "--enable-automation",
    "--disable-background-networking",
    "--disable-component-extensions-with-background-pages",
    "--disable-client-side-phishing-detection",
    "--disable-sync",
  ],
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,900"],
});

const page = await browser.newPage();
await page.goto("https://example.com/", { waitUntil: "load", timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));

const probe = await page.evaluate(async () => {
  const out = {
    url: location.href,
    secureContext: isSecureContext,
    hasLanguageModel: "LanguageModel" in self,
    hasPrompt: "prompt" in (self.LanguageModel ?? {}),
    ua: navigator.userAgent,
  };
  if (out.hasLanguageModel) {
    try {
      out.availability = await LanguageModel.availability();
    } catch (e) {
      out.availabilityError = String(e);
    }
    // enumerate API surface for evidence
    out.apiSurface = Object.getOwnPropertyNames(LanguageModel.prototype ?? {});
  }
  return out;
});
console.log("[nano-status]", JSON.stringify(probe, null, 2));

// components page: find optimization guide entries (deep shadow DOM walk)
const c = await browser.newPage();
await c.goto("chrome://components", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2500));
const comps = await c.evaluate(() => {
  const found = [];
  const walk = (root, depth) => {
    if (!root || depth > 10) return;
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
    });
    // component rows are <tr> in the components list
    if (root instanceof Document || root instanceof ShadowRoot) {
      root.querySelectorAll(".feature-ver-info, tr").forEach((row) => {
        const t = (row.textContent || "").replace(/\s+/g, " ").trim();
        if (/optimization guide|on device model|gemini/i.test(t)) found.push(t.slice(0, 160));
      });
    }
  };
  walk(document, 0);
  return found;
});
console.log("[components]", JSON.stringify(comps, null, 2));
await c.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\nano-status-components.png", fullPage: false });

await browser.close();
