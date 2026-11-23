/**
 * Unit tests for scripts/lib/assemble-core.mjs — the timeline maths behind the
 * film assembly (constant-frame-rate resampling by timestamp, VO placement,
 * captions). Pure functions: nothing here touches ffmpeg.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sourceTimeAt,
  playbackSpeed,
  captureSpan,
  resolveBeats,
  sourceTimeAtBeats,
  sampleFrames,
  buildTimeline,
  chunkCaption,
  wrapCaption,
  captionEvents,
  overlayClip,
  peakOf,
  assTime,
  buildAss,
  pearson,
  speechBounds,
  fmtSec,
} from "../scripts/lib/assemble-core.mjs";

const S = 1_795_375_000; // epoch seconds of a CDP screencast timestamp

/** A variable-rate capture: 0.1 s bursts at 60 fps separated by 1 s of stillness (≈ what CDP emits). */
function vfrFrames() {
  const out = [];
  let n = 0;
  for (let b = 0; b < 4; b++) {
    for (let i = 0; i < 6; i++) out.push({ file: `f_${String(n++).padStart(3, "0")}.jpg`, ts: S + b * 1.1 + i * 0.0167 });
  }
  return out;
}

test("sourceTimeAt: slow motion when the narration is longer (ratio within the stretch limit)", () => {
  const span = { t0: 0, t1: 10_000, recMs: 10_000, outDurMs: 20_000, maxStretch: 3 };
  assert.equal(sourceTimeAt(0, span), 0);
  assert.equal(sourceTimeAt(10_000, span), 5_000); // 2× slower
  assert.ok(Math.abs(sourceTimeAt(19_999, span) - 9_999.5) < 1e-6);
});

test("sourceTimeAt: beyond the stretch limit the last frame is held (padding)", () => {
  const span = { t0: 1_000, t1: 2_000, recMs: 1_000, outDurMs: 10_000, maxStretch: 3 }; // would need 10×
  assert.ok(Math.abs(sourceTimeAt(2_999, span) - (1_000 + 2_999 / 3)) < 1e-6); // 3× slower
  assert.equal(sourceTimeAt(3_000, span), 2_000); // end of the 3× stretch
  assert.equal(sourceTimeAt(9_999, span), 2_000); // hold on the last frame
});

test("sourceTimeAt: a recording longer than its narration plays at natural speed and is trimmed", () => {
  const span = { t0: 0, t1: 30_000, recMs: 30_000, outDurMs: 10_000, maxStretch: 3 };
  assert.equal(sourceTimeAt(5_000, span), 5_000); // 1:1, no speed-up
  assert.equal(sourceTimeAt(9_999, span), 9_999);
});

test("sampleFrames: turns a variable-rate capture into exactly N frames, timestamps never go backwards", () => {
  const frames = vfrFrames(); // 24 frames over 3.25 s, mean ≈ 7 fps in bursts
  const outFrames = 300; // 10 s at 30 fps
  const files = sampleFrames(frames, outFrames, { outDurMs: 10_000, maxStretch: 3 });
  assert.equal(files.length, 300);
  assert.equal(new Set(files).size, 24); // every captured frame is used
  const idx = files.map((f) => frames.findIndex((x) => x.file === f));
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i] >= idx[i - 1], "frame order must be monotonic");
  assert.equal(files[299], "f_023.jpg"); // ends on the last captured frame (3.25 s × 3 < 10 s → hold)
});

test("sampleFrames: 1:1 case picks by timestamp (latest frame ≤ source time)", () => {
  const frames = [
    { file: "a.jpg", ts: S },
    { file: "b.jpg", ts: S + 0.5 },
    { file: "c.jpg", ts: S + 1.0 },
  ];
  // 1 s of output at 10 fps from 1 s of capture → natural speed
  const out = sampleFrames(frames, 10, { outDurMs: 1_000, maxStretch: 3 });
  assert.deepEqual(out, ["a.jpg", "a.jpg", "a.jpg", "a.jpg", "a.jpg", "b.jpg", "b.jpg", "b.jpg", "b.jpg", "b.jpg"]);
});

