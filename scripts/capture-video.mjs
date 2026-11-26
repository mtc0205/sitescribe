/**
 * Screen-capture harness for the demo video (T5, run #15; assembly reworked
 * run #16, 2026-11-24).
 *
 * Drives the app through the storyboard beats of submission/VIDEO-SCRIPT-EN.md
 * while recording every frame via CDP screencast (Page.startScreencast,
 * everyFrame:true). Frames land as JPEGs in the shot directory together with a
 * manifest.json (per-frame timestamps — CDP reports SECONDS, variable rate: a
 * frame only when the picture changes — plus the narration mapping and URL).
 *
 * The final film must be shot against the HOSTED URL with a real engine:
 *
 *   node scripts/capture-video.mjs --url https://<project>.web.app \
 *        --out ../tools/video --dpr 2 [--shots intro,offline-capture,sync,report,engine-panel]
 *   node scripts/assemble-video.mjs --session ../tools/video            # cut + verify
 *
 * `--assemble` runs the assembler right after the capture and forwards
 * --final / --github-url / --still to it (the assembler itself refuses
 * --final unless the captures came from a hosted https URL).
 *
 * Shots (see SHOTS below): intro, offline-capture, severity-check, sync,
 * report, qa, engine-panel. `--shots all` (default) records everything in order;
 * a shot that fails is reported and skipped, the others still record.
 *
 * Against the hosted URL (https) with a fresh profile the app owns no project:
 * the intro waits for the anonymous sign-in and, when the list is empty, creates
 * one through the UI — ＋ New and its two prompt() dialogs, as a visitor would —
 * before the recorder starts (off camera). The ?engine=off switch is a demo-mode
 * flag, so a hosted run opens the plain URL.
 *
 * --plain-chrome: a throw-away profile and WITHOUT the on-device stack (puppeteer's
 * default --disable-features list keeps it off; this script re-enables it only for
 * the on-device profile). Use it for a run that must not load or download Gemini
 * Nano — on a machine short of RAM, or to show the honest rule-based fallbacks.
 * The default is unchanged: the shared on-device evidence profile, stack enabled.
 *
 * Chrome launch note: the default profile is the shared on-device evidence
 * profile and the launch args keep OptimizationHints enabled — see README
 * "Launching Chrome for on-device runs". Do not change that.
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureServesSiteScribe, resolveBaseUrl } from "./lib/base-url.mjs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};
// Resolved like every other harness (lib/base-url.mjs): --url > --port > $SS_BASE_URL / $SS_PORT
// > the dev-server default. Until 2026-11-27 this script read --url alone, so --port was
// silently ignored and the run went to the default port.
const URL_BASE = resolveBaseUrl(args); // no trailing slash; default: local dev build
const OUT = path.resolve(ROOT, opt("out", path.join("..", "tools", "video")));
// --plain-chrome: never touch the on-device evidence profile, never enable the
// on-device stack (see the header). The temporary profile is removed at the end.
const PLAIN = args.includes("--plain-chrome");
const HOSTED = /^https:\/\//i.test(URL_BASE);
// Shared on-device evidence profile (the Chrome profile that already has the
// Gemini Nano model component downloaded — a fresh profile would re-download
// ~4 GB). Overridable with --profile <dir>.
const PROFILE = PLAIN
  ? fs.mkdtempSync(path.join(os.tmpdir(), "ss-capture-plain-"))
  : opt("profile", path.join(ROOT, "..", "tools", "nano2", "profiles", "E1b"));
// What ＋ New asks for on a hosted run that owns no project yet (name, then structure type).
const PROJECT_NAME = opt("project-name", "Girder Bridge No.3 — Qiantang tributary");
const PROJECT_TYPE = opt("project-type", "bridge");
const WANTED = (opt("shots", "all") === "all" ? null : opt("shots", "").split(","));
const WIDTH = parseInt(opt("width", "1280"), 10);
const HEIGHT = parseInt(opt("height", "800"), 10);
// --dpr 2 records at twice the CSS resolution (2560x1600 for the default
// viewport) so the 1080p cut stays crisp instead of being upscaled.
const DPR = Math.max(1, Math.min(3, Number(opt("dpr", "1")) || 1));
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
    this.marks = [];
    this.recording = false;
    this.n = 0;
  }
  /** Timestamped event inside the shot (same clock base as the frame timestamps). */
  mark(label) {
    if (this.recording) this.marks.push({ label, ts: Date.now() / 1000 });
  }
  async start() {
    fs.mkdirSync(this.dir, { recursive: true });
    // A new take replaces the old one in this directory: no frame of an earlier take may be
    // left beside this one's (listed or not).
    for (const f of fs.readdirSync(this.dir)) if (/^frame_\d+\.jpg$/.test(f) || f === "manifest.json") fs.rmSync(path.join(this.dir, f), { force: true });
    this.writeError = false;
    this.recording = true;
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 90,
      maxWidth: WIDTH * DPR,
      maxHeight: HEIGHT * DPR,
      everyFrame: true,
    });
  }
  /** A take that failed half-way is not footage: stop the screencast, forget its frames and
   *  remove them. Until 2026-11-27 a failed shot left the screencast running, and the next
   *  shot's first frame was written into a directory not made yet — which ended the session. */
  async abort() {
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    this.recording = false;
    this.frames = [];
    this.marks = [];
    this.n = 0;
    try {
      if (fs.existsSync(this.dir)) for (const f of fs.readdirSync(this.dir)) if (/^frame_\d+\.jpg$/.test(f)) fs.rmSync(path.join(this.dir, f), { force: true });
    } catch {
      /* nothing to clean */
    }
  }
  async stop(meta = {}) {
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    this.recording = false;
    const manifest = {
      url: URL_BASE,
      viewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR },
      recordedAt: new Date().toISOString(),
      shot: meta.shot ?? "unnamed",
      narration: meta.narration ?? null,
      frames: this.frames,
      marks: this.marks,
      evidence: meta.evidence ?? null,
      note: "Frames captured via CDP Page.startScreencast (everyFrame:true); ts is the CDP frame timestamp in SECONDS and the rate is variable. Cut with scripts/assemble-video.mjs. 'evidence' quotes the engine/sync badges that were on screen (never invented).",
    };
    fs.writeFileSync(path.join(this.dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`[capture] ${meta.shot ?? "unnamed"}: ${this.frames.length} frames → ${this.dir}`);
    this.frames = [];
    this.marks = [];
    this.n = 0;
  }
  async frame({ data, metadata }) {
    if (!this.recording) return;
    const file = `frame_${String(this.n).padStart(6, "0")}.jpg`;
    try {
      fs.writeFileSync(path.join(this.dir, file), Buffer.from(data, "base64"));
    } catch (e) {
      // A frame that cannot be written must not take the whole session down.
      if (!this.writeError) {
        this.writeError = true;
        console.error(`[capture] could not write a frame into ${this.dir}: ${String(e).slice(0, 160)}`);
      }
      return;
    }
    this.n++;
    this.frames.push({ file, ts: metadata?.timestamp ?? Date.now() });
  }
}

