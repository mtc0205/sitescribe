/**
 * Narration audio for submission/VIDEO-SCRIPT-EN.md (T5, run #15).
 *
 * Parses the storyboard's narration lines (blockquotes) straight from the
 * markdown so the script stays the single source of truth, then renders one
 * MP3 per beat into ../submission/vo/ with edge-tts (must be on PATH:
 * `pip install edge-tts`).
 *
 * Usage:  node scripts/make-vo.mjs [--voice en-US-AriaNeural] [--list-only]
 * The ⚠FB ("no Nano") alternate line for Beat 2 is rendered too, as
 * act2-beat2-FB.mp3, so the fallback cut can be assembled without re-running.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_MD = path.resolve(ROOT, "..", "submission", "VIDEO-SCRIPT-EN.md");
const VO_DIR = path.resolve(ROOT, "..", "submission", "vo");

const args = process.argv.slice(2);
const voice = args.includes("--voice") ? args[args.indexOf("--voice") + 1] : "en-US-AriaNeural";
const listOnly = args.includes("--list-only");

const md = fs.readFileSync(SCRIPT_MD, "utf8");
const lines = md.split(/\r?\n/);

/** slugify the nearest heading above a narration line */
const segments = [];
let heading = "part";
for (const line of lines) {
  const h = /^#{2,4}\s+(.*)$/.exec(line);
  if (h) heading = h[1].replace(/\([^)]*\)/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const q = /^>\s*"(.+)"\s*$/m.exec(line.trim());
  if (q) {
    const text = q[1].replace(/\s+/g, " ").trim();
    // strip markdown emphasis kept inside quotes for on-screen contrast
    segments.push({ id: `${heading}-${segments.filter((s) => s.id.startsWith(heading)).length + 1}`, text });
  }
}
// The ⚠FB alternate line (inline, not a blockquote) — rendered separately.
const fb = /⚠FB line if no Nano:\s*"(.+)"/.exec(md);
if (fb) segments.push({ id: "act2-beat2-FB", text: fb[1].replace(/\s+/g, " ").trim() });

if (!segments.length) {
  console.error("[make-vo] no narration lines found in " + SCRIPT_MD);
  process.exit(1);
}
console.log(`[make-vo] ${segments.length} segments, voice=${voice}`);
for (const s of segments) console.log(`  ${s.id}  (${s.text.length} chars)`);

if (listOnly) process.exit(0);
fs.mkdirSync(VO_DIR, { recursive: true });
let fail = 0;
const ttsBin = (() => {
  // prefer the console script, fall back to `python -m edge_tts`
  const probe = spawnSync("edge-tts", ["--version"], { encoding: "utf8", timeout: 15_000 });
  return probe.status === 0 ? { cmd: "edge-tts", pre: [] } : { cmd: "python", pre: ["-m", "edge_tts"] };
})();
for (const s of segments) {
  const out = path.join(VO_DIR, `${s.id}.mp3`);
  process.stdout.write(`[make-vo] ${path.basename(out)} … `);
  const r = spawnSync(ttsBin.cmd, [...ttsBin.pre, "--voice", voice, "--text", s.text, "--write-media", out], { encoding: "utf8", timeout: 120_000 });
  if (r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 1000) {
    console.log(`ok (${(fs.statSync(out).size / 1024).toFixed(0)} kB)`);
  } else {
    console.log("FAILED");
    console.error(String(r.stderr ?? r.error ?? "").slice(0, 300));
    fail++;
  }
}
console.log(`[make-vo] done, ${fail} failure(s) → ${VO_DIR}`);
process.exit(fail ? 1 : 0);
