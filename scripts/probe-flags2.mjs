/** Deep-query chrome://flags shadow DOM for AI flags; screenshot the target flag. */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,900"],
});

const page = await browser.newPage();
await page.goto("chrome://flags/#prompt-api-for-gemini-nano-multimodal-input", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2500));

// Deep-dive all shadow roots.
function deepText(root, depth = 0, acc = []) {
  if (!root || depth > 6) return acc;
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) deepText(el.shadowRoot, depth + 1, acc);
    if (el.textContent && /prompt api|gemini nano/i.test(el.textContent) && el.children.length === 0) {
      acc.push(el.textContent.trim().slice(0, 200));
    }
  }
  return acc;
}
const hits = await page.evaluate(() => {
  const acc = [];
  const walk = (root, depth) => {
    if (!root || depth > 7) return;
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
      const t = (el.textContent || "").trim();
      if (t && t.length < 220 && /prompt api for gemini nano/i.test(t)) acc.push(t);
    });
  };
  walk(document, 0);
  return [...new Set(acc)].slice(0, 12);
});
console.log("[flags] 'Prompt API for Gemini Nano' entries:", JSON.stringify(hits, null, 2));

// Count total flags to prove the page actually rendered.
const total = await page.evaluate(() => {
  let n = 0;
  const walk = (root, depth) => {
    if (!root || depth > 7) return;
    root.querySelectorAll("*").forEach((el) => {
      if (el.tagName.toLowerCase().startsWith("flags-item")) n++;
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
    });
  };
  walk(document, 0);
  return n;
});
console.log("[flags] total flags-item count:", total);

await page.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\flags-screenshot.png" });
console.log("[flags] screenshot saved");

// Also check enterprise policies that could gate built-in AI.
const pol = await browser.newPage();
await pol.goto("chrome://policy", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 1500));
const policies = await pol.evaluate(() => document.body.innerText.slice(0, 1200));
console.log("[policy]", policies);

await browser.close();