/* ---------- storyboard shots ---------- */

async function waitFor(page, sel, timeout = 60_000) {
  await page.waitForSelector(sel, { timeout });
}

const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, " ").trim() ?? null, sel);

/** What was really on screen when a shot ends — quoted from the DOM, never invented.
 *  Lands in the shot's manifest.json and is echoed by the assembler. */
async function evidence(page, extra = {}) {
  return {
    at: new Date().toISOString(),
    statusChips: await page.evaluate(() => [...document.querySelectorAll(".topbar .chip")].map((c) => c.textContent.replace(/\s+/g, " ").trim())),
    captureBadge: await text(page, "#capture-result .ai-head .chip"),
    newestRecord: await page.evaluate(() => {
      const r = document.querySelector("#record-list .record");
      if (!r) return null;
      return {
        title: r.querySelector("strong")?.textContent ?? null,
        engine: r.querySelector(".record-chips .chip:not(.pending):not(.online)")?.textContent ?? null,
        sync: r.querySelector(".record-chips .chip.pending, .record-chips .chip.online")?.textContent ?? null,
        time: r.querySelector(".record-time")?.textContent ?? null,
      };
    }),
    report: (await text(page, "#report-out"))?.slice(0, 160) ?? null,
    reportBadge: await text(page, "#report-out .ai-head .chip"),
    // An F3 call that failed for any other reason than a timeout or the free-tier
    // refusal is shown as this red block, with no badge (SPEC §6.1.1) — quote it.
    reportError: (await text(page, "#report-out .ai-block.error"))?.slice(0, 400) ?? null,
    ...extra,
  };
}

