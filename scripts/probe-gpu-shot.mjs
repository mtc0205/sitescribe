/** Screenshot chrome://gpu to see the active adapter and acceleration status. */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-component-extensions-with-background-pages", "--disable-sync"],
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,1400"],
});

const g = await browser.newPage();
await g.goto("chrome://gpu", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 3000));
// scroll to top of diagnostics
await g.evaluate(() => window.scrollTo(0, 0));
await g.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\gpu-top.png" });
console.log("[gpu] screenshot saved");
await browser.close();
