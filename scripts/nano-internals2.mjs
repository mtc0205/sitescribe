/**
 * Chrome 158 chrome://on-device-internals deep read:
 *  - enable internal debug pages via chrome://chrome-urls toggle first
 *  - harvest text from flattened shadow DOM (page is a WebUI app)
 *  - full-page screenshot + save text
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
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1400,1200"],
});

// enable debug pages (persisted pref)
const u = await browser.newPage();
await u.goto("chrome://chrome-urls", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 1500));
await u.evaluate(() => {
  const walk = (root, depth) => {
    if (!root || depth > 10) return;
    for (const el of root.querySelectorAll("button, cr-button, cr-toggle, a, input")) {
      const t = (el.textContent || el.getAttribute("aria-label") || "").trim();
      if (/启用调试|enable.*debug/i.test(t)) { try { el.click(); } catch {} }
    }
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
  };
  walk(document, 0);
});
await new Promise((r) => setTimeout(r, 800));

const page = await browser.newPage();
await page.goto("chrome://on-device-internals", { waitUntil: "load", timeout: 12000 }).catch((e) => {
  console.log("goto:", String(e).slice(0, 100));
});
await new Promise((r) => setTimeout(r, 3000));

// harvest flattened text (shadow DOM included)
const text = await page.evaluate(() => {
  const parts = [];
  const walk = (root, depth) => {
    if (!root || depth > 14) return;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
    }
    for (const node of root.childNodes) {
      if (node.nodeType === 3) {
        const t = node.textContent.replace(/\s+/g, " ").trim();
        if (t) parts.push(t);
      }
    }
  };
  walk(document, 0);
  return parts.join("\n");
});
console.log(`harvested ${text.length} chars`);
console.log(text.slice(0, 4000));
writeFileSync(TOOLS + "\\on-device-internals.txt", text, "utf8");
await page.screenshot({ path: TOOLS + "\\on-device-internals.png", fullPage: true });

await browser.close();
