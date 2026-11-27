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

test("the real script parses to the 12 known VO ids, the 5 plan-B lines and the FB line, and a consistent shot map", (t) => {
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
      "act-3-how-it-s-built-1", "act-4-close-1",
      // ⚠PLAN-B lines in reading order (2026-11-27; planb-beat-3 joined them on 2026-11-28,
      // when the main line of beat 3 became true only over an on-device badge), then the older ⚠FB line
      "planb-beat-2", "planb-beat-3", "planb-beat-4", "planb-beat-6", "planb-act-3", "act2-beat2-FB",
    ],
  );
  const map = parseShotMap(md);
  assert.deepEqual(map.shots.map((s) => s.shot), ["cold-open", "intro", "offline-capture", "severity-check", "sync", "report", "engine-panel"]);
  assert.deepEqual(checkShotMap(map, segs), []);
  // every plan-B line is the target of a cut, and the two cuts differ exactly in beats 2, 3 and 4
  const swappedIn = Object.values(map.cuts).flatMap((c) => Object.values(c));
  for (const s of segs.filter((x) => x.id.startsWith("planb-"))) assert.ok(swappedIn.includes(s.id), `${s.id} belongs to no cut`);
  assert.deepEqual(Object.keys(map.cuts["plan-b-nano"]).filter((id) => !(id in map.cuts["plan-b"])), []);
  assert.deepEqual(
    Object.keys(map.cuts["plan-b"]).filter((id) => !(id in map.cuts["plan-b-nano"])).sort(),
    ["beat-2-offline-capture-on-device-engine-2", "beat-3-a-second-capture-pending-sync-1", "beat-4-severity-cross-check-on-device-1"],
  );
  // the lines that are true only with an on-device badge on camera carry that mark
  assert.deepEqual(
    Object.entries(map.onDeviceBadge).filter(([, mark]) => mark === "required").map(([id]) => id).sort(),
    ["beat-2-offline-capture-on-device-engine-2", "beat-3-a-second-capture-pending-sync-1", "beat-4-severity-cross-check-on-device-1"],
  );
  // every rendered VO file on disk is a known segment, and every main-cut segment has a file
  const voDir = path.resolve(file, "..", "vo");
  if (fs.existsSync(voDir)) {
    const files = fs.readdirSync(voDir).filter((f) => f.endsWith(".mp3")).map((f) => f.replace(/\.mp3$/, "")).sort();
    assert.deepEqual(files, [...segs.map((s) => s.id)].sort());
  }
});

/* ---------- plan-B lines and named cuts (2026-11-27) ---------- */

const PLAN_B_MD = `# Script
### Beat 2 — Offline capture, ON-DEVICE engine (0:25–0:55)
> "Dictated note."
> "Main line that claims Gemini Nano."

⚠ The main line above holds only with an on-device badge.

⚠PLAN-B planb-beat-2 (on-device badge on screen: must be absent) "Fallback wording for beat two."

### Beat 4 — Severity cross-check, on-device (1:10–1:25)
> "Main line four."
⚠PLAN-B planb-beat-4 (on-device badge on screen: must be absent) "Fallback wording four."
⚠PLAN-B planb-act-3 (on-device badge on screen: not required) "Fallback wording for act three."
⚠PLAN-B planb-needs-badge (on-device badge on screen: required) "True only over an on-device badge."

\`\`\`json
{ "shots": [ { "shot": "a", "vo": ["beat-2-offline-capture-on-device-engine-1", "beat-2-offline-capture-on-device-engine-2"] }, { "shot": "b", "vo": ["beat-4-severity-cross-check-on-device-1"] } ],
  "cuts": { "plan-b": { "beat-2-offline-capture-on-device-engine-2": "planb-beat-2", "beat-4-severity-cross-check-on-device-1": "planb-beat-4" } } }
\`\`\`
`;

test("parseNarration: a ⚠PLAN-B line becomes an alternate with the id it names and its on-device mark", () => {
  const segs = parseNarration(PLAN_B_MD);
  assert.deepEqual(
    segs.map((s) => [s.id, s.alternate ?? false, s.onDeviceBadge ?? null]),
    [
      ["beat-2-offline-capture-on-device-engine-1", false, null],
      ["beat-2-offline-capture-on-device-engine-2", false, null],
      ["beat-4-severity-cross-check-on-device-1", false, null],
      ["planb-beat-2", true, "absent"],
      ["planb-beat-4", true, "absent"],
      ["planb-act-3", true, "either"],
      ["planb-needs-badge", true, "required"],
    ],
  );
  assert.equal(segs.find((s) => s.id === "planb-beat-2").text, "Fallback wording for beat two.");
  // the prose note that merely mentions the words is not a plan-B line
  assert.equal(segs.length, 7);
});

test("parseNarration: the older ⚠FB line still parses, and comes last", () => {
  const segs = parseNarration('## Act 2\n> "Main."\n\n⚠FB line if no Nano: "Older alternate."\n⚠PLAN-B planb-x (on-device badge on screen: not required) "Newer alternate."\n');
  assert.deepEqual(segs.map((s) => s.id), ["act-2-1", "planb-x", "act2-beat2-FB"]);
});

test("checkShotMap: named cuts must swap alternates in for real lines, and marks must be known words", () => {
  const segs = parseNarration(PLAN_B_MD);
  const map = parseShotMap(PLAN_B_MD);
  assert.deepEqual(checkShotMap(map, segs), []);
  const patched = (patch) => checkShotMap({ ...map, ...patch }, segs); // "with" is a reserved word in a module
  assert.match(patched({ cuts: { bad: { "beat-4-severity-cross-check-on-device-1": "nope" } } }).join("\n"), /cut "bad": "nope" is not a narration id/);
  assert.match(patched({ cuts: { bad: { nope: "planb-beat-2" } } }).join("\n"), /cut "bad": "nope" is not a narration id/);
  assert.match(patched({ cuts: { bad: { "beat-4-severity-cross-check-on-device-1": "beat-2-offline-capture-on-device-engine-1" } } }).join("\n"), /is a main narration line — a cut may only swap in an alternate/);
  assert.match(patched({ cuts: { bad: "nope" } }).join("\n"), /cut "bad" is not a mapping/);
  assert.match(patched({ onDeviceBadge: { "planb-beat-2": "sometimes" } }).join("\n"), /"sometimes", not required \| either \| absent/);
  assert.match(patched({ onDeviceBadge: { ghost: "required" } }).join("\n"), /"ghost" is not a narration id/);
  for (const mark of ["required", "either", "absent"]) assert.deepEqual(patched({ onDeviceBadge: { "planb-beat-2": mark } }), []);
  assert.deepEqual(patched({ cloudBadge: { "beat-2-offline-capture-on-device-engine-2": "required" } }), []);
  assert.match(patched({ cloudBadge: { "planb-beat-2": "either" } }).join("\n"), /cloud mark of "planb-beat-2" is "either", not required/);
  assert.match(patched({ cloudBadge: { ghost: "required" } }).join("\n"), /cloud mark: "ghost" is not a narration id/);
  // the real script: the three lines that presume the cloud carry the cloud mark
  const real = parseShotMap(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "submission", "VIDEO-SCRIPT-EN.md"), "utf8"));
  assert.deepEqual(Object.keys(real.cloudBadge ?? {}).sort(), ["act-3-how-it-s-built-1", "act2-beat2-FB", "beat-6-report-drafting-cloud-engine-1"]);
  assert.ok(Object.values(real.cloudBadge).every((m) => m === "required"));
});
