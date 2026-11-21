/** Enumerate AI-related globals in Chrome and inspect chrome://version flags. */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile2";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  args: [
    "--enable-features=PromptAPIMultimodalInput,PromptAPIForGeminiNano,AIPromptAPI",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,900",
  ],
});

const page = await browser.newPage();
await page.goto("about:blank", { waitUntil: "load" });

const globals = await page.evaluate(() => {
  const interesting = ["LanguageModel", "Translator", "LanguageDetector", "Writer", "Rewriter", "Summarizer", "Prompt", "ai", "AI", "OriginTrials", "credentialless"];
  const found = {};
  for (const k of interesting) found[k] = k in self;
  return { found, allKeys: Object.getOwnPropertyNames(self).filter((k) => /model|prompt|gemini|ai/i.test(k)).slice(0, 30) };
});
console.log("[probe2]", JSON.stringify(globals, null, 2));

const ver = await browser.newPage();
await ver.goto("chrome://version", { waitUntil: "load" });
const cmdline = await ver.evaluate(() => {
  const el = document.querySelector("#command_line") ?? document.body;
  return el.textContent.slice(0, 600);
});
console.log("[probe2] command_line:", cmdline);

const flags = await browser.newPage();
await flags.goto("chrome://flags", { waitUntil: "load" });
// Search the flags list for anything mentioning "prompt" or "gemini" or "on-device".
const flagHits = await flags.evaluate(() => {
  const out = [];
  document.querySelectorAll("flags-app").length; // shadow DOM
  const root = document.querySelector("flags-app")?.shadowRoot;
  const items = root ? root.querySelectorAll("flags-item") : [];
  items.forEach((it) => {
    const t = it.textContent || "";
    if (/prompt|gemini|nano|on.?device/i.test(t)) out.push(t.replace(/\s+/g, " ").slice(0, 160));
  });
  return out.slice(0, 20);
});
console.log("[probe2] matching chrome://flags entries:", JSON.stringify(flagHits, null, 2));

await browser.close();
