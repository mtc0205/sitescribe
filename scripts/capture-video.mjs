/**
 * Screen-capture harness for the demo video (T5, run #15).
 *
 * Drives the app through the storyboard beats of submission/VIDEO-SCRIPT-EN.md
 * while recording every frame via CDP screencast (Page.startScreencast,
 * everyFrame:true → >=30fps for on-screen activity). Frames land as JPEGs in
 * the shot directory together with a manifest.json (per-frame timestamps, the
 * narration segment each shot maps to, and the target URL).
 *
 * NOT run tonight against simulated states: the final video must be shot
 * against the hosted URL with a real engine. This harness is called then:
 *
 *   node scripts/capture-video.mjs --url https://<project>.web.app \
 *        --out ../tools/video --shots intro,offline-capture,sync,report,engine-panel
 *
 * Shots (see SHOTS below): intro, offline-capture, severity-check, sync,
 * report, engine-panel. `--shots all` records everything in order.
 * Assembly: if ffmpeg is on PATH, `--assemble` converts frames + VO (from
 * ../submission/vo) notes into per-shot MP4s; otherwise the frames/manifest
 * are handed over as-is (honest: no video is assembled from demo mode).
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};
const URL_BASE = opt("url", "http://127.0.0.1:5173"); // default: local dev build
const OUT = path.resolve(ROOT, opt("out", path.join("..", "tools", "video")));
// Shared on-device evidence profile (the Chrome profile that already has the
// Gemini Nano model component downloaded — a fresh profile would re-download
// ~4 GB). Overridable with --profile <dir>.
const PROFILE = opt("profile", path.join(ROOT, "..", "tools", "nano2", "profiles", "E1b"));
const WANTED = (opt("shots", "all") === "all" ? null : opt("shots", "").split(","));
const WIDTH = parseInt(opt("width", "1280"), 10);
const HEIGHT = parseInt(opt("height", "800"), 10);
const ASSEMBLE = args.includes("--assemble");
const NOTE_OFFLINE = "Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long, water seepage with white efflorescence nearby.";
const NOTE_SEVERE = "Spalling with exposed rebar on pier P1, roughly 30 cm patch, active seepage.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- screencast recorder ---------- */

class Recorder {
  constructor(cdp, dir) {
    this.cdp = cdp;
    this.dir = dir;
    this.frames = [];
    this.recording = false;
    this.n = 0;
  }
  async start() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.recording = true;
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 90,
      maxWidth: WIDTH,
      maxHeight: HEIGHT,
      everyFrame: true,
    });
  }
  async stop(meta = {}) {
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    this.recording = false;
    const manifest = {
      url: URL_BASE,
      viewport: { width: WIDTH, height: HEIGHT },
      recordedAt: new Date().toISOString(),
      shot: meta.shot ?? "unnamed",
      narration: meta.narration ?? null,
      frames: this.frames,
      note: "Frames captured via CDP Page.startScreencast (everyFrame:true). Assemble with ffmpeg or --assemble.",
    };
    fs.writeFileSync(path.join(this.dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`[capture] ${meta.shot ?? "unnamed"}: ${this.frames.length} frames → ${this.dir}`);
    this.frames = [];
    this.n = 0;
  }
  async frame({ data, metadata }) {
    if (!this.recording) return;
    const file = `frame_${String(this.n++).padStart(6, "0")}.jpg`;
    fs.writeFileSync(path.join(this.dir, file), Buffer.from(data, "base64"));
    this.frames.push({ file, ts: metadata?.timestamp ?? Date.now() });
  }
}

/* ---------- storyboard shots ---------- */

async function waitFor(page, sel, timeout = 60_000) {
  await page.waitForSelector(sel, { timeout });
}

async function shotIntro(page, rec, ctx) {
  await page.goto(URL_BASE + "/?engine=off", { waitUntil: "load", timeout: 30_000 });
  await waitFor(page, "#project-list .card");
  await rec.start();
  await sleep(2500); // narration: act-1-the-problem-1/2
  await page.click("#project-list .card");
  await waitFor(page, "#note");
  await sleep(2000);
  await rec.stop({ shot: "intro", narration: "act-1-the-problem-1.mp3, act-1-the-problem-2.mp3, beat-1-enter-a-project-1.mp3" });
  ctx.inSession = true;
}

async function shotOfflineCapture(page, rec, ctx) {
  const cdp = ctx.cdp;
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await page.evaluate(() => dispatchEvent(new Event("offline")));
  await sleep(800);
  await rec.start();
  await page.type("#note", NOTE_OFFLINE, { delay: 28 });
  await page.click("#capture-btn");
  await waitFor(page, "#record-list .record .chip.pending, #record-list .record .chip.online", 90_000);
  // second, severe capture — pending sync beat
  await page.type("#note", NOTE_SEVERE, { delay: 24 });
  await page.click("#capture-btn");
  await sleep(4000);
  await rec.stop({ shot: "offline-capture", narration: "beat-2-offline-capture-on-device-engine-1/2 (or act2-beat2-FB), beat-3-a-second-capture-pending-sync-1" });
}

