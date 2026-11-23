#!/usr/bin/env node
/**
 * assemble-video.mjs — cut a capture session into the demo film.
 *
 *   node scripts/assemble-video.mjs --session ../tools/video --out ../tools/render.mp4
 *   node scripts/assemble-video.mjs --session ../tools/video-test --allow-missing   # footage that exists only
 *   node scripts/assemble-video.mjs --plan                                          # timeline only, no render
 *
 * What it does, in order
 *   1. reads the words and the shot ↔ narration map from the script markdown
 *      (single source of truth — the same parser make-vo.mjs uses)
 *   2. measures every narration MP3 (decoded length, speech onset/offset)
 *   3. lays out the timeline: every shot lasts exactly its narration (+ pauses)
 *   4. resamples each capture to a constant frame rate BY TIMESTAMP — a CDP
 *      screencast is variable-rate (a frame only when the picture changes).
 *      Footage longer than its narration plays at natural speed and is
 *      trimmed; footage shorter than it is slowed uniformly (never more than
 *      --max-stretch) and the last frame is held for the remainder.
 *   5. mixes the narration clips at their timeline positions, burns the same
 *      lines as subtitles, scales/pads to 1920x1080
 *   6. encodes H.264 + AAC at a constant 30 fps and verifies the result
 *      numerically (duration, frame count, per-segment audio position and
 *      identity, silence between segments) — exit 1 if anything is off.
 *
 * Honesty guards
 *   - Every render is stamped "TEST RENDER — not the final video" in the
 *     corner. Only --final removes the stamp, and --final is refused unless
 *     every capture's manifest was recorded from a hosted https URL and the
 *     cold open + GitHub URL are real: the final film comes from the hosted URL.
 *   - A missing shot is an error, never black frames. --allow-missing skips it
 *     and says so. Without a bridge photo the cold open is a plain title card.
 *
 * Options
 *   --session <dir>   capture session (one sub-directory per shot; default ../tools/video-test)
 *   --out <file.mp4>  default <session>/../<session name>.TEST-RENDER.mp4
 *   --script <md>     default ../submission/VIDEO-SCRIPT-EN.md
 *   --vo <dir>        default ../submission/vo
 *   --ffmpeg <path>   default: $FFMPEG, PATH, then imageio-ffmpeg's bundled binary
 *   --still <name>=<image>   a still for a shot ("cold-open") or a cut-in ("repo")
 *   --fallback        the ⚠FB no-Nano cut (swaps one narration line)
 *   --only a,b        restrict to these shots (quick pipeline tests)
 *   --fps 30 --size 1920x1080 --preset medium --crf 18
 *   --max-stretch 3 --lead 0.6 --gap 0.35 --tail 1.2      (seconds)
 *   --github-url <url>  end card (required with --final)
 *   --plan            print the timeline and exit
 *   --no-verify       skip the numeric verification
 *   --keep-temp       keep the frame sequence / subtitle files
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseNarration, parseShotMap, checkShotMap } from "./lib/script-vo.mjs";
import { sampleFrames, captureSpan, playbackSpeed, resolveBeats, buildTimeline, captionEvents, buildAss, overlayClip, peakOf, pearson, speechBounds, fmtSec } from "./lib/assemble-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (name, dflt) => {
  const i = argv.indexOf("--" + name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};
const all = (name) => argv.flatMap((a, i) => (a === "--" + name && argv[i + 1] ? [argv[i + 1]] : []));

const SESSION = path.resolve(ROOT, opt("session", path.join("..", "tools", "video-test")));
const SCRIPT = path.resolve(ROOT, opt("script", path.join("..", "submission", "VIDEO-SCRIPT-EN.md")));
const VO_DIR = path.resolve(ROOT, opt("vo", path.join("..", "submission", "vo")));
const OUT = path.resolve(ROOT, opt("out", path.join(path.dirname(SESSION), `${path.basename(SESSION)}.TEST-RENDER.mp4`)));
const FINAL = has("--final");
const FALLBACK = has("--fallback");
const ALLOW_MISSING = has("--allow-missing");
const ONLY = opt("only", "").split(",").filter(Boolean);
const FPS = Number(opt("fps", "30"));
const [W, H] = opt("size", "1920x1080").split("x").map(Number);
const PRESET = opt("preset", "medium");
const CRF = opt("crf", "18");
const MAX_STRETCH = Number(opt("max-stretch", "3"));
const GITHUB = opt("github-url", "");
const STILLS = Object.fromEntries(
  all("still").map((s) => {
    const i = s.indexOf("=");
    return i > 0 ? [s.slice(0, i), path.resolve(s.slice(i + 1))] : [s, null];
  }),
);
const TIMING = {
  leadMs: Number(opt("lead", "0.6")) * 1000,
  gapMs: Number(opt("gap", "0.35")) * 1000,
  tailMs: Number(opt("tail", "1.2")) * 1000,
};
const ANALYZE_SR = 16000;
const T0 = Date.now();

function die(msg, code = 2) {
  console.error(`\n[assemble] ${msg}`);
  process.exit(code);
}
const log = (s = "") => console.log(s);
const clock = () => new Date().toTimeString().slice(0, 8);

/* ---------- ffmpeg ---------- */

