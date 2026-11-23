/**
 * Pure timeline maths for the film assembly (no I/O, no ffmpeg) — unit-tested
 * in tests/assemble-core.test.mjs. scripts/assemble-video.mjs does the I/O.
 *
 * Vocabulary
 *   capture   one shot directory: manifest.json + frames [{file, ts}]
 *             (ts = CDP screencast timestamp in SECONDS; variable rate)
 *   shot      one entry of the script's shot ↔ narration map
 *   segment   one narration line (one VO file), placed inside a shot
 */

const DEFAULTS = {
  fps: 30,
  leadMs: 600, // silence before the first narration
  gapMs: 350, // pause between narration segments
  tailMs: 1200, // hold after the last narration
  endCardMs: 4000,
  maxStretch: 3, // never slow captured footage down by more than this; hold the last frame instead
};

/** CDP reports screencast timestamps in seconds; be tolerant of millisecond manifests. */
export function frameTimesMs(frames) {
  return frames.map((f) => (f.ts > 1e11 ? f.ts : f.ts * 1000));
}

/**
 * The span of a capture, in epoch ms. `tEnd` lets the LAST captured frame stay
 * on screen for one average frame interval instead of flashing for an instant
 * (a screencast only emits a frame when the picture changes, so the final
 * frame carries no duration of its own).
 */
export function captureSpan(frames) {
  const ts = frameTimesMs([...frames].sort((a, b) => a.ts - b.ts));
  const t0 = ts[0];
  const t1 = ts[ts.length - 1];
  const mean = ts.length > 1 ? (t1 - t0) / (ts.length - 1) : 0;
  const tEnd = t1 + Math.min(200, Math.max(16, mean));
  return { t0, t1, tEnd, recMs: tEnd - t0 };
}

/** Playback speed of a capture inside a shot of length `outDurMs`. */
export function playbackSpeed({ recMs, outDurMs, maxStretch }) {
  if (recMs <= 0) return 1;
  // Recording longer than its narration: natural speed, the rest is trimmed.
  // Shorter: slow it down uniformly — but never by more than maxStretch.
  return recMs <= outDurMs ? recMs / Math.min(outDurMs, recMs * maxStretch) : 1;
}

/**
 * Source (capture) time for an output time `tMs` inside one shot.
 *   recording longer than the narration → natural speed, the rest is trimmed
 *   recording shorter, ratio ≤ maxStretch → uniformly retimed (slow motion)
 *   recording shorter, ratio > maxStretch → retimed by maxStretch, then the
 *   last frame is held for the remainder
 */
export function sourceTimeAt(tMs, { t0, t1, recMs, outDurMs, maxStretch }) {
  // Never look past the last captured frame (anything later shows that frame).
  return t0 + Math.min(tMs * playbackSpeed({ recMs, outDurMs, maxStretch }), Math.max(0, t1 - t0));
}

/**
 * Beat anchors let the action follow the words instead of a uniform stretch:
 * the harness records marks ("capture-1-result") and the script map says which
 * narration moment each mark belongs to. Each spec entry:
 *   { mark, at: <vo id> }                         → mark lands on that line's start
 *   { mark, into: <vo id>, fraction: 0..1, minus: s }  → that far into the line, s seconds earlier
 * Returns anchors [{mark, src, out}] (src = capture time in epoch ms, out = film
 * time inside the shot, ms) incl. the two end points, plus notes for anything
 * that had to be ignored.
 */
export function resolveBeats(spec, marks, segments, shotStartMs, shotDurationMs, span) {
  const byId = Object.fromEntries(segments.map((s) => [s.id, s]));
  const markTs = Object.fromEntries((marks ?? []).map((m) => [m.label, m.ts > 1e11 ? m.ts : m.ts * 1000]));
  const notes = [];
  const found = [];
  for (const b of spec ?? []) {
    const id = b.at ?? b.into;
    const seg = byId[id];
    if (!seg) {
      notes.push(`beat "${b.mark}": unknown narration "${id}"`);
      continue;
    }
    if (markTs[b.mark] == null) {
      notes.push(`beat "${b.mark}": the capture has no such mark`);
      continue;
    }
    const out = seg.startMs + (b.fraction ?? 0) * seg.durationMs - (b.minus ?? 0) * 1000 - shotStartMs;
    found.push({ mark: b.mark, src: Math.min(span.tEnd, Math.max(span.t0, markTs[b.mark])), out: Math.min(shotDurationMs, Math.max(0, out)) });
  }
  found.sort((a, b) => a.src - b.src || a.out - b.out);
  const kept = [];
  for (const a of found) {
    if (kept.length && a.out < kept.at(-1).out) {
      notes.push(`beat "${a.mark}": would run the film backwards — ignored`);
      continue;
    }
    kept.push(a);
  }
  return { anchors: [{ mark: "start", src: span.t0, out: 0 }, ...kept, { mark: "end", src: span.tEnd, out: shotDurationMs }], notes };
}

