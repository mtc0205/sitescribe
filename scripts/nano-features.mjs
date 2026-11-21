/**
 * Force the on-device model component registration with
 * --enable-features=OptimizationGuideOnDeviceModel (community-verified route
 * for machines not in the Finch rollout group), then:
 *  - probe availability
 *  - call LanguageModel.create() to get the precise error if unavailable
 *  - check whether the component appeared in chrome://components
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
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,1000",
    "--enable-features=OptimizationGuideOnDeviceModel",
  ],
});

const page = await browser.newPage();
await page.goto("https://example.com/", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2000));

const probe = await page.evaluate(async () => {
  const out = { hasLanguageModel: "LanguageModel" in self };
  if (!out.hasLanguageModel) return out;
  out.availability = await LanguageModel.availability().catch((e) => "ERR " + e);
  if (out.availability === "unavailable") {
    try {
      await LanguageModel.create();
      out.createError = "unexpected: create() resolved while availability=unavailable";
    } catch (e) {
      out.createError = String(e && e.message ? e.message : e);
    }
  }
  return out;
});
console.log("[forced-feature]", JSON.stringify(probe, null, 2));

// component list check
const c = await browser.newPage();
await c.goto("chrome://components", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 3000));
const names = await c.evaluate(() => {
  const chunks = [];
  const walk = (root, depth) => {
    if (!root || depth > 14) return;
    for (const node of root.querySelectorAll("*")) {
      if (node.shadowRoot) walk(node.shadowRoot, depth + 1);
      if (node.childNodes.length && node.childNodes.length <= 2) {
        const t = node.textContent.replace(/\s+/g, " ").trim();
        if (t && t.length > 3 && /[A-Za-z]{4}/.test(t)) chunks.push(t);
      }
    }
  };
  walk(document, 0);
  return chunks.join("\n");
});
console.log("[components-has-og]", /optimization guide/i.test(names));

await browser.close();
