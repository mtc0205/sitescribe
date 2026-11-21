/**
 * Verify what Chrome actually applied:
 *  1. chrome://version → full command line (is --enable-features there?)
 *  2. chrome://gpu → active GPU + any software fallback
 *  3. chrome://flags#prompt-api → effective state of the Prompt API flag
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

const out = [];

// 1. version page: command line (plain DOM)
const v = await browser.newPage();
await v.goto("chrome://version", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 1500));
const verText = await v.evaluate(() => document.body.innerText.replace(/\n{3,}/g, "\n\n"));
const cmdMatch = verText.match(/Command Line\s*([\s\S]{0,700})/);
out.push("=== chrome://version ===");
out.push(cmdMatch ? cmdMatch[1].trim().slice(0, 700) : "(command line section not found)");

// 2. gpu page key facts
const g = await browser.newPage();
await g.goto("chrome://gpu", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2000));
const gpuText = await g.evaluate(() => document.body.innerText);
out.push("\n=== chrome://gpu (key lines) ===");
for (const line of gpuText.split("\n")) {
  if (/GL_RENDERER|Renderer|Vendor|VRAM|Memory|Optimus|active|WebGPU|Graphics Feature Status|disabled/i.test(line) && line.trim()) out.push(line.trim().slice(0, 160));
}

// 3. flags state for prompt API
const f = await browser.newPage();
await f.goto("chrome://flags/#prompt-api-for-gemini-nano", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2000));
const flagText = await f.evaluate(() => {
  const chunks = [];
  const walk = (root, depth) => {
    if (!root || depth > 12) return;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
    }
    for (const el of root.querySelectorAll("#flagsTemplate > *, .experiment, experiment")) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (/prompt api/i.test(t)) chunks.push(t.slice(0, 300));
    }
  };
  walk(document, 0);
  return chunks.join("\n---\n") || document.body.innerText.slice(0, 400);
});
out.push("\n=== flags: prompt API entries ===");
out.push(flagText);
await f.screenshot({ path: TOOLS + "\\nano-verify-flags.png" });

// 4. one more availability probe for the record
const p = await browser.newPage();
await p.goto("https://example.com/", { waitUntil: "load" });
const av = await p.evaluate(async () => {
  if (!("LanguageModel" in self)) return { api: false };
  return { api: true, av: await LanguageModel.availability().catch((e) => "ERR " + e) };
});
out.push("\n=== availability ===");
out.push(JSON.stringify(av));

const report = out.join("\n");
console.log(report);
writeFileSync(TOOLS + "\\nano-verify.txt", report, "utf8");
await browser.close();
