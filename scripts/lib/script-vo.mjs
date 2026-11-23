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
 * Every narration line of the script, in reading order.
 * A narration line is a blockquote that is one quoted sentence:
 *   > "…"
 * Its id is `<slug of the nearest heading>-<n>`; the ⚠FB alternate line
 * (inline, not a blockquote) becomes `act2-beat2-FB`.
 */
export function parseNarration(md) {
  const segments = [];
  let heading = "part";
  for (const line of md.split(/\r?\n/)) {
    const h = /^#{2,4}\s+(.*)$/.exec(line);
    if (h) heading = slugHeading(h[1]);
    const q = /^>\s*"(.+)"\s*$/m.exec(line.trim());
    if (q) {
      segments.push({
        id: `${heading}-${segments.filter((s) => s.id.startsWith(heading)).length + 1}`,
        text: q[1].replace(/\s+/g, " ").trim(),
        heading,
      });
    }
  }
  const fb = /⚠FB line if no Nano:\s*"(.+)"/.exec(md);
  if (fb) segments.push({ id: "act2-beat2-FB", text: fb[1].replace(/\s+/g, " ").trim(), heading: "act2-beat2", alternate: true });
  return segments;
}

/**
 * The shot ↔ narration map: a fenced ```json block in the script that
 * contains a "shots" array. Each entry: { shot, vo: [segment ids], … };
 * "alternates" maps a segment id to its ⚠FB replacement for the no-Nano cut.
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
  for (const s of segments) if (!s.alternate && !used.has(s.id)) problems.push(`narration "${s.id}" is not covered by any shot`);
  return problems;
}