test("sampleFrames: a single captured frame is a still image", () => {
  const out = sampleFrames([{ file: "only.png", ts: S }], 90, { outDurMs: 3_000, maxStretch: 3 });
  assert.equal(out.length, 90);
  assert.ok(out.every((f) => f === "only.png"));
});

test("captureSpan: the last captured frame gets one average frame interval of screen time", () => {
  const span = captureSpan([
    { file: "a.jpg", ts: S },
    { file: "b.jpg", ts: S + 0.5 },
  ]);
  assert.equal(span.tEnd - span.t1, 200); // mean interval 500 ms is capped at 200
  assert.equal(span.recMs, 700); // 500 ms between the two frames + the 200 ms hold
  const burst = captureSpan(vfrFrames());
  assert.ok(Math.abs(burst.recMs - (3383.5 + 147.1)) < 2, String(burst.recMs)); // 24 frames over 3.3835 s → mean interval ≈147 ms (ms units)
});

test("playbackSpeed: natural / slowed / capped", () => {
  assert.equal(playbackSpeed({ recMs: 30_000, outDurMs: 10_000, maxStretch: 3 }), 1); // longer footage: trimmed, never sped up
  assert.equal(playbackSpeed({ recMs: 10_000, outDurMs: 20_000, maxStretch: 3 }), 0.5); // 2× slower
  assert.equal(playbackSpeed({ recMs: 1_000, outDurMs: 10_000, maxStretch: 3 }), 1 / 3); // capped at 3× slower
  assert.equal(playbackSpeed({ recMs: 0, outDurMs: 10_000, maxStretch: 3 }), 1); // a still
});

test("sampleFrames: tolerates millisecond timestamps (latest frame ≤ source time)", () => {
  const ms = [
    { file: "a.jpg", ts: S * 1000 },
    { file: "b.jpg", ts: S * 1000 + 1000 },
  ];
  // capture span = 1 000 ms + a 200 ms hold on the last frame = 1 200 ms → 2 000 ms of output = 0.6× speed
  const out = sampleFrames(ms, 20, { outDurMs: 2_000, maxStretch: 3 });
  assert.equal(out.length, 20);
  assert.equal(out[15], "a.jpg");
  assert.equal(out[19], "b.jpg"); // b is on screen for the last ~330 ms, not a single instant
});

test("buildTimeline: every shot lasts its narration (+ lead, pauses, tail), starts on a frame boundary, VO is placed inside", () => {
  const plan = [
    { shot: "intro", source: "capture", recMs: 2_500, vo: ["a", "b"] },
    { shot: "sync", source: "capture", recMs: 9_900, vo: ["c"] },
  ];
  const voMs = { a: 8_000, b: 6_860, c: 6_580 };
  const t = buildTimeline(plan, voMs, { fps: 30, leadMs: 600, gapMs: 350, tailMs: 1_200 });
  assert.equal(t.shots.length, 2);
  const [s1, s2] = t.shots;
  assert.equal(s1.nFrames, 475); // ceil of 474.3 — a shot is never shorter than its narration
  assert.equal(s2.nFrames, 252); // ceil of 251.4: lead + line + tail
  assert.equal(s2.startMs, (475 / 30) * 1000);
  assert.equal(t.totalFrames, s1.nFrames + s2.nFrames);
  assert.equal(t.totalMs, (t.totalFrames / 30) * 1000);
  const seg = Object.fromEntries(t.segments.map((x) => [x.id, x]));
  assert.equal(seg.a.startMs, 600);
  assert.equal(seg.b.startMs, 600 + 8000 + 350);
  assert.equal(seg.c.startMs, s2.startMs + 600); // the lead precedes every shot's first line
  // no narration runs past its shot
  for (const s of t.shots) for (const v of s.vo) assert.ok(v.endMs <= s.startMs + s.durationMs + 1e-6);
});

