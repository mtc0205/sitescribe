/**
 * UI screenshot pass + numeric audit for the product-polish review.
 *
 * Captures every screen at 1280x800 and 390x844 (demo mode, engine=off, honest
 * badges, a FRESH profile per run — i.e. exactly what a first-time visitor sees)
 * and, for each screen, prints a WCAG contrast table computed from real
 * computed styles plus a "first screen" audit (what is visible without
 * scrolling). Exits 1 if any checked text falls below 4.5:1.
 *
 * Usage:
 *   node scripts/ui-screens.mjs                       # ../tools/ui-after-*.png
 *   node scripts/ui-screens.mjs --out docs/screenshots --prefix app
 *   node scripts/ui-screens.mjs --port 5187           # dev server on another port
 * Expects `npm run dev` (default port 5173 — see lib/base-url.mjs).
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBaseUrl, ensureServesSiteScribe } from "./lib/base-url.mjs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};
const BASE = resolveBaseUrl();
const URL_BASE = BASE + "/?engine=off";
const SHOTS = path.resolve(ROOT, opt("out", path.join("..", "tools")));
const PREFIX = opt("prefix", "ui-after");
const SIZES = (opt("sizes", "1280x800,390x844")).split(",").map((s) => s.split("x").map(Number));
const ONLY = opt("shots", "").split(",").filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await ensureServesSiteScribe(BASE);
fs.mkdirSync(SHOTS, { recursive: true });

// Fresh profile every run: a first-time visitor's view (no accumulated records).
const PROFILE_DIR = path.join(process.env.TEMP ?? ROOT, "ss-ui-profile-" + Date.now());
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: PROFILE_DIR, // removed again at the end of the script
  args: ["--no-first-run", "--no-default-browser-check", "--force-device-scale-factor=1"],
});

/** Runs inside the page: WCAG contrast of a set of text selectors, from computed styles. */
function auditInPage(selectors) {
  const parse = (c) => {
    if (!c) return null;
    let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(c);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(c);
    if (m) return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255, a: m[4] === undefined ? 1 : +m[4] };
    return null;
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  /** Composite the background chain (element → … → body) bottom-up. */
  const bgOf = (el, pseudo) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) layers.push(parse(getComputedStyle(n).backgroundColor) ?? { r: 0, g: 0, b: 0, a: 0 });
    layers.push({ r: 255, g: 255, b: 255, a: 1 }); // canvas
    let base = layers.pop();
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      const a = l.a;
      base = { r: l.r * a + base.r * (1 - a), g: l.g * a + base.g * (1 - a), b: l.b * a + base.b * (1 - a), a: 1 };
    }
    return base;
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const out = [];
  for (const sel of selectors) {
    const [query, pseudo] = sel.split("::");
    const el = document.querySelector(query);
    if (!el) {
      out.push({ sel, missing: true });
      continue;
    }
    const cs = getComputedStyle(el, pseudo ? "::" + pseudo : null);
    const fg = parse(cs.color);
    const bg = bgOf(el);
    const rect = el.getBoundingClientRect();
    out.push({
      sel,
      ratio: +ratio(fg, bg).toFixed(2),
      fg: cs.color,
      bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
      fontSize: cs.fontSize,
      visible: rect.width > 0 && rect.height > 0,
    });
  }
  return out;
}

/** Runs inside the page: which top-level sections are inside the first viewport. */
function firstScreenInPage() {
  const h = window.innerHeight;
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), fullyIn: r.top >= 0 && r.bottom <= h, partIn: r.top < h && r.bottom > 0 };
  };
  return {
    viewportH: h,
    pageH: document.documentElement.scrollHeight,
    sections: {
      ".topbar": pick(".topbar"),
      ".hero": pick(".hero"),
      "#projects": pick("#projects"),
      "#capture-flow": pick("#capture-flow"),
      "#badge-legend": pick("#badge-legend"),
      ".legend .badge-gallery": pick(".legend .badge-gallery"),
      "#engine-panel": pick("#engine-panel"),
      ".site-footer": pick(".site-footer"),
    },
  };
}

