/**
 * Dump the FULL chrome://version command line text (no truncation) so we can
 * confirm whether --enable-features / --lang actually reached the process.
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
    "--lang=en-US",
    "--enable-features=OptimizationGuideOnDeviceModel",
    "--window-size=1400,1100",
  ],
});

const v = await browser.newPage();
await v.goto("chrome://version", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 1500));
const full = await v.evaluate(() => document.body.innerText);
const idx = full.indexOf("Command Line");
const cmd = full.slice(idx, idx + 2500);
console.log(cmd);
writeFileSync(TOOLS + "\\nano-cmdline.txt", cmd, "utf8");
await browser.close();