/* ---------- beats ---------- */

const SEG = (id, startMs, durationMs) => ({ id, startMs, durationMs });
const SPAN = { t0: 10_000, t1: 20_000, tEnd: 20_200 };

test("resolveBeats: marks land on their narration moments; ends are always anchored", () => {
  const segments = [SEG("a", 600, 10_000), SEG("b", 10_950, 16_000)];
  const marks = [
    { label: "type-1", ts: 10.1 },
    { label: "click", ts: 15.0 },
    { label: "result", ts: 17.5 },
  ];
  const { anchors, notes } = resolveBeats(
    [
      { mark: "click", at: "b", minus: 0.45 },
      { mark: "result", at: "b" },
      { mark: "type-1", at: "a" },
    ],
    marks,
    segments,
    0,
    27_550,
    SPAN,
  );
  assert.deepEqual(notes, []);
  assert.deepEqual(
    anchors.map((a) => [a.mark, a.src, Math.round(a.out)]),
    [
      ["start", 10_000, 0],
      ["type-1", 10_100, 600],
      ["click", 15_000, 10_500], // 10 950 − 450
      ["result", 17_500, 10_950],
      ["end", 20_200, 27_550],
    ],
  );
});

test("resolveBeats: unknown narration and missing marks are reported, not fatal", () => {
  const segments = [SEG("a", 600, 10_000)];
  const { anchors, notes } = resolveBeats(
    [
      { mark: "nope", at: "a" }, // no such mark in the capture
      { mark: "early", at: "ghost" }, // no such narration line
      { mark: "m", at: "a" },
    ],
    [{ label: "m", ts: 11 }],
    segments,
    0,
    10_600,
    SPAN,
  );
  assert.equal(anchors.length, 3); // start, m, end
  assert.match(notes.join("\n"), /beat "nope": the capture has no such mark/);
  assert.match(notes.join("\n"), /beat "early": unknown narration "ghost"/);
});

test("resolveBeats: a beat that would run the film backwards is dropped and reported", () => {
  const segments = [SEG("a", 600, 10_000)];
  const { anchors, notes } = resolveBeats(
    [
      { mark: "x", into: "a", fraction: 0.8 }, // later in the film …
      { mark: "y", at: "a" }, // … but earlier in the film, while later in the capture
    ],
    [
      { label: "x", ts: 11 },
      { label: "y", ts: 12 },
    ],
    segments,
    0,
    10_600,
    SPAN,
  );
  assert.deepEqual(anchors.map((a) => a.mark), ["start", "x", "end"]);
  assert.match(notes.join("\n"), /beat "y": would run the film backwards/);
});

test("resolveBeats: marks outside the capture are clamped, film times stay inside the shot", () => {
  const { anchors } = resolveBeats([{ mark: "m", at: "a", minus: 5 }], [{ label: "m", ts: 9.0 }], [SEG("a", 0, 10_000)], 0, 10_000, SPAN);
  assert.deepEqual(anchors.map((a) => [a.src, a.out]), [[SPAN.t0, 0], [SPAN.t0, 0], [SPAN.tEnd, 10_000]]);
});

