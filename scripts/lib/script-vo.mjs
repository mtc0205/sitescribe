/**
 * Narration parser for submission/VIDEO-SCRIPT-EN.md — the single source of
 * truth for the film's words AND for which shot carries which narration.
 *
 * Used by scripts/make-vo.mjs (renders one MP3 per segment, file name = id)
 * and scripts/assemble-video.mjs (places + subtitles the same segments).
 * Pure: string in, data out (unit-tested in tests/script-vo.test.mjs).
 */

/** slugify a heading exactly the way the VO files were named on 2026-11-23. */
function slugHeading(raw) {
  return raw
    .replace(/\([^)]*\)/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/**
 * A plan-B line: an inline (not blockquoted) line that replaces one main line in a named cut.
 *   ⚠PLAN-B planb-beat-4 (on-device badge on screen: not required) "…"
 * Its id is written in the line; the mark says whether the words are true only while an
 * on-device badge is on camera — `required` (true only then), `must be absent` (written for the
 * rule-based fallback: false over on-device footage), `not required` (true either way). The
 * assembler checks the mark against the badges the capture quoted from the screen.
 */
const PLAN_B = /⚠PLAN-B\s+`?([\w-]+)`?\s*\(on-device badge on screen:\s*(required|not required|must be absent)\)[^"]*"(.+)"/;
const ON_DEVICE_MARK = { required: "required", "not required": "either", "must be absent": "absent" };

/**
 * Every narration line of the script, in reading order.
 * A narration line is a blockquote that is one quoted sentence:
 *   > "…"
 * Its id is `<slug of the nearest heading>-<n>`; the ⚠FB alternate line
 * (inline, not a blockquote) becomes `act2-beat2-FB`, and every ⚠PLAN-B line
 * becomes an alternate with the id it names (see PLAN_B above).
 */
export function parseNarration(md) {
  const segments = [];
  const alternates = [];
  let heading = "part";
  for (const line of md.split(/\r?\n/)) {
    const h = /^#{2,4}\s+(.*)$/.exec(line);
    if (h) heading = slugHeading(h[1]);
    const pb = PLAN_B.exec(line.trim());
    if (pb) {
      alternates.push({ id: pb[1], text: pb[3].replace(/\s+/g, " ").trim(), heading, alternate: true, onDeviceBadge: ON_DEVICE_MARK[pb[2]] });
      continue;
    }
    const q = /^>\s*"(.+)"\s*$/m.exec(line.trim());
    if (q) {
      segments.push({
        id: `${heading}-${segments.filter((s) => s.id.startsWith(heading)).length + 1}`,
        text: q[1].replace(/\s+/g, " ").trim(),
        heading,
      });
    }
  }
  segments.push(...alternates);
  const fb = /⚠FB line if no Nano:\s*"(.+)"/.exec(md);
  if (fb) segments.push({ id: "act2-beat2-FB", text: fb[1].replace(/\s+/g, " ").trim(), heading: "act2-beat2", alternate: true });
  return segments;
}

/**
 * The shot ↔ narration map: a fenced ```json block in the script that
 * contains a "shots" array. Each entry: { shot, vo: [segment ids], … };
 * "alternates" maps a segment id to its ⚠FB replacement for the no-Nano cut;
 * "cuts" holds named cuts (e.g. "plan-b"), each a mapping { main id: alternate id }
 * the assembler applies with --cut <name>;
 * "onDeviceBadge" marks lines whose truth depends on an on-device badge being on
 * camera: "required" | "either" | "absent" (the same words as the ⚠PLAN-B lines).
 * Returns null when the script has no such block.
 */
export function parseShotMap(md) {
  const blocks = [...md.matchAll(/```json[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const body of blocks) {
    try {
      const j = JSON.parse(body);
      if (j && Array.isArray(j.shots)) return j;
    } catch {
      /* not JSON — keep looking */
    }
  }
  return null;
}

/** Validate a map against the parsed narration: every vo id must be a real segment. */
export function checkShotMap(map, segments) {
  const known = new Set(segments.map((s) => s.id));
  const problems = [];
  const used = new Set();
  for (const s of map?.shots ?? []) {
    for (const id of s.vo ?? []) {
      if (!known.has(id)) problems.push(`shot "${s.shot}" references unknown narration id "${id}"`);
      else if (!used.has(id)) used.add(id);
      else problems.push(`narration "${id}" is used by more than one shot`);
    }
  }
  for (const [from, to] of Object.entries(map?.alternates ?? {})) {
    if (!known.has(from)) problems.push(`alternate source "${from}" is not a narration id`);
    if (!known.has(to)) problems.push(`alternate target "${to}" is not a narration id`);
  }
  for (const [cut, swaps] of Object.entries(map?.cuts ?? {})) {
    if (!swaps || typeof swaps !== "object") {
      problems.push(`cut "${cut}" is not a mapping of { main narration id: alternate id }`);
      continue;
    }
    for (const [from, to] of Object.entries(swaps)) {
      if (!known.has(from)) problems.push(`cut "${cut}": "${from}" is not a narration id`);
      if (!known.has(to)) problems.push(`cut "${cut}": "${to}" is not a narration id`);
      else if (!segments.find((s) => s.id === to)?.alternate) problems.push(`cut "${cut}": "${to}" is a main narration line — a cut may only swap in an alternate`);
    }
  }
  for (const [id, mark] of Object.entries(map?.onDeviceBadge ?? {})) {
    if (!known.has(id)) problems.push(`on-device mark: "${id}" is not a narration id`);
    if (!["required", "either", "absent"].includes(mark)) problems.push(`on-device mark of "${id}" is "${mark}", not required | either | absent`);
  }
  for (const [id, mark] of Object.entries(map?.cloudBadge ?? {})) {
    if (!known.has(id)) problems.push(`cloud mark: "${id}" is not a narration id`);
    if (mark !== "required") problems.push(`cloud mark of "${id}" is "${mark}", not required`);
  }
  for (const s of segments) if (!s.alternate && !used.has(s.id)) problems.push(`narration "${s.id}" is not covered by any shot`);
  return problems;
}