function findFfmpeg(explicit) {
  const candidates = [];
  if (explicit) candidates.push(path.resolve(explicit));
  if (process.env.FFMPEG) candidates.push(process.env.FFMPEG);
  // imageio-ffmpeg ships a full static build inside a Python site-packages —
  // no install, no PATH change needed. Check the usual places.
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  const sitePackages = [
    path.join(home, "miniconda3", "Lib", "site-packages"),
    path.join(home, "anaconda3", "Lib", "site-packages"),
    path.join(local, "Programs", "Python", "Python*", "Lib", "site-packages"),
    path.join(home, "AppData", "Roaming", "Python", "Python*", "site-packages"),
    process.env.VIRTUAL_ENV ? path.join(process.env.VIRTUAL_ENV, "Lib", "site-packages") : null,
    process.env.CONDA_PREFIX ? path.join(process.env.CONDA_PREFIX, "Lib", "site-packages") : null,
  ].filter(Boolean);
  for (const sp of sitePackages) {
    const roots = sp.includes("*") && typeof fs.globSync === "function" ? fs.globSync(sp) : [sp];
    for (const root of roots) {
      const bin = path.join(root, "imageio_ffmpeg", "binaries");
      if (!fs.existsSync(bin)) continue;
      for (const f of fs.readdirSync(bin)) if (/^ffmpeg.*\.exe$/.test(f)) candidates.push(path.join(bin, f));
    }
  }
  candidates.push("ffmpeg"); // PATH
  for (const c of candidates) {
    const r = spawnSync(c, ["-version"], { encoding: "utf8", timeout: 15_000 });
    if (r.status === 0) return { bin: c, version: (r.stdout.match(/^ffmpeg version (\S+)/m) ?? [])[1] ?? "?" };
  }
  return null;
}

function ff(args, { cwd, quiet = true, timeout = 900_000 } = {}) {
  const r = spawnSync(FFMPEG, quiet ? ["-hide_banner", "-nostdin", ...args] : args, {
    cwd,
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    maxBuffer: 1 << 30,
    timeout,
  });
  return { status: r.status, stdout: r.stdout ?? Buffer.alloc(0), stderr: Buffer.from(r.stderr ?? []).toString("utf8") };
}