test("sourceTimeAtBeats / sampleFrames with anchors: the action follows the words, the wait is cut", () => {
  // 6 frames over 6 s: 0,1,2 | 3 (result) | 4,5 (hold). Output 12 s, 120 frames.
  const frames = Array.from({ length: 6 }, (_, i) => ({ file: `f${i}.jpg`, ts: S + i }));
  const span = captureSpan(frames); // t0 = S s, tEnd = S+5.2 s
  const anchors = [
    { mark: "start", src: span.t0, out: 0 },
    { mark: "click", src: (S + 2) * 1000, out: 6_000 }, // typing (2 s) fills the first 6 s of narration
    { mark: "result", src: (S + 3) * 1000, out: 6_400 }, // the 1 s wait is cut to 0.4 s
    { mark: "end", src: span.tEnd, out: 12_000 },
  ];
  assert.equal(sourceTimeAtBeats(3_000, anchors), (S + 1) * 1000); // mid of the typing phase
  assert.equal(sourceTimeAtBeats(6_200, anchors), (S + 2.5) * 1000); // inside the cut wait
  const out = sampleFrames(frames, 120, { outDurMs: 12_000, maxStretch: 3, anchors });
  assert.equal(out.length, 120);
  const first = Object.fromEntries([...new Set(out)].map((f) => [f, out.indexOf(f)]));
  assert.equal(first["f0.jpg"], 0);
  assert.equal(first["f1.jpg"], 30); // typing: 2 captured seconds spread over the 6 s dictated line (3×)
  assert.ok(first["f2.jpg"] >= 58 && first["f2.jpg"] <= 61, `the click lands at 6.0 s (first at ${first["f2.jpg"]})`);
  assert.ok(first["f3.jpg"] >= 62 && first["f3.jpg"] <= 66, `the result lands right after 6.4 s (at ${first["f3.jpg"]})`);
  assert.equal(out[119], "f5.jpg");
  for (let i = 1; i < out.length; i++) assert.ok(out[i] >= out[i - 1]); // never backwards
});

test("buildTimeline: cut-ins and alternates are the caller's business — unknown VO ids are an error", () => {
  assert.throws(() => buildTimeline([{ shot: "x", vo: ["missing"] }], { a: 1 }), /missing/);
});

test("buildTimeline: a shot without narration (end card) gets its fixed hold; the pause stays after the last narrated shot", () => {
  const t = buildTimeline(
    [
      { shot: "close", vo: ["a"], tailMs: 1200 },
      { shot: "end-card", vo: [], holdMs: 4000, leadMs: 0, tailMs: 0 },
    ],
    { a: 10_000 },
    { fps: 30, leadMs: 0, gapMs: 0, tailMs: 1200 },
  );
  assert.equal(t.shots[0].nFrames, Math.ceil(11_200 / 1000 * 30 - 1e-9)); // 336
  assert.equal(t.shots[1].nFrames, 120);
  assert.equal(t.shots[1].startMs, t.shots[0].durationMs);
  assert.equal(t.totalMs, 15_200);
});

test("chunkCaption: sentence-sized chunks under the caption limit, no text lost", () => {
  const text = "Under the hood: the Firebase AI Logic hybrid inference SDK. Every feature declares its routing — capture and Q&A prefer on-device, report drafting is cloud-only. The badge isn't decoration; it reads inferenceSource straight from the SDK response.";
  const chunks = chunkCaption(text, 92);
  assert.ok(chunks.every((c) => c.text.length <= 92), JSON.stringify(chunks.map((c) => c.text.length)));
  assert.equal(chunks.map((c) => c.text).join(" "), text);
});

test("chunkCaption: one over-long clause is split at word boundaries", () => {
  const long = "word ".repeat(40).trim();
  const chunks = chunkCaption(long, 92);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.text.length <= 92 && !c.text.startsWith(" ") && !c.text.endsWith(" ")));
  assert.equal(chunks.map((c) => c.text).join(" "), long);
});

test("wrapCaption: balanced two-line break, short captions untouched", () => {
  assert.equal(wrapCaption("short one"), "short one");
  const w = wrapCaption("aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj", 20);
  const [l1, l2] = w.split("\\N");
  assert.ok(Math.abs(l1.length - l2.length) <= 6, w);
  assert.equal(w.replace("\\N", " "), "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj");
});

test("captionEvents: captions tile each narration segment exactly, weighted by characters", () => {
  const t = buildTimeline([{ shot: "s", vo: ["a"] }], { a: 10_000 }, { leadMs: 0, gapMs: 0, tailMs: 0 });
  t.segments[0].text = "One sentence. Two sentence. Three sentence with more words in it.";
  const ev = captionEvents(t);
  const start = t.segments[0].startMs;
  const end = start + 10_000;
  assert.equal(ev[0].startMs, start);
  assert.ok(Math.abs(ev.at(-1).endMs - end) < 1e-6);
  for (let i = 1; i < ev.length; i++) assert.equal(ev[i].startMs, ev[i - 1].endMs);
});