async function shotSeverityCheck(page, rec, ctx) {
  const btn = await page.$("#record-list .record .check-btn");
  if (!btn) { console.log("[capture] no records for severity check — skipping"); return; }
  await rec.start();
  await btn.click();
  await page.waitForFunction(() => {
    const out = document.querySelector("#record-list .record .check-out");
    return out && out.textContent && !/checking/.test(out.textContent);
  }, { timeout: 90_000 });
  await sleep(1500);
  await rec.stop({ shot: "severity-check", narration: "beat-4-severity-cross-check-on-device-1.mp3" });
}

async function shotSync(page, rec, ctx) {
  await ctx.cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 2_000_000, uploadThroughput: 1_000_000 });
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await sleep(600);
  await rec.start();
  await page.click("#sync-btn");
  await page.waitForFunction(() => [...document.querySelectorAll("#record-list .chip.online")].length >= 1, { timeout: 60_000 });
  await sleep(2000);
  await rec.stop({ shot: "sync", narration: "beat-5-back-in-range-1.mp3" });
}

async function shotReport(page, rec, ctx) {
  await rec.start();
  await page.click("#report-btn");
  await page.waitForFunction(() => {
    const out = document.querySelector("#report-out");
    return out && !/drafting/.test(out.textContent ?? "");
  }, { timeout: 120_000 });
  await sleep(2500);
  await rec.stop({ shot: "report", narration: "beat-6-report-drafting-cloud-engine-1.mp3" });
}

async function shotEnginePanel(page, rec, ctx) {
  await page.click("#back");
  await waitFor(page, "#engine-panel");
  await sleep(800);
  await rec.start();
  await page.evaluate(() => document.querySelector("#engine-panel")?.scrollIntoView({ behavior: "smooth" }));
  await sleep(6000); // narration: act-3-how-it-s-built-1 (long)
  await rec.stop({ shot: "engine-panel", narration: "act-3-how-it-s-built-1.mp3, act-4-close-1.mp3" });
}

const SHOTS = {
  intro: shotIntro,
  "offline-capture": shotOfflineCapture,
  "severity-check": shotSeverityCheck,
  sync: shotSync,
  report: shotReport,
  "engine-panel": shotEnginePanel,
};

function hasFfmpeg() {
  return spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;
}

function assemble(dir) {
  if (!hasFfmpeg()) {
    console.log("[capture] ffmpeg not on PATH — leaving frames + manifest only (no assembly).");
    return false;
  }
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return false;
  const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const fps = m.frames.length > 1 ? Math.min(60, Math.max(10, Math.round((m.frames.length - 1) / Math.max(0.001, (m.frames.at(-1).ts - m.frames[0].ts) / 1000)))) : 30;
  const out = path.join(dir, "shot.mp4");
  const r = spawnSync("ffmpeg", ["-y", "-framerate", String(fps), "-i", "frame_%06d.jpg", "-c:v", "libx264", "-pix_fmt", "yuv420p", out], { cwd: dir, encoding: "utf8" });
  console.log(r.status === 0 ? `[capture] assembled ${out} @ ${fps}fps` : "[capture] ffmpeg failed:\n" + r.stderr?.slice(-400));
  return r.status === 0;
}

/* ---------- main ---------- */

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: !args.includes("--headed"), // headless by default: CDP screencast is identical
  userDataDir: PROFILE,
  // Keep Chromium's OptimizationHints stack enabled — puppeteer's default
  // --disable-features list disables it and kills the on-device model. That
  // list is ONE full string, so `ignoreDefaultArgs: ["--disable-features"]`
  // does NOT remove it (A/B verified 2026-11-23); re-enabling through
  // --enable-features does override it (verified).
  args: ["--no-first-run", "--no-default-browser-check", "--enable-features=OptimizationHints", `--window-size=${WIDTH},${HEIGHT + 80}`],
});
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT });
const cdp = await page.createCDPSession();
const ctx = { cdp, inSession: false };

const recorder = new Recorder(cdp, OUT);
cdp.on("Page.screencastFrame", (p) => void recorder.frame(p).then(() => cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {})));

try {
  for (const [name, fn] of Object.entries(SHOTS)) {
    if (WANTED && !WANTED.includes(name)) continue;
    console.log(`[capture] shot ${name} …`);
    recorder.dir = path.join(OUT, name);
    await fn(page, recorder, ctx);
  }
} catch (e) {
  console.error("[capture] shot failed:", e);
} finally {
  await browser.close().catch(() => {});
}

if (ASSEMBLE) {
  for (const name of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) {
    const dir = path.join(OUT, name);
    if (fs.statSync(dir).isDirectory()) assemble(dir);
  }
} else {
  console.log("[capture] frames + manifests written under " + OUT + " (run with --assemble when ffmpeg is available)");
}