/** Decode any audio/video file to mono float32 at `ar` Hz. */
function decodeAudio(file, ar = ANALYZE_SR) {
  const r = ff(["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(ar), "-f", "f32le", "pipe:1"]);
  if (r.status !== 0) throw new Error(`ffmpeg could not decode ${file}: ${r.stderr.slice(-300)}`);
  const b = r.stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

/** What ffmpeg says about a file: duration + stream descriptions. */
function probe(file) {
  const r = ff(["-i", file]); // exits 1 ("At least one output file specified") — stderr is the point
  const s = r.stderr;
  const d = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(s);
  const v = /Stream #\d+:\d+.*?: Video: (\S+).*?, ([\d.]+) fps/.exec(s);
  const sz = /Stream #\d+:\d+.*?: Video:.*?, (\d+)x(\d+)[,\s]/.exec(s);
  const a = /Stream #\d+:\d+.*?: Audio: (\S+).*?, (\d+) Hz, (\w+)/.exec(s);
  return {
    durationMs: d ? ((+d[1] * 3600 + +d[2] * 60 + +d[3]) * 1000) : null,
    videoCodec: v?.[1] ?? null,
    fps: v ? Number(v[2]) : null,
    width: sz ? Number(sz[1]) : null,
    height: sz ? Number(sz[2]) : null,
    audioCodec: a?.[1] ?? null,
    audioHz: a ? Number(a[2]) : null,
    audioLayout: a?.[3] ?? null,
    raw: s,
  };
}

function countFrames(file) {
  const r = ff(["-i", file, "-map", "0:v", "-c", "copy", "-f", "null", "-"]);
  const m = [...r.stderr.matchAll(/frame=\s*(\d+)/g)];
  return m.length ? Number(m.at(-1)[1]) : null;
}

/* ---------- cards & stills ---------- */

const CARDS = {
  title: (final) => [
    ["SiteScribe", "Title"],
    ["Offline-first AI inspection companion", "Sub"],
    ["Structured defect records where there is no signal", "Sub2"],
    final ? "" : "placeholder — no bridge photo supplied (--still cold-open=<photo>)",
  ],
  end: (final) => [
    ["SiteScribe", "Title"],
    ["Structured inspections in dead zones — private by default,", "Sub"],
    ["honest about which AI is running.", "Sub"],
    ["Open source · Apache-2.0", "Sub2"],
    [`Built for Firebase #BuildHybridAI`, "Sub2"],
    GITHUB ? GITHUB : final ? "" : "github.com/<you>/sitescribe  (placeholder — pass --github-url)",
  ],
};

/** A full-frame text card as a JPEG (same size as the capture frames). */
function renderCard(kind, { w, h, tmp, final }) {
  const lines = CARDS[kind](final).map((x) => (Array.isArray(x) ? x : [x, "Foot"])).filter((l) => l[0]);
  const styles = [
    "Style: Title,Segoe UI,96,&H00F4EDE8,&H00F4EDE8,&H0010141A,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,40,40,0,1",
    "Style: Sub,Segoe UI,44,&H00C7B6AA,&H00C7B6AA,&H0010141A,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,40,40,0,1",
    "Style: Sub2,Segoe UI,36,&H00FFB37F,&H00FFB37F,&H0010141A,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,40,40,0,1",
    "Style: Foot,Segoe UI,28,&H0087A0C0,&H0087A0C0,&H0010141A,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,40,40,0,1",
  ];
  // one stacked block of lines, centred on the canvas
  const heights = { Title: 120, Sub: 60, Sub2: 52, Foot: 44 };
  const total = lines.reduce((a, l) => a + heights[l[1]], 0);
  let y = Math.round(h / 2 - total / 2);
  const events = lines.map(([text, style]) => {
    const e = `Dialogue: 0,0:00:00.00,0:00:05.00,${style},,0,0,0,,{\\pos(${Math.round(w / 2)},${y + heights[style] / 2})}${text}`;
    y += heights[style];
    return e;
  });
  const assPath = path.join(tmp, `card-${kind}.ass`);
  fs.writeFileSync(
    assPath,
    ["[Script Info]", "ScriptType: v4.00+", `PlayResX: ${w}`, `PlayResY: ${h}`, "", "[V4+ Styles]", `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding`, ...styles, "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", ...events, ""].join("\n"),
  );
  const out = path.join(tmp, `card-${kind}.jpg`);
  const r = ff(["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=0x10141a:s=${w}x${h}`, "-vf", `ass=${path.basename(assPath)}`, "-frames:v", "1", "-q:v", "2", path.basename(out)], { cwd: tmp });
  if (r.status !== 0 || !fs.existsSync(out)) throw new Error(`could not render the ${kind} card: ${r.stderr.slice(-300)}`);
  return out;
}

let FFMPEG = null;

/* ---------- 1. script ---------- */

if (!fs.existsSync(SCRIPT)) die(`script not found: ${SCRIPT}`);
const md = fs.readFileSync(SCRIPT, "utf8");
const narration = parseNarration(md);
const map = parseShotMap(md);
if (!map) die(`no shot ↔ narration map (a \`\`\`json block with "shots") in ${SCRIPT}`);
const mapProblems = checkShotMap(map, narration);
if (mapProblems.length) die(`the shot ↔ narration map disagrees with the narration:\n  - ${mapProblems.join("\n  - ")}`);
const TEXT = Object.fromEntries(narration.map((s) => [s.id, s.text]));
log(`[assemble] ${clock()} script: ${narration.length} narration lines, ${map.shots.length} shots · cut: ${FALLBACK ? "⚠FB (no Nano)" : "main"}`);

/* ---------- 2. footage ---------- */

const notices = [];
const plan = [];
const captures = [];
for (const s of map.shots) {
  if (ONLY.length && !ONLY.includes(s.shot)) continue;
  const vo = s.vo.map((id) => (FALLBACK && map.alternates?.[id]) || id);
  const dir = path.join(SESSION, s.shot);
  const manifest = path.join(dir, "manifest.json");
  const cutin = map.cutins?.[s.shot] ?? null;
  if (fs.existsSync(manifest)) {
    const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (!Array.isArray(m.frames) || m.frames.length === 0) {
      notices.push(`SKIP ${s.shot}: ${manifest} has no frames`);
      continue;
    }
    plan.push({ shot: s.shot, vo, source: "capture", recMs: captureSpan(m.frames).recMs, frames: m.frames, dir, url: m.url ?? null, cutin, marks: m.marks ?? [], evidence: m.evidence ?? null });
    captures.push(m);
  } else if (STILLS[s.shot] && fs.existsSync(STILLS[s.shot])) {
    plan.push({ shot: s.shot, vo, source: "still", recMs: 0, still: STILLS[s.shot], cutin });
  } else if (s.shot === "cold-open") {
    plan.push({ shot: s.shot, vo, source: "card", card: "title", recMs: 0 });
    notices.push(`COLD OPEN: no capture and no --still cold-open=<photo> — rendering a plain title card`);
  } else if (ALLOW_MISSING) {
    notices.push(`SKIP ${s.shot}: no capture in ${SESSION} and no --still ${s.shot}=<image> (--allow-missing)`);
  } else {
    die(`no footage for shot "${s.shot}" (expected ${manifest}). Record it with scripts/capture-video.mjs, pass --still ${s.shot}=<image>, or add --allow-missing.`);
  }
}
if (!plan.length) die(`nothing to render: ${SESSION} holds none of the mapped shots`);
// The pause after the last narrated line belongs to that shot; then the end card.
const lastNarrated = plan.at(-1);
lastNarrated.tailMs = TIMING.tailMs;
plan.push({ shot: "end-card", vo: [], source: "card", card: "end", holdMs: Number(map.endCardSeconds ?? 4) * 1000, leadMs: 0, tailMs: 0 });

/* ---------- 3. narration audio ---------- */

const found = findFfmpeg(opt("ffmpeg", null));
if (!found) die("ffmpeg not found — pass --ffmpeg <path> or set $FFMPEG (imageio-ffmpeg's bundled build is picked up automatically)");
FFMPEG = found.bin;
log(`[assemble] ffmpeg ${found.version} → ${FFMPEG}`);

const vo = {};
for (const p of plan) {
  for (const id of p.vo) {
    if (vo[id]) continue;
    const file = path.join(VO_DIR, `${id}.mp3`);
    if (!fs.existsSync(file)) die(`narration audio missing: ${file} (run scripts/make-vo.mjs)`);
    const samples = decodeAudio(file);
    vo[id] = { file, samples, durationMs: (samples.length / ANALYZE_SR) * 1000, ...speechBounds(samples, ANALYZE_SR) };
  }
}
const voMs = Object.fromEntries(Object.entries(vo).map(([id, v]) => [id, v.durationMs]));

/* ---------- 4. timeline ---------- */

const timeline = buildTimeline(plan, voMs, { ...TIMING, fps: FPS, maxStretch: MAX_STRETCH });
for (const seg of timeline.segments) seg.text = TEXT[seg.id];

/* ---------- 3b. beats: anchor the on-screen action to the narration ---------- */

// The harness timestamps what happened ("capture-1-result"); the script map
// says which narration moment each mark belongs to. Without marks (older
// captures) a shot falls back to the uniform stretch policy.
for (const [i, s] of timeline.shots.entries()) {
  const p = plan[i];
  if (p.source !== "capture") continue;
  const alias = (id) => (FALLBACK && map.alternates?.[id]) || id; // the ⚠FB cut renames one line
  const spec = (map.beats?.[s.shot] ?? []).map((b) => ({ ...b, ...(b.at ? { at: alias(b.at) } : {}), ...(b.into ? { into: alias(b.into) } : {}) }));
  if (!spec.length) continue;
  const { anchors, notes } = resolveBeats(spec, p.marks, timeline.segments, s.startMs, s.durationMs, captureSpan(p.frames));
  p.anchors = anchors;
  for (const n of notes) notices.push(`${s.shot}: ${n}`);
  s.anchored = anchors.length - 2;
  if (FINAL && s.anchored === 0) notices.push(`${s.shot}: no beat could be anchored (the capture has no marks)`);
}

const narrated = timeline.totalMs - Number(map.endCardSeconds ?? 4) * 1000;
log(`\n[assemble] timeline — ${timeline.shots.length} shots, ${timeline.totalFrames} frames, ${fmtSec(timeline.totalMs)} (narration ${fmtSec(narrated)}; hard cap 3:00)`);
log("  shot             source    recorded   retiming              out frames   start → end   narration");
for (const [i, s] of timeline.shots.entries()) {
  const p = plan[i];
  let speedTxt = "—";
  if (p.source === "capture") {
    const speed = playbackSpeed({ recMs: p.recMs, outDurMs: s.durationMs, maxStretch: MAX_STRETCH });
    speedTxt = s.anchored
      ? `beats (${s.anchored} anchors)`
      : p.recMs > s.durationMs ? "1.00× trimmed" :
      p.recMs * MAX_STRETCH < s.durationMs ? `${(1 / speed).toFixed(1)}× slower + hold` :
      speed < 0.995 ? `${(1 / speed).toFixed(2)}× slower` : "1.00×";
  }
  log(`  ${s.shot.padEnd(16)} ${p.source.padEnd(9)} ${(p.recMs / 1000 || 0).toFixed(1).padStart(7)}s   ${speedTxt.padEnd(21)} ${String(s.nFrames).padStart(8)}     ${fmtSec(s.startMs).padStart(5)} → ${fmtSec(s.startMs + s.durationMs).padStart(5)}   ${s.vo.map((v) => v.id).join(", ") || "—"}`);
}
for (const seg of timeline.segments) {
  const v = vo[seg.id];
  log(`     · ${fmtSec(seg.startMs).padStart(5)} → ${fmtSec(seg.endMs).padStart(5)}  ${seg.id}  (${fmtSec(seg.durationMs)}, speech ${v.onsetMs == null ? "none" : `+${v.onsetMs}ms…${v.offsetMs}ms`})`);
}
if (timeline.totalMs > 180_000) notices.push(`OVER 3:00 — the film is ${fmtSec(timeline.totalMs)}; the hackathon cap is 3:00`);

// What was really on screen (quoted by the harness from the DOM) — echoed, never invented.
const badges = [];
for (const p of plan) {
  const ev = p.evidence;
  if (!ev) continue;
  const onScreen = [ev.captureBadge, ev.newestRecord?.engine, ev.reportBadge].filter(Boolean);
  badges.push(...onScreen);
  log(`  on camera in ${p.shot}: status [${(ev.statusChips ?? []).join("] [")}] · capture badge "${ev.captureBadge ?? "—"}" · newest record ${ev.newestRecord ? `${ev.newestRecord.engine} / ${ev.newestRecord.sync} / ${ev.newestRecord.time}` : "—"}`);
}
const simulated = badges.filter((b) => /simulated/i.test(b));
const ruleBased = badges.filter((b) => /rule-based/i.test(b));

const hosted = captures.length > 0 && captures.every((m) => /^https:\/\//.test(m.url ?? "") && !/localhost|127\.0\.0\.1/.test(m.url ?? ""));
const sources = [...new Set(captures.map((m) => m.url ?? "(url not recorded)"))].join(", ") || "no captures";
const missingCutins = plan.filter((p) => p.cutin && !(STILLS[p.cutin.name] && fs.existsSync(STILLS[p.cutin.name]))).map((p) => `${p.shot}→"${p.cutin.name}"`);

if (FINAL) {
  const why = [];
  if (!hosted) why.push(`the captures are not from a hosted https URL (${sources})`);
  if (notices.some((n) => n.startsWith("SKIP"))) why.push("shots are missing");
  if (plan.some((p) => p.source === "card" && p.card === "title")) why.push("the cold open is a placeholder title card (pass --still cold-open=<photo>)");
  if (!GITHUB) why.push("--github-url <url> is required for the end card");
  if (missingCutins.length) why.push(`cut-in stills missing: ${missingCutins.join(", ")}`);
  if (simulated.length) why.push(`simulated badges are on camera: ${simulated.join(" | ")} — the final film needs real engines`);
  if (why.length) die(`refusing --final — the final film must be complete and shot on the hosted URL:\n  - ${why.join("\n  - ")}`);
}
if (ruleBased.length && !FINAL) notices.push(`rule-based fallback is on camera (${ruleBased.length} badge${ruleBased.length === 1 ? "" : "s"}) — honest, but not what the final film should show`);
const LABEL = FINAL ? "" : `TEST RENDER — not the final video · captured from ${sources}`;
fs.writeFileSync(`${OUT}.plan.json`, JSON.stringify({ generatedAt: new Date().toISOString(), session: SESSION, script: SCRIPT, out: OUT, final: FINAL, label: LABEL, notices, fps: FPS, size: [W, H], shots: timeline.shots.map((s, i) => ({ ...s, source: plan[i].source, url: plan[i].url ?? null, anchors: (plan[i].anchors ?? []).map((a) => ({ mark: a.mark, atMs: Math.round(s.startMs + a.out) })), evidence: plan[i].evidence ?? null })), segments: timeline.segments.map((s) => ({ ...s, text: TEXT[s.id], speech: { onsetMs: vo[s.id].onsetMs, offsetMs: vo[s.id].offsetMs } })), totalFrames: timeline.totalFrames, totalMs: timeline.totalMs }, null, 2));
log(`\n[assemble] plan written → ${OUT}.plan.json`);
for (const n of notices) log(`[assemble] note: ${n}`);
if (has("--plan")) process.exit(0);

/* ---------- 5. frame sequence + subtitles ---------- */

const tmp = path.join(path.dirname(OUT), `.assemble-${path.basename(OUT).replace(/\.mp4$/i, "")}`);
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.join(tmp, "frames"), { recursive: true });

// Every frame must share one size (the image2 demuxer feeds a single stream).
const firstCapture = plan.find((p) => p.source === "capture");
let [fw, fh] = [W, H];
if (firstCapture) {
  const pr = probe(path.join(firstCapture.dir, firstCapture.frames[0].file));
  if (pr.width && pr.height) [fw, fh] = [pr.width, pr.height];
}
log(`[assemble] ${clock()} frame sequence: ${timeline.totalFrames} frames at ${FPS} fps (capture ${fw}×${fh} → ${W}×${H})`);

const normalized = new Map();
function normalizeStill(file) {
  if (normalized.has(file)) return normalized.get(file);
  const out = path.join(tmp, `still-${normalized.size}.jpg`);
  const fit = `scale=${fw}:${fh}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${fw}:${fh}:(ow-iw)/2:(oh-ih)/2:color=0x10141a,setsar=1`;
  const r = ff(["-v", "error", "-y", "-i", file, "-vf", fit, "-frames:v", "1", "-q:v", "2", out]);
  if (r.status !== 0) die(`could not read still ${file}: ${r.stderr.slice(-300)}`);
  normalized.set(file, out);
  return out;
}

const sequence = [];
for (const [i, s] of timeline.shots.entries()) {
  const p = plan[i];
  let files;
  if (p.source === "capture") {
    files = sampleFrames(p.frames, s.nFrames, { outDurMs: s.durationMs, maxStretch: MAX_STRETCH, anchors: p.anchors }).map((f) => path.join(p.dir, f));
    if (p.anchors) {
      log(`[assemble] ${s.shot} beats: ` + p.anchors.slice(1, -1).map((a) => `${a.mark} @${fmtSec(s.startMs + a.out)}`).join(" · "));
    }
  } else {
    const one = p.source === "still" ? normalizeStill(p.still) : renderCard(p.card, { w: fw, h: fh, tmp, final: FINAL });
    files = new Array(s.nFrames).fill(one);
  }
  if (p.cutin) {
    if (STILLS[p.cutin.name] && fs.existsSync(STILLS[p.cutin.name])) {
      const still = normalizeStill(STILLS[p.cutin.name]);
      const from = Math.min(s.nFrames - 1, Math.max(0, Math.round(p.cutin.at * s.nFrames)));
      for (let k = from; k < s.nFrames; k++) files[k] = still;
      log(`[assemble] cut-in "${p.cutin.name}" in ${s.shot} from ${fmtSec(s.startMs + (from / s.nFrames) * s.durationMs)}`);
    } else if (!FINAL) {
      log(`[assemble] note: no --still ${p.cutin.name}=<image> for the cut-in in ${s.shot} — staying on the captured footage`);
    }
  }
  sequence.push(...files);
}
if (sequence.length !== timeline.totalFrames) die(`internal: ${sequence.length} frames queued, timeline says ${timeline.totalFrames}`);

// Hard-link (copy across volumes) the frames into one numbered sequence.
let linked = 0;
for (let i = 0; i < sequence.length; i++) {
  const dst = path.join(tmp, "frames", `f_${String(i).padStart(6, "0")}.jpg`);
  try {
    fs.linkSync(sequence[i], dst);
    linked++;
  } catch {
    fs.copyFileSync(sequence[i], dst);
  }
}
log(`[assemble] ${clock()} ${sequence.length} frames queued (${linked} hard links, ${sequence.length - linked} copies) · distinct captured frames used: ${new Set(sequence).size}`);

const captions = captionEvents(timeline);
fs.writeFileSync(path.join(tmp, "subs.ass"), buildAss({ captions, totalMs: timeline.totalMs, label: LABEL, playResX: W, playResY: H }));
log(`[assemble] subtitles: ${captions.length} caption events from ${timeline.segments.length} narration lines${LABEL ? " · corner label ON" : " · corner label OFF (--final)"}`);

/* ---------- 6. narration mix + encode ---------- */

// The narration track is mixed here, sample-accurately: every clip is decoded
// to 48 kHz stereo and overlaid at its timeline position. (ffmpeg's amix was
// tried first and altered later clips — correlation with the source dropped to
// 0.2–0.5 while the first clip stayed 1.000.)
const MIX_SR = 48000;
const mix = new Float32Array(Math.round((timeline.totalMs / 1000) * MIX_SR) * 2);
for (const seg of timeline.segments) {
  const r = ff(["-v", "error", "-i", vo[seg.id].file, "-vn", "-ac", "2", "-ar", String(MIX_SR), "-f", "f32le", "pipe:1"]);
  if (r.status !== 0) die(`ffmpeg could not decode ${vo[seg.id].file}: ${r.stderr.slice(-300)}`);
  const clip = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength));
  overlayClip(mix, clip, Math.round((seg.startMs / 1000) * MIX_SR));
}
const mixFile = path.join(tmp, "narration.f32");
fs.writeFileSync(mixFile, Buffer.from(mix.buffer, mix.byteOffset, mix.byteLength));
log(`[assemble] ${clock()} narration mixed: ${timeline.segments.length} clips, peak ${peakOf(mix)} (no clipping if ≤ 1.0)`);

const inputs = [
  "-f", "image2", "-framerate", String(FPS), "-i", path.join(tmp, "frames", "f_%06d.jpg"),
  "-f", "f32le", "-ar", String(MIX_SR), "-ac", "2", "-i", mixFile,
];
const totalSec = (timeline.totalMs / 1000).toFixed(4);
// in_range=full: every frame of the sequence is a JPEG (yuvj420p, full range);
// saying so explicitly keeps the dark theme from shifting levels on the way to yuv420p.
const filters = [`[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos:in_range=full:out_range=tv,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x10141a,setsar=1,ass=subs.ass,format=yuv420p[v]`];
const encodeArgs = [
  "-y", "-hide_banner", "-loglevel", "warning", "-stats",
  ...inputs,
  "-filter_complex", filters.join(";"),
  "-map", "[v]", "-map", "1:a",
  "-t", totalSec,
  "-r", String(FPS),
  "-c:v", "libx264", "-preset", PRESET, "-crf", CRF, "-profile:v", "high", "-pix_fmt", "yuv420p", "-g", String(FPS * 2),
  "-af", "aresample=48000",
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
  "-movflags", "+faststart",
  OUT,
];
log(`[assemble] ${clock()} encoding ${fmtSec(timeline.totalMs)} → ${OUT}`);
const enc = ff(encodeArgs, { cwd: tmp, quiet: false });
if (enc.status !== 0) die(`ffmpeg failed (exit ${enc.status})`);
log(`[assemble] ${clock()} encoded: ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB`);

if (has("--no-verify")) {
  log("[assemble] --no-verify: skipping the numeric verification");
  process.exit(0);
}

/* ---------- 7. verification ---------- */

log(`\n[verify] ${clock()} measuring ${OUT}`);
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

const info = probe(OUT);
const frameMs = 1000 / FPS;
check("duration matches the timeline (± 1 frame)", info.durationMs != null && Math.abs(info.durationMs - timeline.totalMs) <= frameMs + 1, `file ${fmtSec(info.durationMs ?? 0)} vs plan ${fmtSec(timeline.totalMs)} (Δ ${info.durationMs == null ? "?" : (info.durationMs - timeline.totalMs).toFixed(0)} ms)`);
const n = countFrames(OUT);
check("frame count matches the plan", n === timeline.totalFrames, `${n} frames vs ${timeline.totalFrames}`);
check("video is H.264 at the requested size and frame rate", info.videoCodec === "h264" && info.width === W && info.height === H && info.fps === FPS, `${info.videoCodec} ${info.width}×${info.height} ${info.fps} fps`);
check("audio is AAC 48 kHz stereo", info.audioCodec === "aac" && info.audioHz === 48000 && info.audioLayout === "stereo", `${info.audioCodec} ${info.audioHz} Hz ${info.audioLayout}`);

const out = decodeAudio(OUT);
const s2i = (ms) => Math.round((ms / 1000) * ANALYZE_SR);

function activeWindows(samples, fromMs, toMs) {
  return speechBounds(samples.subarray(s2i(fromMs), s2i(toMs)), ANALYZE_SR);
}

const sync = [];
let worstLag = 0;
for (const [i, seg] of timeline.segments.entries()) {
  const clip = vo[seg.id].samples;
  // best alignment of the clip inside a ±150 ms window around the planned start
  const probeLen = Math.min(clip.length, s2i(3000));
  let best = { lag: 0, r: -1 };
  for (let lag = -150; lag <= 150; lag += 5) {
    const at = s2i(seg.startMs + lag);
    const r = pearson(out.subarray(at, at + probeLen), clip.subarray(0, probeLen));
    if (r > best.r) best = { lag, r };
  }
  const at = s2i(seg.startMs + best.lag);
  const whole = pearson(out.subarray(at, at + clip.length), clip);
  // where does speech actually start/end in the output around the planned slot?
  // (the window stops before the next line starts, or that line's onset would
  // be mistaken for this line's tail)
  const next = timeline.segments[i + 1];
  const from = seg.startMs - 200;
  const to = Math.min(seg.endMs + 250, next ? next.startMs : Infinity);
  const w = activeWindows(out, from, to);
  const expOnset = seg.startMs + (vo[seg.id].onsetMs ?? 0);
  const expOffset = seg.startMs + (vo[seg.id].offsetMs ?? seg.durationMs);
  const detOnset = w.onsetMs == null ? null : from + w.onsetMs;
  const detOffset = w.offsetMs == null ? null : from + w.offsetMs;
  worstLag = Math.max(worstLag, Math.abs(best.lag));
  sync.push({ id: seg.id, shot: seg.shot, plannedStartMs: Math.round(seg.startMs), plannedEndMs: Math.round(seg.endMs), durationMs: Math.round(seg.durationMs), lagMs: best.lag, identity: +best.r.toFixed(3), identityWhole: +whole.toFixed(3), speechOnsetErrorMs: detOnset == null ? null : Math.round(detOnset - expOnset), speechOffsetErrorMs: detOffset == null ? null : Math.round(detOffset - expOffset) });
}
log("\n  narration segment                               planned start → end     lag     identity  speech onset/end error");
for (const s of sync) {
  log(`  ${s.id.padEnd(45)} ${fmtSec(s.plannedStartMs).padStart(6)} → ${fmtSec(s.plannedEndMs).padStart(6)}   ${String(s.lagMs).padStart(4)} ms   ${s.identity.toFixed(3)}      ${s.speechOnsetErrorMs ?? "—"} / ${s.speechOffsetErrorMs ?? "—"} ms`);
}
check("every narration clip sits within ±100 ms of its planned position", sync.length > 0 && sync.every((s) => Math.abs(s.lagMs) <= 100), `worst |lag| ${sync.reduce((a, s) => Math.max(a, Math.abs(s.lagMs)), 0)} ms`);
check("the clip in each slot is the planned clip (correlation ≥ 0.90)", sync.every((s) => s.identity >= 0.9 && s.identityWhole >= 0.9), `min identity ${Math.min(...sync.map((s) => Math.min(s.identity, s.identityWhole))).toFixed(3)}`);
check("speech starts where the clip's own speech starts (±100 ms)", sync.every((s) => s.speechOnsetErrorMs != null && Math.abs(s.speechOnsetErrorMs) <= 100), sync.map((s) => `${s.id.slice(0, 18)}:${s.speechOnsetErrorMs ?? "none"}`).join(" "));

// silence between consecutive segments and outside the narration
const silentSpans = [];
const sorted = [...timeline.segments].sort((a, b) => a.startMs - b.startMs);
silentSpans.push({ name: "head (before the first line)", from: 0, to: sorted[0].startMs + (vo[sorted[0].id].onsetMs ?? 0) });
for (let i = 1; i < sorted.length; i++) {
  silentSpans.push({ name: `gap ${sorted[i - 1].id.slice(0, 14)} → ${sorted[i].id.slice(0, 14)}`, from: sorted[i - 1].startMs + (vo[sorted[i - 1].id].offsetMs ?? 0), to: sorted[i].startMs + (vo[sorted[i].id].onsetMs ?? 0) });
}
const lastSeg = sorted.at(-1);
silentSpans.push({ name: "tail + end card (after the last line)", from: lastSeg.startMs + (vo[lastSeg.id].offsetMs ?? 0), to: timeline.totalMs });
const loudGaps = [];
for (const g of silentSpans) {
  const from = g.from + 40;
  const to = g.to - 40;
  if (to - from < 120) continue;
  const w = activeWindows(out, from, to);
  if (w.onsetMs != null) loudGaps.push(`${g.name}: speech at ${fmtSec(from + w.onsetMs)}`);
}
check("no narration bleeds into the pauses, the head or the end card", loudGaps.length === 0, loudGaps.length ? loudGaps.join("; ") : `${silentSpans.length} silent spans checked`);

// frames for eyes: first frame of every shot + the middle of every narration line
const frameDir = path.join(path.dirname(OUT), `${path.basename(OUT, ".mp4")}-frames`);
fs.rmSync(frameDir, { recursive: true, force: true });
fs.mkdirSync(frameDir, { recursive: true });
const grab = (tMs, name) => {
  const file = path.join(frameDir, `${name}.jpg`);
  ff(["-v", "error", "-y", "-ss", (tMs / 1000).toFixed(3), "-i", OUT, "-frames:v", "1", "-q:v", "3", file]);
  return file;
};
let k = 0;
const shots = timeline.shots;
for (const [i, s] of shots.entries()) {
  grab(s.startMs + frameMs / 2, `${String(++k).padStart(2, "0")}_shot-start_${s.shot}_${fmtSec(s.startMs).replace(":", "m")}`);
  const segs = timeline.segments.filter((x) => x.shot === s.shot);
  for (const seg of segs) grab((seg.startMs + seg.endMs) / 2, `${String(++k).padStart(2, "0")}_caption_${seg.id.slice(0, 30)}_${fmtSec(seg.startMs).replace(":", "m")}`);
}
grab(timeline.totalMs - frameMs, `${String(++k).padStart(2, "0")}_last-frame`);

const failed = checks.filter((c) => !c.ok);
const report = {
  generatedAt: new Date().toISOString(),
  file: OUT,
  label: LABEL,
  plan: { totalFrames: timeline.totalFrames, totalMs: timeline.totalMs, fps: FPS, size: [W, H] },
  measured: { durationMs: info.durationMs, frames: n, video: `${info.videoCodec} ${info.width}×${info.height} ${info.fps}fps`, audio: `${info.audioCodec} ${info.audioHz}Hz ${info.audioLayout}` },
  sync,
  silentSpans: silentSpans.length,
  checks,
  ok: failed.length === 0,
  framesForReview: frameDir,
};
fs.writeFileSync(`${OUT}.verify.json`, JSON.stringify(report, null, 2));
log(`\n[verify] ${checks.length - failed.length}/${checks.length} checks passed in ${((Date.now() - T0) / 1000).toFixed(0)} s · report → ${OUT}.verify.json · frames for review → ${frameDir}`);
if (!has("--keep-temp")) fs.rmSync(tmp, { recursive: true, force: true });
log(LABEL ? `[assemble] ${LABEL}` : "[assemble] FINAL render (label removed by --final)");
process.exit(failed.length ? 1 : 0);
