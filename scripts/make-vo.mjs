/**
 * Narration audio for submission/VIDEO-SCRIPT-EN.md (T5, run #15).
 *
 * Parses the storyboard's narration lines (blockquotes) straight from the
 * markdown so the script stays the single source of truth, then renders one
 * MP3 per beat into ../submission/vo/ with edge-tts (must be on PATH:
 * `pip install edge-tts`). The parser is shared with the assembler
 * (lib/script-vo.mjs) so file names can never drift between the two.
 *
 * Usage:  node scripts/make-vo.mjs [--voice en-US-AriaNeural] [--list-only]
 * The ⚠FB ("no Nano") alternate line for Beat 2 is rendered too, as
 * act2-beat2-FB.mp3, so the fallback cut can be assembled without re-running.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseNarration } from "./lib/script-vo.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_MD = path.resolve(ROOT, "..", "submission", "VIDEO-SCRIPT-EN.md");
const VO_DIR = path.resolve(ROOT, "..", "submission", "vo");

const args = process.argv.slice(2);
const voice = args.includes("--voice") ? args[args.indexOf("--voice") + 1] : "en-US-AriaNeural";
const listOnly = args.includes("--list-only");
// --only a,b,c: render just these lines (by id). --skip-existing: leave every file that is
// already there untouched. Both exist so new lines can be added to the script without
// re-rendering — and without re-making — the lines that were recorded before.
const only = new Set((args.includes("--only") ? args[args.indexOf("--only") + 1] : "").split(",").map((s) => s.trim()).filter(Boolean));
const skipExisting = args.includes("--skip-existing");

const md = fs.readFileSync(SCRIPT_MD, "utf8");
const segments = parseNarration(md);

if (!segments.length) {
  console.error("[make-vo] no narration lines found in " + SCRIPT_MD);
  process.exit(1);
}
if (only.size) {
  const unknown = [...only].filter((id) => !segments.some((s) => s.id === id));
  if (unknown.length) {
    console.error(`[make-vo] --only names narration ids that the script does not have: ${unknown.join(", ")}`);
    process.exit(2);
  }
}
console.log(`[make-vo] ${segments.length} segments, voice=${voice}${only.size ? ` · --only ${[...only].join(",")}` : ""}${skipExisting ? " · --skip-existing" : ""}`);
for (const s of segments) console.log(`  ${s.id}  (${s.text.length} chars${s.alternate ? `, alternate${s.onDeviceBadge ? `, on-device badge: ${s.onDeviceBadge}` : ""}` : ""})`);

if (listOnly) process.exit(0);
fs.mkdirSync(VO_DIR, { recursive: true });
let fail = 0;
let rendered = 0;
let skipped = 0;
const ttsBin = (() => {
  // prefer the console script, fall back to `python -m edge_tts`
  const probe = spawnSync("edge-tts", ["--version"], { encoding: "utf8", timeout: 15_000 });
  return probe.status === 0 ? { cmd: "edge-tts", pre: [] } : { cmd: "python", pre: ["-m", "edge_tts"] };
})();
for (const s of segments) {
  if (only.size && !only.has(s.id)) continue;
  const out = path.join(VO_DIR, `${s.id}.mp3`);
  if (skipExisting && fs.existsSync(out) && fs.statSync(out).size > 1000) {
    console.log(`[make-vo] ${path.basename(out)} … kept (exists, ${(fs.statSync(out).size / 1024).toFixed(0)} kB)`);
    skipped++;
    continue;
  }
  process.stdout.write(`[make-vo] ${path.basename(out)} … `);
  const r = spawnSync(ttsBin.cmd, [...ttsBin.pre, "--voice", voice, "--text", s.text, "--write-media", out], { encoding: "utf8", timeout: 120_000 });
  if (r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 1000) {
    rendered++;
    console.log(`ok (${(fs.statSync(out).size / 1024).toFixed(0)} kB)`);
  } else {
    console.log("FAILED");
    console.error(String(r.stderr ?? r.error ?? "").slice(0, 300));
    fail++;
  }
}
console.log(`[make-vo] done, ${rendered} rendered, ${skipped} kept, ${fail} failure(s) → ${VO_DIR}`);
process.exit(fail ? 1 : 0);
