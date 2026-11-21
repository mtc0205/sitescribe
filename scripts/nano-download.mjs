/**
 * Trigger the Optimization Guide On Device Model component download.
 * Chrome 158's chrome://components is plain HTML (no shadow DOM): each row is
 * a div containing a name span, version text, and <button> check-for-update.
 *
 * v2: click check-for-update on ALL optimization-guide rows, then poll BOTH
 * the row status text and LanguageModel.availability() on a real page.
 * Logs to tools/nano-download-progress.txt.
 *
 * Usage: node scripts/nano-download.mjs [--proxy]
 */
import puppeteer from "puppeteer-core";
import { appendFileSync } from "node:fs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";
const TOOLS = "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools";
const LOG = TOOLS + "\\nano-download-progress.txt";
const USE_PROXY = process.argv.includes("--proxy");

const args = [
  "--no-first-run",
  "--no-default-browser-check",
  "--window-size=1280,1000",
  "--enable-features=OptimizationGuideOnDeviceModel",
];
if (USE_PROXY) args.push("--proxy-server=http://127.0.0.1:7897");

function log(line) {
  const ts = new Date().toISOString().slice(11, 19);
  const text = `[${ts}] ${line}`;
  console.log(text);
  appendFileSync(LOG, text + "\n");
}

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
  args,
});
log(`browser launched (proxy=${USE_PROXY})`);

// helper: read component rows via plain DOM (Chrome 158 components page)
async function readRows(c) {
  return c.evaluate(() => {
    const rows = [];
    // find candidate row containers: elements that directly contain a button
    // and a span with alphabetic name text
    for (const btn of document.querySelectorAll("button")) {
      const label = (btn.textContent || "").trim();
      if (!/check for update|检查是否有更新/i.test(label)) continue;
      // climb until we find an ancestor that also contains name-ish text
      let row = btn.parentElement;
    }
    // simpler & robust: rows are the direct children structure of the list
    // container. Instead: collect "name spans" and their enclosing row via
    // closest() like traversal done manually.
    const nameSpans = [...document.querySelectorAll("span, div")].filter((el) => {
      if (el.children.length > 0) return false;
      const t = (el.textContent || "").trim();
      return /^[A-Z][A-Za-z0-9 ./&-]{5,60}$/.test(t) && !/版本|version|status|状态/i.test(t);
    });
    for (const span of nameSpans) {
      // enclosing row: nearest ancestor that contains a button
      let row = span.parentElement;
      while (row && row !== document.body && !row.querySelector("button")) row = row.parentElement;
      if (!row) continue;
      const t = (row.textContent || "").replace(/\s+/g, " ").trim();
      rows.push(t.slice(0, 250));
    }
    return rows;
  });
}

const c = await browser.newPage();
await c.goto("chrome://components", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 3500));

let rows = await readRows(c);
log(`component rows (${rows.length}):\n  ` + rows.join("\n  "));

// click check-for-update on optimization-guide rows
const clicked = await c.evaluate(() => {
  let n = 0;
  const targets = [];
  for (const el of document.querySelectorAll("span, div")) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || "").trim();
    if (/optimization guide/i.test(t)) {
      let row = el.parentElement;
      while (row && row !== document.body && !row.querySelector("button")) row = row.parentElement;
      if (row) targets.push({ name: t, row });
    }
  }
  for (const { name, row } of targets) {
    for (const btn of row.querySelectorAll("button")) {
      if (/check for update|检查是否有更新/i.test(btn.textContent || "")) {
        btn.click();
        n++;
        console.info("clicked update for", name);
      }
    }
  }
  return { n, names: targets.map((t) => t.name) };
});
log(`clicked check-for-update on ${clicked.n} row(s): ${JSON.stringify(clicked.names)}`);
await c.screenshot({ path: TOOLS + "\\nano-download-kickoff.png" });

// poll: reload every 15s, watch OG row text + availability on example.com
const p = await browser.newPage();
await p.goto("https://example.com/", { waitUntil: "load" }).catch(() => {});

const started = Date.now();
let last = "";
let done = false;
for (let i = 0; i < 80; i++) {
  await new Promise((r) => setTimeout(r, 15000));
  try {
    await c.reload({ waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 2500));
    rows = await readRows(c);
    const og = rows.filter((r) => /optimization guide/i.test(r));
    const av = await p.evaluate(async () => {
      if (!("LanguageModel" in self)) return "no-api";
      try { return await LanguageModel.availability(); } catch (e) { return "ERR"; }
    });
    const snap = `av=${av} | og=${JSON.stringify(og)}`;
    if (snap !== last) {
      log(snap);
      last = snap;
      await c.screenshot({ path: TOOLS + "\\nano-download-latest.png" });
    }
    if (av === "available") {
      done = true;
      log("MODEL AVAILABLE — download complete");
      break;
    }
    if (av === "unavailable" && og.some((r) => /\d{2,}%/.test(r))) {
      // still fine, downloading
    }
  } catch (e) {
    log("poll error: " + String(e).slice(0, 120));
  }
  if (Date.now() - started > 20 * 60 * 1000) { log("20 min budget exhausted"); break; }
}

await c.screenshot({ path: TOOLS + "\\nano-download-final.png" });
log(done ? "RESULT: COMPLETE (availability=available)" : "RESULT: incomplete — inspect nano-download-final.png + progress log");
await browser.close();
process.exit(done ? 0 : 2);
