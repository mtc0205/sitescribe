/**
 * The demo simulation's canned answers (SPEC §6.5) — pure text, no SDK or browser.
 *
 * With `?engine=sim_cloud` / `?engine=sim_fallback` the AI calls are short-circuited in
 * demo mode and answered locally, with a badge that says "(simulated)". What each call
 * gets is decided here, by the marker that identifies the prompt — never by a phrase the
 * prompts happen to share: until 2026-11-25 the report was picked by "inspection report",
 * but tested for "structured defect record" first, which the report prompt contains too,
 * so the "report" was a JSON record built from the prompt text.
 */

import { ruleBasedStructure, type DefectJson } from "./extract.ts";

/** Ends every F1 prompt; what follows is the engineer's note and nothing else. */
export const NOTE_MARK = "\n\nEngineer's note:\n";
/** Ends every F3 prompt; what follows is the numbered list of records. */
export const RECORDS_MARK = "\n\nRecords:\n";

/** F2 and F4: there is no cloud, so there is no answer either. */
export const SIMULATED_ANSWER_TEXT = "(simulated cloud answer — demonstrated for the engine-badge UI state only)";

/** One record as the report prompt lists it. */
export interface ListedRecord {
  n: number;
  severity: string;
  defectType: string;
  component: string;
  quantity: string;
  notes: string;
}

/** The numbered list draftReport() writes after RECORDS_MARK — one line per record:
 *  `1. [severe] spalling with exposed rebar — pier P1 (~30 cm patch); notes`. */
export function parseRecordsText(recordsText: string): ListedRecord[] {
  const out: ListedRecord[] = [];
  for (const line of recordsText.split("\n")) {
    const m = /^(\d+)\.\s+\[(\w+)\]\s+(.*?)\s+—\s+(.*?)\s+\(([^()]*)\)(?:;\s*(.*))?$/.exec(line.trim());
    if (m) out.push({ n: Number(m[1]), severity: m[2], defectType: m[3], component: m[4], quantity: m[5], notes: m[6] ?? "" });
  }
  return out;
}

/**
 * F3 under the simulation: a short report-shaped text that says it is simulated in its
 * second line. It lists the records it was given and flags the severe and moderate ones
 * by number — a fixed rule, not a drafted report, and it says so.
 */
export function simulatedReport(recordsText: string): string {
  const records = parseRecordsText(recordsText);
  const flagged = records.filter((r) => r.severity === "severe" || r.severity === "moderate");
  const levels = [...new Set(flagged.map((r) => r.severity))].join(" or ");
  return [
    "## Simulated inspection report",
    "",
    "_(simulated cloud output — no report was drafted; this text only demonstrates the “Cloud · Gemini (simulated)” badge state of the demo)_",
    "",
    `### Records in this draft (${records.length})`,
    ...(records.length ? records.map((r) => `- **[${r.severity}]** ${r.defectType} — ${r.component} (${r.quantity})`) : ["- (no records were given)"]),
    "",
    "### Recommended follow-up (simulated)",
    flagged.length
      ? `- (simulated) Engineer review of record${flagged.length === 1 ? "" : "s"} ${flagged.map((r) => r.n).join(", ")} — flagged ${levels}.`
      : "- (none is flagged severe or moderate)",
  ].join("\n");
}

/** What the simulation answers to `prompt`: the rule-based record for a structuring
 *  prompt, the simulated report for a report prompt, the placeholder for the rest. */
export function simulatedText(prompt: string): string {
  if (prompt.includes(NOTE_MARK)) return JSON.stringify(ruleBasedStructure((prompt.split(NOTE_MARK).pop() ?? "").trim()));
  if (prompt.includes(RECORDS_MARK)) return simulatedReport(prompt.split(RECORDS_MARK).pop() ?? "");
  return SIMULATED_ANSWER_TEXT;
}

/** The record a simulated structuring reply carries — for tests and for the log. */
export function simulatedRecord(prompt: string): DefectJson {
  return ruleBasedStructure((prompt.split(NOTE_MARK).pop() ?? "").trim());
}
