/**
 * chrome://on-device-internals deep dive:
 *  - wait for "Device performance class" to resolve
 *  - harvest text from ALL shadow roots (fixed walker)
 *  - open Event Logs + Broker State tabs, harvest each
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

const page = await browser.newPage();
await page.goto("chrome://on-device-internals", { waitUntil: "load", timeout: 12000 });
// give the performance-class evaluation time to finish
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const cls = await harvest().catch(() => "");
  const m = cls.match(/Device performance class:\s*([^\n]*)/);
  console.log(`t+${(i + 1) * 5}s performance class: ${m ? m[1].trim().slice(0, 60) : "?"}`);
  if (m && !/loading/i.test(m[1])) break;
}

async function harvest() {
  return page.evaluate(() => {
    const parts = [];
    const walk = (root, depth) => {
      if (!root || depth > 16) return;
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
        if (el.childNodes && el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
          const t = el.textContent.replace(/\s+/g, " ").trim();
          if (t) parts.push(t);
        } else if (el.tagName === "IRON-LIST" || el.tagName === "CR-LISTBOX" || el.tagName === "TABLE" || el.tagName === "PRE" || el.tagName === "CODE") {
          const t = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (t) parts.push("[BLOCK] " + t.slice(0, 500));
        }
      }
    };
    walk(document, 0);
    return parts.join("\n");
  });
}

let all = "===== TOOLS TAB =====\n" + (await harvest());
await page.screenshot({ path: TOOLS + "\\nano-internals-tools.png", fullPage: true });

// click the Event Logs tab
async function clickTab(name) {
  return page.evaluate((n) => {
    const walk = (root, depth) => {
      if (!root || depth > 14) return false;
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot && walk(el.shadowRoot, depth + 1)) return true;
        const t = (el.textContent || "").trim();
        const aria = el.getAttribute?.("aria-label") || "";
        if (/tab/i.test(el.tagName) || el.getAttribute?.("role") === "tab") {
          if (t.toLowerCase().includes(n.toLowerCase()) || aria.toLowerCase().includes(n.toLowerCase())) {
            el.click();
            return true;
          }
        }
      }
      return false;
    };
    return walk(document, 0);
  }, name);
}

console.log("click Event Logs:", await clickTab("Event Logs"));
await new Promise((r) => setTimeout(r, 2500));
all += "\n\n===== EVENT LOGS =====\n" + (await harvest());
await page.screenshot({ path: TOOLS + "\\nano-internals-eventlogs.png", fullPage: true });

console.log("click Broker State:", await clickTab("Broker State"));
await new Promise((r) => setTimeout(r, 2500));
all += "\n\n===== BROKER STATE =====\n" + (await harvest());
await page.screenshot({ path: TOOLS + "\\nano-internals-broker.png", fullPage: true });

writeFileSync(TOOLS + "\\on-device-internals-full.txt", all, "utf8");
console.log("\n" + all.slice(0, 5000));
await browser.close();
