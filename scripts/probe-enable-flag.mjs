/**
 * Flip chrome://flags AI flags to Enabled via shadow-DOM automation, relaunch,
 * then re-probe for LanguageModel. This mirrors exactly what the README tells
 * a human to do, so the on-device path stays honestly reproducible.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3"; // reuse: flags state persists per profile

const FLAG_IDS = [
  "prompt-api-for-gemini-nano",
  "prompt-api-for-gemini-nano-multimodal-input",
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,900"],
});

const page = await browser.newPage();
await page.goto("chrome://flags", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2000));

const flipped = await page.evaluate((ids) => {
  const done = [];
  const walk = (root, depth) => {
    if (!root || depth > 7) return;
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
      if (el.tagName && el.tagName.toLowerCase() === "flags-item") {
        const id = el.id || el.getAttribute("id") || "";
        if (ids.some((want) => id.includes(want))) {
          const sel = el.shadowRoot?.querySelector("select");
          if (sel && sel.value !== "enabled") {
            sel.value = "enabled";
            sel.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
            done.push(id);
          }
        }
      }
    });
  };
  walk(document, 0);
  return done;
}, FLAG_IDS);
console.log("[flags] flipped to enabled:", JSON.stringify(flipped));

// List every flags-item id containing 'prompt' so we know the true ids.
const ids = await page.evaluate(() => {
  const out = [];
  const walk = (root, depth) => {
    if (!root || depth > 7) return;
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
      if (el.tagName && el.tagName.toLowerCase() === "flags-item" && /prompt/.test(el.id || "")) out.push(el.id);
    });
  };
  walk(document, 0);
  return out;
});
console.log("[flags] all prompt-related flag ids:", JSON.stringify(ids));

if (flipped.length || ids.length) {
  // Click Relaunch.
  await page.evaluate(() => {
    const walk = (root, depth) => {
      if (!root || depth > 7) return;
      root.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
        const t = (el.textContent || "").trim();
        if ((t === "Relaunch" || t === "重新启动") && el.tagName.toLowerCase() === "cr-button") el.click();
      });
    };
    walk(document, 0);
  });
  console.log("[flags] relaunch clicked");
  await new Promise((r) => setTimeout(r, 6000));
}
try { await browser.close(); } catch {}

// Re-launch after relaunch and probe.
const browser2 = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,900"],
});
const p2 = await browser2.newPage();
await p2.goto("about:blank", { waitUntil: "load" });
const probe = await p2.evaluate(async () => {
  const out = { hasLanguageModel: "LanguageModel" in self };
  if (out.hasLanguageModel) {
    try { out.availability = await LanguageModel.availability(); } catch (e) { out.availabilityError = String(e); }
  }
  return out;
});
console.log("[after-relaunch]", JSON.stringify(probe, null, 2));
await browser2.close();
