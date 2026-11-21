/**
 * Collect ALL chrome://flags experiment internal names + titles, and grep
 * for on-device / prerelease / model related entries.
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
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1400,1000"],
});

const page = await browser.newPage();
await page.goto("chrome://flags", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 3000));

const all = await page.evaluate(() => {
  const out = [];
  const walk = (root, depth) => {
    if (!root || depth > 14) return;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
    }
    // experiments have id like "prompt-api-for-gemini-nano"
    for (const el of root.querySelectorAll("[id]")) {
      const id = el.id;
      if (/^[a-z0-9-]{8,}$/.test(id) && id.includes("-")) {
        const t = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140);
        out.push({ id, t });
      }
    }
  };
  walk(document, 0);
  return out;
});
const names = [...new Map(all.map((e) => [e.id, e])).values()];
console.log(`collected ${names.length} entries`);
writeFileSync(TOOLS + "\\flags-all.txt", names.map((n) => `${n.id} :: ${n.t}`).join("\n"), "utf8");

const interesting = names.filter((n) => /prerelease|pre-release|on.?device|model|nano|gemini|built.?in.?ai|ai.?platform|device.?performance/i.test(n.id + " " + n.t));
console.log("=== interesting ===");
for (const n of interesting) console.log(`#${n.id}\n   ${n.t}\n`);

await browser.close();