/** Piecewise-linear capture time for film time `tMs` through beat anchors. */
export function sourceTimeAtBeats(tMs, anchors) {
  let i = 0;
  while (i + 2 < anchors.length && tMs >= anchors[i + 1].out) i++;
  const a = anchors[i];
  const b = anchors[i + 1];
  const spanOut = b.out - a.out;
  const u = spanOut > 0 ? Math.min(1, Math.max(0, (tMs - a.out) / spanOut)) : 1;
  return a.src + u * (b.src - a.src);
}

/**
 * Resample a variable-rate capture to a constant frame rate BY TIMESTAMP:
 * for each of `outFrames` output frames (mid-frame instants) pick the captured
 * frame with the latest timestamp ≤ the source time. Returns file names.
 * With `anchors` (≥ 2) the capture time follows the beats, otherwise the
 * stretch policy of sourceTimeAt applies.
 */
export function sampleFrames(frames, outFrames, { outDurMs, maxStretch, anchors }) {
  if (!frames.length) throw new Error("sampleFrames: no captured frames");
  const sorted = [...frames].sort((a, b) => a.ts - b.ts);
  if (sorted.length === 1) return new Array(outFrames).fill(sorted[0].file);
  const ts = frameTimesMs(sorted);
  const span = { ...captureSpan(sorted), outDurMs, maxStretch };
  const beats = Array.isArray(anchors) && anchors.length >= 2 ? anchors : null;
  const step = outDurMs / outFrames;
  const out = new Array(outFrames);
  let k = 0;
  for (let i = 0; i < outFrames; i++) {
    const s = beats ? sourceTimeAtBeats((i + 0.5) * step, beats) : sourceTimeAt((i + 0.5) * step, span);
    while (k + 1 < ts.length && ts[k + 1] <= s) k++;
    out[i] = sorted[k].file;
  }
  return out;
}

/**
 * Lay the film out. `plan` entries: { shot, vo: [ids], recMs, source }. Times
 * are exact multiples of one frame where it matters (every shot starts on a
 * frame boundary), so video and audio cannot drift apart over the film.
 */
export function buildTimeline(plan, voMs, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const shots = [];
  const segments = [];
  let cursorMs = 0;
  plan.forEach((p, idx) => {
    const last = idx === plan.length - 1;
    for (const id of p.vo) if (typeof voMs[id] !== "number" || !(voMs[id] > 0)) throw new Error(`no narration audio measured for "${id}" (shot "${p.shot}")`);
    const vos = p.vo.map((id) => ({ id, durationMs: voMs[id] }));
    // A short lead before every shot's first line (overridable per shot with
    // leadMs), so a beat anchored "0.5 s before the line" is never clipped;
    // tailMs / holdMs let the caller give the end card a fixed length or keep
    // the pause after the last narrated shot.
    const lead = p.leadMs ?? o.leadMs;
    const tail = p.tailMs ?? (last ? o.tailMs : 0);
    const nominal = lead + vos.reduce((a, v) => a + v.durationMs, 0) + o.gapMs * Math.max(0, vos.length - 1) + tail + (p.holdMs ?? 0);
    // ceil, never round: a shot must never be shorter than the narration it carries
    const nFrames = Math.max(1, Math.ceil((nominal / 1000) * o.fps - 1e-9));
    const durationMs = (nFrames / o.fps) * 1000;
    let s = cursorMs + lead;
    for (const v of vos) {
      v.startMs = s;
      v.endMs = s + v.durationMs;
      segments.push({ ...v, shot: p.shot });
      s = v.endMs + o.gapMs;
    }
    shots.push({ shot: p.shot, source: p.source, startMs: cursorMs, durationMs, nFrames, recMs: p.recMs ?? 0, vo: vos, ...(p.meta ?? {}) });
    cursorMs += durationMs;
  });
  const totalFrames = shots.reduce((a, s) => a + s.nFrames, 0);
  return { ...o, shots, segments, totalFrames, totalMs: (totalFrames / o.fps) * 1000 };
}

/** Human-readable m:ss.s */
export function fmtSec(ms) {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

/** Split one narration line into caption-sized chunks (≤ maxChars), weighted by characters. */
export function chunkCaption(text, maxChars = 92) {
  // Sentence/clause boundaries. " — " stays with the clause before it, so the
  // chunks joined by a single space reproduce the original text exactly.
  const units = [];
  for (const part of text.split(/(?<=[.!?;:])\s+|(?=\s+—\s+)/)) {
    const u = part.trim();
    if (!u) continue;
    if (u.startsWith("—") && units.length) {
      const [dash, ...rest] = u.split(/\s+/);
      units[units.length - 1] += ` ${dash}`;
      if (rest.length) units.push(rest.join(" "));
    } else {
      units.push(u);
    }
  }
  const chunks = [];
  let cur = "";
  for (const u of units) {
    const cand = cur ? `${cur} ${u}` : u;
    if (cand.length <= maxChars) {
      cur = cand;
      continue;
    }
    if (cur) {
      chunks.push(cur);
      cur = "";
    }
    let rest = u;
    while (rest.length > maxChars) {
      const half = rest.slice(0, maxChars);
      const cut = half.lastIndexOf(" ");
      if (cut < maxChars * 0.5) break;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut + 1);
    }
    cur = rest;
  }
  if (cur) chunks.push(cur);
  return chunks.map((c) => ({ text: c, chars: c.length }));
}

