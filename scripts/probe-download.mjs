/**
 * Trigger component update check for the on-device model, then poll
 * LanguageModel.availability() until downloadable/available.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-component-extensions-with-background-pages", "--disable-sync"],
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,1000"],
});

// 1. components page: click "Check for update" on every optimization-guide component.
const c = await browser.newPage();
await c.goto("chrome://components", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2500));
const clicked = await c.evaluate(() => {
  let n = 0;
  const walk = (root, depth) => {
    if (!root || depth > 8) return;
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
      const t = (el.textContent || "").trim();
      if (/optimization guide/i.test(t)) {
        // find sibling "Check for update" button in this component's shadow
      }
    });
  };
  // simpler: find all buttons whose accessible text is check-for-update, click them all
  const walk2 = (root, depth) => {
    if (!root || depth > 8) return;
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) walk2(el.shadowRoot, depth + 1);
      if (el.tagName && /button/i.test(el.tagName) && /check for update|检查更新/i.test(el.textContent || "")) {
        try { el.click(); n++; } catch {}
      }
    });
  };
  walk2(document, 0);
  return n;
});
console.log("[components] check-for-update clicked:", clicked);

// 2. poll availability on the app page for up to 5 minutes.
const p = await browser.newPage();
await p.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const av = await p.evaluate(async () => {
    if (!("LanguageModel" in self)) return { hasLanguageModel: false };
    try { return { hasLanguageModel: true, availability: await LanguageModel.availability() }; } catch (e) { return { hasLanguageModel: true, error: String(e) }; }
  });
  console.log(`[t+${(i + 1) * 10}s]`, JSON.stringify(av));
  if (av.availability === "downloadable" || av.availability === "available") {
    await p.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\downloadable.png" });
    break;
  }
}

await browser.close();
