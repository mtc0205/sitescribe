/** Dump one component's DOM structure from chrome://components to find the update button. */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-component-extensions-with-background-pages", "--disable-sync"],
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,1000"],
});

const c = await browser.newPage();
await c.goto("chrome://components", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2500));

const dump = await c.evaluate(() => {
  const collect = [];
  const walk = (root, path, depth) => {
    if (!root || depth > 6) return;
    for (const el of root.querySelectorAll("*")) {
      const seg = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "");
      if (/optimization/i.test(el.textContent || "") || /button|check/i.test(seg)) {
        collect.push(path + " > " + seg + " :: " + (el.shadowRoot ? "shadow" : "") + " :: " + (el.textContent || "").trim().slice(0, 60));
      }
      if (el.shadowRoot) walk(el.shadowRoot, path + " > " + seg, depth + 1);
    }
  };
  walk(document, "doc", 0);
  return collect.slice(0, 40);
});
console.log(dump.join("\n"));

// Brute force: click EVERY cr-button / button under any component containing 'Optimization'.
const clicked = await c.evaluate(() => {
  let n = 0;
  const walk = (root, depth) => {
    if (!root || depth > 8) return;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
      const tag = (el.tagName || "").toLowerCase();
      if ((tag === "cr-button" || tag === "button") && /update|更新/i.test(el.textContent || "")) {
        try { el.click(); n++; } catch {}
      }
    }
  };
  walk(document, 0);
  return n;
});
console.log("[components] clicked update buttons:", clicked);
await new Promise((r) => setTimeout(r, 15000));

// After clicking, re-check availability.
const p = await browser.newPage();
await p.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
const av = await p.evaluate(async () => ({ availability: await LanguageModel.availability() }));
console.log("[after-update-click]", JSON.stringify(av));

await c.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\components-after.png" });
await browser.close();
