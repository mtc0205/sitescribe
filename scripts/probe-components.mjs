/** Verify flags state + chrome://components entries after Preferences injection. */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,1000"],
});

const f = await browser.newPage();
await f.goto("chrome://flags/#prompt-api-for-gemini-nano-multimodal-input", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2500));
await f.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\flags-after-inject.png" });

const c = await browser.newPage();
await c.goto("chrome://components", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2500));
await c.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\components.png" });

// components page text (deep shadow) to find optimization guide entries
const comps = await c.evaluate(() => {
  const texts = [];
  const walk = (root, depth) => {
    if (!root || depth > 8) return;
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
      const t = (el.textContent || "").trim();
      if (t && t.length < 120 && /(optimization|on.device|gemini|model)/i.test(t)) texts.push(t);
    });
  };
  walk(document, 0);
  return [...new Set(texts)].slice(0, 20);
});
console.log("[components]", JSON.stringify(comps, null, 2));

await browser.close();