const TEXT_SELECTORS = [
  "body", ".hero h1", ".hero p", ".hero p strong", "#cta-open", ".panel-head h2", ".hint", "#new-project",
  ".card-title", ".card-sub", ".step h3", ".step-n", ".note-bubble", ".step-note", ".legend-title", ".badge-note",
  ".chip.device", ".chip.cloud", ".chip.fallback", ".chip.neutral", ".chip.pending", ".chip.online", ".chip.runtime", ".chip.neutral.engine-chip",
  "#engine-panel > summary", ".diag-summary", ".site-footer", ".site-footer .muted",
];
const SESSION_SELECTORS = [
  "#note", "#note::placeholder", "#capture-btn", "#capture-state", ".session-title", ".session-title .muted",
  "#record-count", "#sync-btn", "#report-btn", ".record-head strong", ".record-component", ".record-meta", ".record-time", ".record-notes",
  ".record .chip.neutral", ".record .chip.device", ".record .chip.online", ".record .chip.pending", ".check-btn",
  "#qa-input", "#qa-input::placeholder", "#qa-btn", ".topbar .chip.offline", ".topbar .chip.online",
];
const DIAG_SELECTORS = [".engine-facts .fact", ".sim-row .muted", ".sim-btn", ".engine-log .log-head", ".engine-log .log-time", ".engine-log code"];

const audit = [];
async function auditPage(page, selectors, tag) {
  const rows = await page.evaluate(auditInPage, selectors);
  for (const r of rows) audit.push({ tag, ...r });
}

async function shoot(name, w, h, fn) {
  if (ONLY.length && !ONLY.includes(name)) return;
  // A fresh incognito context per shot: every screenshot is a first-time
  // visitor's view (no records accumulated by earlier shots).
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: w, height: h });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(URL_BASE, { waitUntil: "load", timeout: 30_000 });
  await page.waitForSelector("#project-list .card", { timeout: 30_000 });
  await page.waitForFunction(() => !/probing/.test(document.querySelector("#engine-facts")?.textContent ?? ""), { timeout: 15_000 }).catch(() => {});
  await fn(page);
  await sleep(350);
  const file = path.join(SHOTS, `${PREFIX}-${name}-${w}x${h}.png`);
  await page.screenshot({ path: file, fullPage: false });
  if (errors.length) console.log(`  [pageerror] ${name}: ${errors.join(" | ")}`);
  console.log(`[ui] ${name} @ ${w}x${h} → ${path.relative(process.cwd(), file)}`);
  await context.close();
}

const NOTE = "Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long, water seepage with white efflorescence nearby.";