/** Balanced two-line break for long captions. */
export function wrapCaption(text, lineChars = 46) {
  if (text.length <= lineChars || !text.includes(" ")) return text;
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== " ") continue;
    const diff = Math.abs(i - text.length / 2);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return `${text.slice(0, best)}\\N${text.slice(best + 1)}`;
}

/** Caption events for the whole film: [{startMs, endMs, text}] in output time. */
export function captionEvents(timeline) {
  const out = [];
  for (const seg of timeline.segments) {
    const chunks = chunkCaption(seg.text ?? "");
    const total = chunks.reduce((a, c) => a + c.chars, 0) || 1;
    let t = seg.startMs;
    for (const c of chunks) {
      const d = (seg.durationMs * c.chars) / total;
      // escape first (no spaces are added), then insert the line break
      out.push({ startMs: t, endMs: t + d, text: wrapCaption(assText(c.text)), shot: seg.shot });
      t += d;
    }
  }
  return out;
}

const pad2 = (n) => String(n).padStart(2, "0");

/** ASS timestamp H:MM:SS.cc from milliseconds. */
export function assTime(ms) {
  const cs = Math.max(0, Math.round(ms / 10));
  return `${Math.floor(cs / 360000)}:${pad2(Math.floor(cs / 6000) % 60)}:${pad2(Math.floor(cs / 100) % 60)}.${pad2(cs % 100)}`;
}

/** Escape text for an ASS Dialogue line. */
export function assText(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\r?\n/g, "\\N");
}

/** A complete .ass subtitle file: burned captions + the corner label. */
export function buildAss({ captions, totalMs, label, fontFamily = "Segoe UI", playResX = 1920, playResY = 1080 }) {
  const lines = [
    "[Script Info]",
    "; Generated by scripts/assemble-video.mjs — do not edit",
    "ScriptType: v4.00+",
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${fontFamily},42,&H00F4EDE8,&H00F4EDE8,&H0010141A,&H9610141A,0,0,0,0,100,100,0,0,3,12,0,2,160,160,36,1`,
    `Style: Label,${fontFamily},28,&H0055B4F5,&H0055B4F5,&H0010141A,&H9C10141A,1,0,0,0,100,100,0,0,3,8,0,7,30,30,26,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  if (label) lines.push(`Dialogue: 0,${assTime(0)},${assTime(totalMs)},Label,,0,0,0,,${assText(label)}`);
  for (const c of captions) lines.push(`Dialogue: 0,${assTime(c.startMs)},${assTime(c.endMs)},Caption,,0,0,0,,${c.text}`);
  return lines.join("\n") + "\n";
}

/**
 * Add a clip into a stereo mix at an exact sample position. Plain sample
 * overlay-add (narration lines never overlap), done here instead of ffmpeg's
 * amix so placement is sample-accurate and independent of filter quirks.
 * Returns the number of frames written.
 */
export function overlayClip(mix, clip, startFrame) {
  const total = mix.length >> 1; // stereo frames
  const frames = Math.min(clip.length >> 1, Math.max(0, total - startFrame));
  const at = startFrame * 2;
  for (let i = 0; i < frames * 2; i++) mix[at + i] += clip[i];
  return frames;
}

/** Peak absolute sample of an interleaved float buffer. */
export function peakOf(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > p) p = a;
  }
  return +p.toFixed(4);
}

/** Normalised cross-correlation at lag 0 — "is clip b what is playing in a?". */
export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 16) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}

/**
 * Speech onset/offset in a clip from 10 ms RMS windows (dBFS).
 * Returns { onsetMs, offsetMs, peakDb } — onset/offset are null for silence.
 */
export function speechBounds(samples, sampleRate, { windowMs = 10, thresholdDb = -45 } = {}) {
  const win = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const nWin = Math.floor(samples.length / win);
  let peakDb = -Infinity;
  const active = new Uint8Array(nWin);
  for (let w = 0; w < nWin; w++) {
    let acc = 0;
    for (let i = w * win; i < (w + 1) * win; i++) acc += samples[i] * samples[i];
    const db = 10 * Math.log10(acc / win + 1e-12);
    if (db > peakDb) peakDb = db;
    if (db > thresholdDb) active[w] = 1;
  }
  let first = -1;
  let last = -1;
  for (let w = 0; w < nWin; w++) {
    if (active[w]) {
      if (first < 0) first = w;
      last = w;
    }
  }
  return {
    onsetMs: first < 0 ? null : first * windowMs,
    offsetMs: last < 0 ? null : (last + 1) * windowMs,
    peakDb: +peakDb.toFixed(1),
  };
}
