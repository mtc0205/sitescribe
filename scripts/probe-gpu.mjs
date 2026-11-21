/** Check chrome://gpu active adapter; call LanguageModel.create() for a verbose error. */
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

const g = await browser.newPage();
await g.goto("chrome://gpu", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2500));
const gpu = await g.evaluate(() => {
  const t = document.body.innerText;
  const grab = (label) => {
    const m = t.match(new RegExp(label + "[^\\n]*\\n([^\\n]*)"));
    return m ? m[1].trim() : null;
  };
  return {
    glVendor: grab("GL_VENDOR"),
    glRenderer: grab("GL_RENDERER"),
    webgl: /WebGL: Hardware accelerated|WebGL: Software only/.exec(t)?.[0] ?? null,
    graphicsFeature: /Graphics Feature Status[\\s\\S]{0,400}/.exec(t)?.[0]?.slice(0, 300) ?? null,
  };
});
console.log("[gpu]", JSON.stringify(gpu, null, 2));
await g.screenshot({ path: "C:\\Users\\user\\Downloads\\盒盒\\contests\\2026-11-20-firebase-buildhybridai\\tools\\gpu.png" });

const p = await browser.newPage();
await p.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
const create = await p.evaluate(async () => {
  try {
    const s = await LanguageModel.create();
    return { ok: true, maxTokens: s.maxTokens, topK: s.topK };
  } catch (e) {
    return { ok: false, name: e?.name, message: e?.message };
  }
});
console.log("[create]", JSON.stringify(create, null, 2));

await browser.close();
