/**
 * Deep-dive: dump ALL chrome://components entries (deep shadow walk),
 * check chrome://policy for PromptAPI/GenAI policies, and disk space.
 */
import puppeteer from "puppeteer-core";
import { statfsSync } from "node:fs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: [
    "--enable-automation",
    "--disable-background-networking",
    "--disable-component-extensions-with-background-pages",
    "--disable-client-side-phishing-detection",
    "--disable-sync",
  ],
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,1000"],
});

// 1. components — dump every component name + version found in shadow DOM text nodes
const c = await browser.newPage();
await c.goto("chrome://components", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 3000));
const dump = await c.evaluate(() => {
  const rows = [];
  const walk = (root, depth) => {
    if (!root || depth > 12) return;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
    }
    // in the components page each component is a <components-item> or similar custom element
    const sel = root.querySelectorAll ? root.querySelectorAll("components-item, .component-item, tr[data-component], #components-list > *") : [];
    for (const row of sel) {
      rows.push((row.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200));
    }
  };
  walk(document, 0);
  // fallback: collect all id-like text chunks containing typical component naming
  if (rows.length === 0) {
    const seen = new Set();
    const walk2 = (root, depth) => {
      if (!root || depth > 12) return;
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) walk2(el.shadowRoot, depth + 1);
      }
    };
    walk2(document, 0);
    return { fallback: true, bodyLen: document.body.innerHTML.length };
  }
  return { rows };
});
console.log("[components-dump]", JSON.stringify(dump, null, 2));
await c.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\nano-components-full.png" });

// 2. policy page
const p = await browser.newPage();
await p.goto("chrome://policy", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2500));
const policies = await p.evaluate(() => {
  const out = [];
  const walk = (root, depth) => {
    if (!root || depth > 12) return;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (/PromptAPI|GenAI|GeminiNano|BuiltInAI|on.device/i.test(t) && t.length < 300) out.push(t.slice(0, 200));
    }
  };
  walk(document, 0);
  return [...new Set(out)].slice(0, 30);
});
console.log("[policy-related]", JSON.stringify(policies, null, 2));

// 3. version + language
const v = await browser.newPage();
await v.goto("chrome://version", { waitUntil: "load" });
const ver = await v.evaluate(() => {
  const walk = (root, acc, depth) => {
    if (!root || depth > 12) return acc;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) walk(el.shadowRoot, acc, depth + 1);
    }
    return acc;
  };
  const body = document.body.textContent.replace(/\s+/g, " ");
  return {
    chrome: (body.match(/Google Chrome\s+([\d.]+)/) ?? [])[1],
    lang: (body.match(/Language:\s*([^]{1,40}?)\s{2,}/) ?? [])[1],
    cmd: body.slice(body.indexOf("Command Line"), body.indexOf("Command Line") + 600),
  };
});
console.log("[version]", JSON.stringify(ver, null, 2));

await browser.close();

// 4. disk space on C:
try {
  const fs = statfsSync("C:\\");
  const gb = (fs.blocks * fs.bsize) / 1024 ** 3;
  const free = (fs.bfree * fs.bsize) / 1024 ** 3;
  console.log(`[disk] C: total ${gb.toFixed(1)} GB, free ${free.toFixed(1)} GB`);
} catch (e) {
  console.log("[disk] statfs failed:", String(e));
}