/**
 * A hosted session with a fresh profile owns no project. Wait until the anonymous
 * sign-in has settled ("No projects yet — …"), and when the list is empty create
 * one through the UI: ＋ New, then its two prompt() dialogs (name, structure type).
 * Returns what the Projects panel said when the sign-in had settled.
 */
async function ensureHostedProject(page) {
  const state = () =>
    page.evaluate(() => ({
      cards: document.querySelectorAll("#project-list .card").length,
      text: document.querySelector("#project-list")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 160) ?? null,
    }));
  let s = null;
  for (let i = 0; i < 120; i++) {
    s = await state();
    if (s.cards || (s.text && !/signing in/i.test(s.text))) break;
    await sleep(500);
  }
  console.log(`[capture]   hosted sign-in settled: ${JSON.stringify(s)}`);
  if (s.cards) return s;
  const answers = [PROJECT_NAME, PROJECT_TYPE];
  const asked = [];
  const onDialog = async (d) => {
    if (d.type() === "prompt" && asked.length < answers.length) {
      asked.push({ question: d.message(), answer: answers[asked.length] });
      await d.accept(answers[asked.length - 1]);
    } else {
      await d.dismiss();
    }
  };
  page.on("dialog", onDialog);
  try {
    await page.click("#new-project");
    await page.waitForFunction(() => document.querySelectorAll("#project-list .card").length > 0, { timeout: 30_000 });
  } finally {
    page.off("dialog", onDialog);
  }
  s = await state();
  console.log(`[capture]   project created through ＋ New: ${JSON.stringify(asked)} → ${JSON.stringify(s)}`);
  return s;
}

/** Scroll smoothly to `toY` over `ms` — real UI motion for long narrations. */
async function slowScroll(page, toY, ms) {
  const fromY = await page.evaluate(() => window.scrollY);
  const steps = Math.max(1, Math.round(ms / 33));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.evaluate((y) => window.scrollTo(0, y), fromY + (toY - fromY) * eased);
    await sleep(ms / steps);
  }
}

async function shotIntro(page, rec, ctx) {
  // ?engine=off is a demo-mode switch (it has no effect in live mode): a hosted run opens the plain URL.
  await page.goto(HOSTED ? URL_BASE + "/" : URL_BASE + "/?engine=off", { waitUntil: "load", timeout: HOSTED ? 60_000 : 30_000 });
  if (HOSTED) await ensureHostedProject(page);
  await waitFor(page, "#project-list .card");
  await sleep(600); // let the engine probe settle so the status chip is not mid-probe
  await rec.start();
  rec.mark("home");
  await sleep(3200); // "This is SiteScribe — an offline-first field inspection companion …"
  rec.mark("enter-project");
  await page.click("#project-list .card");
  await waitFor(page, "#note");
  await sleep(4200); // "An engineer opens today's structure and starts walking …"
  await rec.stop({ shot: "intro", narration: "act-1-the-problem-2.mp3, beat-1-enter-a-project-1.mp3", evidence: await evidence(page) });
  ctx.inSession = true;
}

