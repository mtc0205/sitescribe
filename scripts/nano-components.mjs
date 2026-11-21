/**
 * Reliable chrome://components dump: recursively collect all shadow roots and
 * harvest component name/version text blocks; then, if Optimization Guide On
 * Device Model exists, click its "Check for update" button and poll.
 */
import puppeteer from "puppeteer-core";

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
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,1200"],
});

const c = await browser.newPage();
await c.goto("chrome://components", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 3000));

// The page is a JS module; easiest reliable harvest = collect ALL leaf text
// nodes across flattened shadow DOM, then group into "name / version" lines.
const harvest = await c.evaluate(() => {
  const chunks = [];
  const walk = (root, depth) => {
    if (!root || depth > 14) return;
    for (const node of root.querySelectorAll("*")) {
      if (node.shadowRoot) walk(node.shadowRoot, depth + 1);
      if (node.childNodes && node.childNodes.length === 1 && node.childNodes[0].nodeType === 3) {
        const t = node.textContent.replace(/\s+/g, " ").trim();
        if (t) chunks.push(t);
      }
    }
    for (const node of root.querySelectorAll("div, span")) {
      // also catch multi-line text holders
    }
  };
  walk(document, 0);
  return chunks;
});
// group: a component entry looks like "Name" followed by "版本 1.2.3" etc.
const text = harvest.join("\n");
console.log("[all-text]\n" + text);

const hasOpt = /optimization guide/i.test(text);
console.log("[has-optimization-guide]", hasOpt);

await c.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\nano-components-top.png" });

// scroll to bottom to capture whole list visually
await c.evaluate(async () => {
  const scroller = document.querySelector("iron-list, #items-list, cr-scrollable");
  if (scroller) scroller.scrollTop = 999999;
  window.scrollTo(0, 999999);
});
await new Promise((r) => setTimeout(r, 1000));
await c.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\nano-components-bottom.png" });

await browser.close();
