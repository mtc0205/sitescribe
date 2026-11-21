/** Capture Chrome netlog while forcing component update checks; then mine it. */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";
const NETLOG = "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\netlog.json";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-component-extensions-with-background-pages", "--disable-sync"],
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,900",
    `--log-net-log=${NETLOG}`,
  ],
});

const c = await browser.newPage();
await c.goto("chrome://components", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2000));
// click every 检查是否有更新
await c.evaluate(() => {
  const walk = (root, depth) => {
    if (!root || depth > 8) return;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
      if (/button/i.test(el.tagName || "") && /检查是否有更新|check for update/i.test(el.textContent || "")) { try { el.click(); } catch {} }
    }
  };
  walk(document, 0);
});
console.log("[netlog] update checks clicked, waiting 60s…");
await new Promise((r) => setTimeout(r, 60000));

const p = await browser.newPage();
await p.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
const av = await p.evaluate(async () => await LanguageModel.availability());
console.log("[netlog] availability:", av);

await browser.close();
console.log("[netlog] saved to", NETLOG);
