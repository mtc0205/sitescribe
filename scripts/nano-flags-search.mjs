/**
 * Search chrome://flags for all built-in-AI related experiments and dump
 * their names + current state, so we can find the one that registers the
 * on-device model component.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-sync"],
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1400,1000"],
});

const page = await browser.newPage();
await page.goto("chrome://flags", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2500));

// type in the search box (inside shadow DOM)
const typed = await page.evaluate(async () => {
  const findInput = (root, depth) => {
    if (!root || depth > 12) return null;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) {
        const inner = findInput(el.shadowRoot, depth + 1);
        if (inner) return inner;
      }
      if (el.tagName === "INPUT" || el.tagName === "CR-SEARCH-FIELD" || el.id === "search") return el;
    }
    return null;
  };
  const input = findInput(document, 0);
  if (!input) return "no-input-found";
  const target = input.tagName === "INPUT" ? input : (input.shadowRoot?.querySelector("input") ?? input);
  target.focus();
  // Chrome's flags search listens on input events
  target.value = "on device";
  target.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  return "typed";
});
console.log("[flags]", typed);
await new Promise((r) => setTimeout(r, 1500));

const dump = await page.evaluate(() => {
  const rows = [];
  const walk = (root, depth) => {
    if (!root || depth > 14) return;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
      if (el.tagName === "EXPERIMENT" || el.classList?.contains("experiment")) {
        rows.push((el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 220));
      }
    }
  };
  walk(document, 0);
  return rows;
});
console.log("[matches]\n" + dump.join("\n---\n"));
await page.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\nano-flags-search.png" });

await browser.close();
