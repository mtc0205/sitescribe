/**
 * Enable Chrome's internal debug pages (chrome://chrome-urls has a toggle),
 * then read chrome://on-device-model-internals for on-device model
 * diagnostics (eligibility / download / service state).
 */
import puppeteer from "puppeteer-core";
import { writeFileSync } from "node:fs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";
const TOOLS = "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-sync"],
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-features=OptimizationGuideOnDeviceModel",
    "--window-size=1400,1000",
  ],
});

const page = await browser.newPage();

// 1. enable debug pages on chrome://chrome-urls
await page.goto("chrome://chrome-urls", { waitUntil: "load", timeout: 10000 });
await new Promise((r) => setTimeout(r, 2000));
const enabled = await page.evaluate(() => {
  const walk = (root, depth) => {
    if (!root || depth > 10) return false;
    for (const el of root.querySelectorAll("button, cr-button, a, cr-toggle, input[type=checkbox]")) {
      const t = (el.textContent || el.getAttribute("aria-label") || "").trim();
      if (/启用调试|enable.*debug/i.test(t)) {
        el.click();
        return true;
      }
    }
    let found = false;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot && !found) found = walk(el.shadowRoot, depth + 1) || found;
    }
    return found;
  };
  return walk(document, 0);
});
console.log("[chrome-urls] debug-pages toggle clicked:", enabled);
await new Promise((r) => setTimeout(r, 1500));

// 2. read the internals page
await page.goto("chrome://on-device-model-internals", { waitUntil: "load", timeout: 10000 }).catch((e) => {
  console.log("goto failed:", String(e).slice(0, 120));
});
await new Promise((r) => setTimeout(r, 3000));
const text = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g, "\n\n"));
const title = await page.title();
console.log(`===== chrome://on-device-model-internals (title: ${title}) =====`);
console.log(text.slice(0, 4000));
writeFileSync(TOOLS + "\\on-device-model-internals.txt", `TITLE: ${title}\n\n${text}`, "utf8");
await page.screenshot({ path: TOOLS + "\\on-device-model-internals.png" });

await browser.close();