async function shotOfflineCapture(page, rec, ctx) {
  const cdp = ctx.cdp;
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await page.evaluate(() => dispatchEvent(new Event("offline")));
  await sleep(800);
  const before = await count(page, "#record-list .record");
  const firstBadge = () => text(page, "#capture-result .ai-head .chip");
  await rec.start();
  rec.mark("type-1");
  await page.type("#note", NOTE_OFFLINE, { delay: 45 }); // the dictated note lasts ~9.6 s in the VO
  rec.mark("capture-1-click");
  await page.click("#capture-btn");
  await waitFor(page, "#capture-result .ai-block", 120_000);
  await page.waitForFunction((n) => document.querySelectorAll("#record-list .record").length >= n + 1, { timeout: 30_000 }, before);
  rec.mark("capture-1-result");
  console.log(`[capture]   capture #1 badge: ${await firstBadge()}`);
  await sleep(9000); // "The note becomes a structured defect record …"
  await page.evaluate(() => document.querySelector("#capture-result")?.scrollIntoView({ block: "center", behavior: "smooth" }));
  await sleep(500);
  rec.mark("type-2");
  await page.type("#note", NOTE_SEVERE, { delay: 40 });
  rec.mark("capture-2-click");
  await page.click("#capture-btn");
  await page.waitForFunction((n) => document.querySelectorAll("#record-list .record").length >= n + 2, { timeout: 120_000 }, before);
  rec.mark("capture-2-result");
  console.log(`[capture]   capture #2 badge: ${await firstBadge()}`);
  await sleep(5000); // "Another defect — flagged pending sync …"
  const ev = await evidence(page, { pendingSync: await count(page, "#record-list .chip.pending"), synced: await count(page, "#record-list .chip.online") });
  console.log(`[capture]   pending sync: ${ev.pendingSync} · synced: ${ev.synced}`);
  await rec.stop({ shot: "offline-capture", narration: "beat-2-offline-capture-on-device-engine-1.mp3, beat-2-offline-capture-on-device-engine-2.mp3, beat-3-a-second-capture-pending-sync-1.mp3", evidence: ev });
}

async function shotSeverityCheck(page, rec, ctx) {
  const btn = await page.$("#record-list .record .check-btn"); // the newest record (captured last)
  if (!btn) {
    console.log("[capture] no records for severity check — skipping");
    return;
  }
  await page.evaluate(() => document.querySelector("#record-list .record")?.scrollIntoView({ block: "center" }));
  await sleep(600);
  await rec.start();
  await sleep(1500); // the viewer sees the record before the click
  rec.mark("check-click");
  await btn.click();
  await page.waitForFunction(() => {
    const out = document.querySelector("#record-list .record .check-out");
    return out && out.textContent && !/checking/.test(out.textContent);
  }, { timeout: 90_000 });
  rec.mark("check-result");
  console.log(`[capture]   severity check: ${(await text(page, "#record-list .record .check-out"))?.slice(0, 110)}`);
  await sleep(6000); // "A severity cross-check against a maintenance-standard reference card …"
  await rec.stop({ shot: "severity-check", narration: "beat-4-severity-cross-check-on-device-1.mp3", evidence: await evidence(page, { severityCheck: await text(page, "#record-list .record .check-out") }) });
}

async function shotSync(page, rec, ctx) {
  await ctx.cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 2_000_000, uploadThroughput: 1_000_000 });
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await sleep(600);
  const pendingBefore = await count(page, "#record-list .chip.pending");
  await page.evaluate(() => document.querySelector("#record-list")?.scrollIntoView({ block: "start" }));
  await rec.start();
  await sleep(1200);
  rec.mark("sync-click");
  await page.click("#sync-btn");
  // wait for the real flip (pending → synced), not just for any synced chip. Against the
  // hosted app the Firestore client has to find its way back first, so allow twice as long.
  await page
    .waitForFunction(() => document.querySelectorAll("#record-list .chip.pending").length === 0, { timeout: HOSTED ? 120_000 : 60_000 })
    .catch(() => console.log(`[capture]   sync: not every pending chip flipped within ${HOSTED ? 120 : 60} s`));
  rec.mark("synced");
  const ev = await evidence(page, { pendingBefore, pendingAfter: await count(page, "#record-list .chip.pending"), syncButton: await text(page, "#sync-btn") });
  console.log(`[capture]   sync: pending ${ev.pendingBefore} → ${ev.pendingAfter} · button "${ev.syncButton}"`);
  await sleep(5500); // "Back in range at 5 pm — records sync to Firestore …"
  await rec.stop({ shot: "sync", narration: "beat-5-back-in-range-1.mp3", evidence: ev });
}