test("assTime / buildAss", () => {
  assert.equal(assTime(0), "0:00:00.00");
  assert.equal(assTime(61_610), "0:01:01.61");
  assert.equal(assTime(3_600_000 + 5_000), "1:00:05.00");
  const ass = buildAss({ captions: [{ startMs: 400, endMs: 2_000, text: "Hi (there)\\Nfriend" }], totalMs: 3_000, label: "TEST {RENDER}" });
  assert.match(ass, /PlayResX: 1920/);
  assert.match(ass, /Dialogue: 0,0:00:00.40,0:00:02.00,Caption,,0,0,0,,Hi \(there\)\\Nfriend/);
  assert.match(ass, /Label,,0,0,0,,TEST \(RENDER\)/); // label is escaped by buildAss
  assert.doesNotMatch(buildAss({ captions: [], totalMs: 1, label: "" }), /Label,,0,0,0,,/);
});

test("captionEvents: ASS override braces in narration are neutralised", () => {
  const t = buildTimeline([{ shot: "s", vo: ["a"] }], { a: 10_000 }, { leadMs: 0, gapMs: 0, tailMs: 0 });
  t.segments[0].text = "A {\\b1}bold{\\b0} trick.";
  const ev = captionEvents(t);
  assert.equal(ev[0].text, "A (\\b1)bold(\\b0) trick.".replace(/\\b/g, "\\\\b"));
});

test("pearson: identical waveforms correlate at 1, noise does not", () => {
  const a = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i / 7));
  const b = Float32Array.from(a);
  const c = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i / 7 + 0.35));
  assert.ok(Math.abs(pearson(a, b) - 1) < 1e-6);
  assert.ok(pearson(a, c) < 0.95);
});

test("speechBounds: finds onset/offset of a burst in silence (10 ms windows)", () => {
  const sr = 16_000;
  const x = new Float32Array(sr * 2); // 2 s
  for (let i = sr * 0.5; i < sr * 1.25; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr); // 0.50 s → 1.25 s
  const b = speechBounds(x, sr);
  assert.equal(b.onsetMs, 500);
  assert.equal(b.offsetMs, 1250); // start of the first silent window after the burst
  assert.ok(b.peakDb > -10);
  const silence = speechBounds(new Float32Array(sr), sr);
  assert.equal(silence.onsetMs, null);
  assert.equal(silence.offsetMs, null);
});

test("overlayClip: adds a stereo clip at an exact frame, never past the end of the mix", () => {
  const mix = new Float32Array(10 * 2); // 10 stereo frames
  const clip = Float32Array.from([0.5, -0.5, 0.25, -0.25, 1, 1, 1, 1]); // 4 frames
  assert.equal(overlayClip(mix, clip, 2), 4);
  assert.deepEqual([...mix], [0, 0, 0, 0, 0.5, -0.5, 0.25, -0.25, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(overlayClip(mix, clip, 8), 2); // clipped to the mix length
  assert.equal(mix[16], 0.5);
  assert.equal(mix[19], -0.25);
  assert.equal(overlayClip(mix, clip, 10), 0);
  overlayClip(mix, Float32Array.from([0.5, 0, 0.5, 0]), 4); // two clips landing on the same frame add up
  assert.equal(mix[8], 1.5); // was 1.0 from the first clip
  assert.equal(mix[9], 1);
  assert.equal(peakOf(mix), 1.5);
  assert.equal(peakOf(new Float32Array(4)), 0);
});

test("fmtSec", () => {
  assert.equal(fmtSec(0), "0:00.0");
  assert.equal(fmtSec(144_150), "2:24.2");
  assert.equal(fmtSec(61_000), "1:01.0");
});
