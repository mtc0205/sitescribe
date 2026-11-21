/**
 * Diagnose chrome://components DOM: use CDP DOM.getFlattenedDocument with
 * pierce=true so shadow DOM is expanded; locate the node that holds the
 * component NAME and the "Check for update" button, print their tag paths.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = "C:\\Users\\user\\AppData\\Local\\Temp\\ss-probe-profile3";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ["--enable-automation", "--disable-background-networking", "--disable-sync"],
  args: ["--no-first-run", "--no-default-browser-check", "--enable-features=OptimizationGuideOnDeviceModel", "--window-size=1280,1000"],
});

const page = await browser.newPage();
await page.goto("chrome://components", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 4000));

const client = await page.createCDPSession();
const { root } = await client.send("DOM.getDocument", { depth: -1, pierce: true });

// walk flattened tree, print tagName chain for nodes with interesting text
const interesting = [];
function walk(node, path) {
  if (!node) return;
  const tag = node.nodeName?.toLowerCase() ?? "?";
  const text = (node.nodeValue || "").trim();
  const nextPath = path + ">" + tag + (node.attributes?.id ? "#" + node.attributes.id : "");
  if (/optimization|check for update|检查是否有更新|on.device/i.test(text)) {
    interesting.push({ text: text.slice(0, 80), path: nextPath.slice(-180) });
  }
  for (const child of node.children ?? []) walk(child, nextPath);
  for (const child of node.shadowRoots ?? []) walk(child, nextPath + "::shadow");
  if (node.templateContent) walk(node.templateContent, nextPath);
  // text nodes
  for (const child of node.children ?? []) {
    for (const tc of child.children ?? []) {
      if (tc.nodeValue) walk({ nodeName: "#text", nodeValue: tc.nodeValue, children: [] }, nextPath);
    }
  }
}
walk(root, "");

console.log("[interesting nodes]");
for (const i of interesting.slice(0, 40)) console.log(`  ${i.path}\n    text: ${i.text}`);

// Also: outerHTML length + count of each custom tag
const stats = await client.send("DOM.getDocument", { depth: -1, pierce: true }).then(({ root: r2 }) => {
  const counts = {};
  const walk2 = (n) => {
    if (!n) return;
    const t = n.nodeName?.toLowerCase();
    if (t && t.includes("-")) counts[t] = (counts[t] ?? 0) + 1;
    for (const c of n.children ?? []) walk2(c);
    for (const c of n.shadowRoots ?? []) walk2(c);
    for (const c of n.templateContent?.children ?? []) walk2(c);
  };
  walk2(r2);
  return counts;
});
console.log("[custom tags]", JSON.stringify(stats));

await browser.close();