async function shotReport(page, rec, ctx) {
  // Into the middle of the viewport, never to the top: the top bar is sticky (61 px), and with
  // the button scrolled to y = 0 the click hit the bar and nothing happened — which is all the
  // "report" take of 2026-11-24 shows (measured 2026-11-27, tools/night-2026-11-27).
  await page.evaluate(() => document.querySelector("#report-btn")?.scrollIntoView({ block: "center" }));
  await sleep(600);
  await rec.start();
  await sleep(1200);
  rec.mark("report-click");
  await page.click("#report-btn");
  // settled = an answer block (badge, report or the red "Report drafting failed: …" block),
  // i.e. anything but the "drafting in cloud…" line. Until 2026-11-27 this tested the text for
  // "drafting" — which the failure block contains too, so a refused cloud call made the shot
  // wait out its whole timeout and fail (seen on the hosted URL, HTTP 429).
  await page.waitForFunction(() => {
    const out = document.querySelector("#report-out");
    return !!out && out.children.length > 0 && !out.querySelector(":scope > .muted");
  }, { timeout: 150_000 });
  rec.mark("report-result");
  const badge = await text(page, "#report-out .ai-head .chip");
  console.log(`[capture]   report badge: ${badge}${badge ? "" : ` · error block: ${(await text(page, "#report-out .ai-block.error"))?.slice(0, 160) ?? "none"}`}`);
  await sleep(8000); // "Now the heavy lifting — drafting today's inspection report …"
  const ev = await evidence(page, { reportBadge: badge });
  await page.evaluate(() => document.querySelector("#report-out")?.scrollIntoView({ block: "start", behavior: "smooth" }));
  await sleep(6000);
  await rec.stop({ shot: "report", narration: "beat-6-report-drafting-cloud-engine-1.mp3", evidence: ev });
}

const NOTE_QA = "What does efflorescence usually indicate?";

/** F2, field Q&A. Not in the shot ↔ narration map (the storyboard has no line for it), so the
 *  assembler does not use it; it is recorded for the evidence: whatever answered the question —
 *  a model, or the honest "no engine" state — is quoted in this shot's manifest. */
async function shotQa(page, rec, ctx) {
  await page.evaluate(() => document.querySelector("#qa-input")?.scrollIntoView({ block: "center" }));
  await sleep(600);
  await rec.start();
  await sleep(1200); // the viewer sees the question box before it is typed
  rec.mark("type-question");
  await page.type("#qa-input", NOTE_QA, { delay: 40 });
  rec.mark("ask-click");
  await page.click("#qa-btn");
  await page.waitForFunction(() => {
    const out = document.querySelector("#qa-out");
    return !!out && out.children.length > 0 && !out.querySelector(":scope > .muted");
  }, { timeout: 150_000 });
  rec.mark("ask-result");
  const badge = await text(page, "#qa-out .ai-head .chip");
  console.log(`[capture]   Q&A badge: ${badge ?? "(none)"} · error block: ${(await text(page, "#qa-out .ai-block.error"))?.slice(0, 120) ?? "none"}`);
  await sleep(6000);
  await rec.stop({ shot: "qa", narration: "(no narration line — F2 is not in the shot map)", evidence: await evidence(page, { qaBadge: badge, qaText: (await text(page, "#qa-out .ai-body"))?.slice(0, 300) ?? null }) });
}