for (const [w, h] of SIZES) {
  const tag = `${w}x${h}`;

  await shoot("home", w, h, async (p) => {
    const first = await p.evaluate(firstScreenInPage);
    console.log(`[first-screen ${tag}] ${JSON.stringify(first)}`);
    await auditPage(p, TEXT_SELECTORS, `home ${tag}`);
    await p.screenshot({ path: path.join(SHOTS, `${PREFIX}-home-full-${w}x${h}.png`), fullPage: true });
  });

  await shoot("diagnostics", w, h, async (p) => {
    await p.click("#engine-panel > summary");
    await p.evaluate(() => document.querySelector("#engine-panel")?.scrollIntoView({ block: "center" }));
    await auditPage(p, DIAG_SELECTORS, `diagnostics ${tag}`);
  });

  // Diagnostics once the session has engine events to show (one capture first).
  await shoot("diagnostics-log", w, h, async (p) => {
    await p.click("#project-list .card");
    await p.waitForSelector("#note");
    await p.type("#note", NOTE);
    await p.click("#capture-btn");
    await p.waitForSelector("#capture-result .ai-block", { timeout: 60_000 });
    await p.click("#back");
    await p.waitForSelector("#engine-panel");
    await p.waitForFunction(() => document.querySelectorAll("#engine-log-list .log-row").length >= 1, { timeout: 10_000 });
    await p.click("#engine-panel > summary");
    await p.evaluate(() => document.querySelector("#engine-panel")?.scrollIntoView({ block: "center" }));
    const log = await p.evaluate(() => ({
      rows: document.querySelectorAll("#engine-log-list .log-row").length,
      first: document.querySelector("#engine-log-list .log-row")?.textContent.replace(/\s+/g, " ").trim() ?? null,
      zone: document.querySelector("#log-zone")?.textContent ?? null,
    }));
    console.log(`[engine-log ${tag}] ${JSON.stringify(log)}`);
    await auditPage(p, DIAG_SELECTORS, `diagnostics-log ${tag}`);
  });

  await shoot("session", w, h, async (p) => {
    await p.click("#project-list .card");
    await p.waitForSelector("#note");
    await p.waitForSelector("#record-list .record", { timeout: 15_000 });
    await auditPage(p, SESSION_SELECTORS, `session ${tag}`);
  });

  await shoot("capture", w, h, async (p) => {
    await p.click("#project-list .card");
    await p.waitForSelector("#note");
    await p.type("#note", NOTE);
    await p.click("#capture-btn");
    await p.waitForSelector("#capture-result .ai-block", { timeout: 60_000 });
    // Top-aligned when the whole structured record fits in the first screen (so the project
    // title is not left half-hidden under the sticky top bar); otherwise centre it as before.
    await p.evaluate(() => {
      const el = document.querySelector("#capture-result");
      if (!el) return;
      window.scrollTo(0, 0);
      if (el.getBoundingClientRect().bottom > window.innerHeight - 8) el.scrollIntoView({ block: "center" });
    });
    const st = await p.evaluate(() => ({
      badge: document.querySelector("#capture-result .ai-head .chip")?.textContent ?? null,
      sync: document.querySelector("#record-list .record .chip.pending, #record-list .record .chip.online")?.textContent ?? null,
      time: document.querySelector("#record-list .record-time")?.textContent ?? null,
      engineChip: document.querySelector("#engine-chip")?.textContent ?? null,
    }));
    console.log(`[capture ${tag}] ${JSON.stringify(st)}`);
    await auditPage(p, SESSION_SELECTORS, `capture ${tag}`);
  });
}

await browser.close();
// Remove only the profile this run created (see PROFILE_DIR).
await sleep(500);
try {
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
} catch {
  console.log(`[ui] could not remove the temporary browser profile ${PROFILE_DIR}`);
}

/* ---- contrast verdict ---- */
const rows = audit.filter((r) => !r.missing);
const missing = audit.filter((r) => r.missing).map((r) => `${r.tag}:${r.sel}`);
const seen = new Set();
console.log("\n[contrast] WCAG 2.2 contrast ratio, text vs. its effective background (computed styles)");
for (const r of rows) {
  const key = r.sel + r.fg;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`  ${r.ratio >= 7 ? "AAA" : r.ratio >= 4.5 ? "AA " : "FAIL"} ${String(r.ratio).padStart(6)}:1  ${r.fontSize.padStart(7)}  ${r.sel}   ${r.tag}`);
}
const fail = rows.filter((r) => r.ratio < 4.5);
if (missing.length) console.log(`  (not present on the pages where they were probed: ${missing.join(", ")})`);
console.log(`[contrast] ${rows.length - fail.length}/${rows.length} probes ≥ 4.5:1 (AA); ${rows.filter((r) => r.ratio >= 7).length} ≥ 7:1 (AAA); min = ${Math.min(...rows.map((r) => r.ratio))}:1`);
fs.writeFileSync(path.join(SHOTS, `${PREFIX}-contrast.json`), JSON.stringify(audit, null, 2));
console.log(`[ui] done → ${SHOTS}`);
process.exit(fail.length ? 1 : 0);
