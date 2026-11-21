/** UI smoke test: console errors + DOM presence + screenshot. */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-ui-profile";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-sync"],
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,1000"],
});

const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${String(e).slice(0, 400)}`));

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle0", timeout: 30000 }).catch((e) => errors.push("[goto] " + String(e)));
await new Promise((r) => setTimeout(r, 3000));

const state = await page.evaluate(() => ({
  appChildren: document.querySelector("#app")?.children.length ?? -1,
  hasHero: !!document.querySelector(".hero"),
  hasTopbar: !!document.querySelector(".topbar"),
  projectCards: document.querySelectorAll(".card").length,
  bodyText: document.body.innerText.slice(0, 200),
}));
console.log("[ui]", JSON.stringify(state, null, 2));
console.log("[console]", errors.slice(0, 10).join("\n") || "(clean)");

await page.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\ui-smoke.png" });
await browser.close();
