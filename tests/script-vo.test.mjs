/**
 * Unit tests for scripts/lib/script-vo.mjs — the parser both the VO renderer
 * and the video assembler share (the script file is the single source of truth).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseNarration, parseShotMap, checkShotMap } from "../scripts/lib/script-vo.mjs";

const FIXTURE = `# Script
## ACT 1 — The problem (0:00–0:15)

**[0:00]** Cold open.

> "First line of act one."

**[0:08]** Cut to the app.

> "Second line — with an em dash."

### Beat 1 — Enter a project (0:15–0:25)
Screen: open the app.

> "Beat line."
> Not a narration line: no quotes.

⚠FB line if no Nano: "Fallback wording here."

## Shot ↔ narration map (machine-readable)
\`\`\`json
{ "shots": [ { "shot": "intro", "vo": ["act-1-the-problem-1", "act-1-the-problem-2", "beat-1-enter-a-project-1"] } ] }
\`\`\`
`;

test("parseNarration: ids = nearest heading slug + index, in reading order", () => {
  const segs = parseNarration(FIXTURE);
  assert.deepEqual(segs.map((s) => s.id), ["act-1-the-problem-1", "act-1-the-problem-2", "beat-1-enter-a-project-1", "act2-beat2-FB"]);
  assert.equal(segs[0].text, "First line of act one.");
  assert.equal(segs[1].text, "Second line — with an em dash.");
  assert.equal(segs[2].text, "Beat line."); // unquoted blockquote is not narration
  assert.equal(segs[3].alternate, true);
  assert.equal(segs[3].text, "Fallback wording here.");
});

test("parseNarration: heading slugs drop parenthesised time codes and non-alphanumerics", () => {
  const segs = parseNarration("#### Beat 2 — Offline capture, ON-DEVICE engine (0:25–0:55)\n> \"x\"\n> \"y\"\n");
  assert.deepEqual(segs.map((s) => s.id), ["beat-2-offline-capture-on-device-engine-1", "beat-2-offline-capture-on-device-engine-2"]);
});

test("parseNarration: the JSON map block never becomes narration", () => {
  const map = parseShotMap(FIXTURE);
  assert.equal(map.shots.length, 1);
  assert.equal(parseNarration(FIXTURE).length, 4);
});

test("parseShotMap: null when the script has no map", () => {
  assert.equal(parseShotMap("# nothing\n> \"x\"\n"), null);
  assert.equal(parseShotMap("```json\n{ broken\n```\n"), null);
});

test("checkShotMap: catches unknown, duplicated and uncovered narration", () => {
  const segs = parseNarration(FIXTURE);
  assert.deepEqual(checkShotMap(parseShotMap(FIXTURE), segs), []); // the FB line is an alternate: covering it is optional
  const bad = { shots: [{ shot: "a", vo: ["act-1-the-problem-1", "nope"] }, { shot: "b", vo: ["act-1-the-problem-1"] }] };
  const problems = checkShotMap(bad, segs);
  assert.match(problems.join("\n"), /unknown narration id "nope"/);
  assert.match(problems.join("\n"), /used by more than one shot/);
  assert.match(problems.join("\n"), /"beat-1-enter-a-project-1" is not covered/);
});

test("the real script parses to the 12 known VO ids and a consistent shot map", (t) => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "submission", "VIDEO-SCRIPT-EN.md");
  if (!fs.existsSync(file)) return t.skip("submission/VIDEO-SCRIPT-EN.md is not next to the repo");
  const md = fs.readFileSync(file, "utf8");
  const segs = parseNarration(md);
  assert.deepEqual(
    segs.map((s) => s.id),
    [
      "act-1-the-problem-1", "act-1-the-problem-2", "beat-1-enter-a-project-1",
      "beat-2-offline-capture-on-device-engine-1", "beat-2-offline-capture-on-device-engine-2", "beat-3-a-second-capture-pending-sync-1",
      "beat-4-severity-cross-check-on-device-1", "beat-5-back-in-range-1", "beat-6-report-drafting-cloud-engine-1",
      "act-3-how-it-s-built-1", "act-4-close-1", "act2-beat2-FB",
    ],
  );
  const map = parseShotMap(md);
  assert.deepEqual(map.shots.map((s) => s.shot), ["cold-open", "intro", "offline-capture", "severity-check", "sync", "report", "engine-panel"]);
  assert.deepEqual(checkShotMap(map, segs), []);
  // every rendered VO file on disk is a known segment, and every main-cut segment has a file
  const voDir = path.resolve(file, "..", "vo");
  if (fs.existsSync(voDir)) {
    const files = fs.readdirSync(voDir).filter((f) => f.endsWith(".mp3")).map((f) => f.replace(/\.mp3$/, "")).sort();
    assert.deepEqual(files, [...segs.map((s) => s.id)].sort());
  }
});