async function shotEnginePanel(page, rec, ctx) {
  await page.click("#back");
  await waitFor(page, "#engine-panel");
  await sleep(800);
  await rec.start();
  await sleep(1500); // the home screen with the badge legend
  rec.mark("legend");
  // Since the 2026-11-24 polish the telemetry sits in a collapsed "Engine &
  // diagnostics" section (the home screen now leads with the product), so open
  // it on camera.
  // "center", so the summary does not end up under the sticky top bar (see shotReport).
  await page.evaluate(() => document.querySelector("#engine-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  await sleep(900);
  await page.click("#engine-panel > summary");
  rec.mark("diagnostics-open");
  const logLines = await count(page, "#engine-log-list .log-row");
  const open = await page.evaluate(() => document.querySelector("#engine-panel")?.open ?? null);
  console.log(`[capture]   engine panel open: ${open} · engine log rows on camera: ${logLines}`);
  await sleep(4000);
  await slowScroll(page, await page.evaluate(() => document.documentElement.scrollHeight), 6000); // through the engine log
  rec.mark("log-scrolled");
  await sleep(3000);
  await slowScroll(page, 0, 9000); // back to the home screen, badge gallery visible
  rec.mark("back-to-top");
  await sleep(9000); // "SiteScribe: structured inspections in dead zones …"
  await rec.stop({ shot: "engine-panel", narration: "act-3-how-it-s-built-1.mp3, act-4-close-1.mp3", evidence: await evidence(page) });
}

const SHOTS = {
  intro: shotIntro,
  "offline-capture": shotOfflineCapture,
  "severity-check": shotSeverityCheck,
  sync: shotSync,
  report: shotReport,
  qa: shotQa,
  "engine-panel": shotEnginePanel,
};

/* ---------- main ---------- */

await ensureServesSiteScribe(URL_BASE);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: !args.includes("--headed"), // headless by default: CDP screencast is identical
  userDataDir: PROFILE,
  // Keep Chromium's OptimizationHints stack enabled — puppeteer's default
  // --disable-features list disables it and kills the on-device model. That
  // list is ONE full string, so `ignoreDefaultArgs: ["--disable-features"]`
  // does NOT remove it (A/B verified 2026-11-23); re-enabling through
  // --enable-features does override it (verified).
  // The window is sized in device pixels so a --dpr 2 capture really yields
  // 2× frames (the screencast cannot exceed the window surface).
  // --plain-chrome leaves that switch out, so the on-device stack stays off (see header).
  args: ["--no-first-run", "--no-default-browser-check", ...(PLAIN ? [] : ["--enable-features=OptimizationHints"]), `--window-size=${WIDTH * DPR},${(HEIGHT + 80) * DPR}`, `--force-device-scale-factor=${DPR}`],
});
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR });
const cdp = await page.createCDPSession();
const ctx = { cdp, inSession: false };

const recorder = new Recorder(cdp, OUT);
cdp.on("Page.screencastFrame", (p) => void recorder.frame(p).then(() => cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {})));

console.log(`[capture] url ${URL_BASE} · viewport ${WIDTH}×${HEIGHT} @${DPR}x · profile ${PROFILE}${PLAIN ? " (plain Chrome: temporary, on-device stack off)" : ""} → ${OUT}`);
const done = [];
const failed = [];
try {
  for (const [name, fn] of Object.entries(SHOTS)) {
    if (WANTED && !WANTED.includes(name)) continue;
    console.log(`[capture] shot ${name} …`);
    recorder.dir = path.join(OUT, name);
    // A failed shot must not cost the others their footage.
    try {
      await fn(page, recorder, ctx);
      done.push(name);
    } catch (e) {
      failed.push(name);
      console.error(`[capture] shot ${name} FAILED: ${String(e).slice(0, 200)}`);
      await recorder.abort(); // the screencast must not run on into the next shot
    }
  }
} finally {
  await browser.close().catch(() => {});
  if (PLAIN) fs.rmSync(PROFILE, { recursive: true, force: true });
}
fs.writeFileSync(path.join(OUT, "session.json"), JSON.stringify({ url: URL_BASE, recordedAt: new Date().toISOString(), viewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR }, profile: PLAIN ? "temporary (plain Chrome, on-device stack off)" : PROFILE, plainChrome: PLAIN, shots: done, failed }, null, 2));
console.log(`[capture] ${done.length} shot(s) recorded${failed.length ? `, FAILED: ${failed.join(", ")}` : ""} → ${OUT}`);

if (ASSEMBLE) {
  const pass = ["--final", "--github-url", "--still", "--fallback", "--preset"].flatMap((f) => {
    const i = args.indexOf(f);
    return i === -1 ? [] : f === "--final" ? [f] : [f, args[i + 1]];
  });
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "assemble-video.mjs"), "--session", OUT, ...pass], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
console.log(`[capture] next: node scripts/assemble-video.mjs --session ${path.relative(ROOT, OUT) || OUT}`);
