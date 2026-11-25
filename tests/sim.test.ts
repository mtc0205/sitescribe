import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTE_MARK, RECORDS_MARK, SIMULATED_ANSWER_TEXT, parseRecordsText, simulatedReport, simulatedText } from "../src/sim.ts";

// The first line of the report prompt in ai.ts. It is why the old detection went wrong:
// the report prompt contains "structured defect record" too.
const REPORT_PROMPT_HEAD = "You are drafting a field inspection report section from structured defect records.";
const STRUCTURE_PROMPT_HEAD = "Convert the engineer's spoken/typed note into ONE structured defect record.";

/** Exactly the line draftReport() in ai.ts writes for one record. */
const line = (i, r) => `${i + 1}. [${r.severity}] ${r.defectType} — ${r.component} (${r.quantity})${r.notes ? `; ${r.notes}` : ""}`;
const RECORDS = [
  { severity: "severe", defectType: "spalling with exposed rebar", component: "pier P1", quantity: "~30 cm patch", notes: "Exposed reinforcement — reference card says severe." },
  { severity: "moderate", defectType: "longitudinal crack", component: "web of girder G2", quantity: "~2mm wide, ~3m long", notes: "" },
  { severity: "minor", defectType: "transverse crack", component: "deck slab near support S2-1", quantity: "hairline, single", notes: "Monitor at next visit; no measurement taken today." },
];
const recordsText = RECORDS.map((r, i) => line(i, r)).join("\n");

// ---- the regression: which simulated call is which ----

test("a report prompt gets a report, although it contains 'structured defect record' too", () => {
  const reportPrompt = `${REPORT_PROMPT_HEAD}\nGroup related defects by component.\nOutput clean Markdown.${RECORDS_MARK}${recordsText}`;
  assert.ok(reportPrompt.includes("structured defect record")); // the phrase that used to misroute it
  const text = simulatedText(reportPrompt);
  assert.ok(text.startsWith("## Simulated inspection report"), text.slice(0, 80));
  assert.ok(!text.startsWith("{"), "not a JSON record built from the prompt");
});

test("a structuring prompt gets the rule-based record of its note — and only of the note", () => {
  const note = "Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long.";
  const structurePrompt = `${STRUCTURE_PROMPT_HEAD}\nReply with ONLY a JSON object.${NOTE_MARK}${note}`;
  const record = JSON.parse(simulatedText(structurePrompt));
  assert.equal(record.component, "girder G2");
  assert.equal(record.defectType, "longitudinal crack");
  assert.equal(record.quantity, "2 mm, 3 m");
  assert.equal(record.notes, note); // none of the prompt text leaks into the record
});

test("every other simulated call gets the placeholder that says it is simulated", () => {
  assert.equal(simulatedText("Answer in at most 4 short sentences.\n\nQuestion: What does efflorescence indicate?"), SIMULATED_ANSWER_TEXT);
  assert.match(SIMULATED_ANSWER_TEXT, /\(simulated/);
  assert.equal(simulatedText(""), SIMULATED_ANSWER_TEXT);
});

// ---- the simulated report itself ----

test("the simulated report is report-shaped, says it is simulated, and lists what it was given", () => {
  const report = simulatedReport(recordsText);
  const lines = report.split("\n");
  assert.equal(lines[0], "## Simulated inspection report");
  assert.match(lines[2], /\(simulated cloud output/);
  assert.match(report, /no report was drafted/);
  assert.ok(report.includes("### Records in this draft (3)"));
  assert.ok(report.includes("- **[severe]** spalling with exposed rebar — pier P1 (~30 cm patch)"));
  assert.ok(report.includes("- **[minor]** transverse crack — deck slab near support S2-1 (hairline, single)"));
  // severe and moderate records are flagged by number, and the rule is called simulated
  assert.ok(report.includes("### Recommended follow-up (simulated)"));
  assert.ok(report.includes("- (simulated) Engineer review of records 1, 2 — flagged severe or moderate."));
  // nothing is invented beyond what the list says
  assert.ok(!/recommend repainting|within \d+ weeks/i.test(report));
});

test("the simulated report with nothing flagged says so, and survives an empty list", () => {
  const mild = ["unclassified observation", "efflorescence"].map((defectType, i) => line(i, { severity: "unknown", defectType, component: "wall W1", quantity: "not stated", notes: "" })).join("\n");
  assert.ok(simulatedReport(mild).includes("- (none is flagged severe or moderate)"));
  const empty = simulatedReport("");
  assert.ok(empty.startsWith("## Simulated inspection report"));
  assert.ok(empty.includes("### Records in this draft (0)"));
  assert.ok(empty.includes("- (no records were given)"));
});

test("parseRecordsText reads the list line by line, notes included", () => {
  const parsed = parseRecordsText(recordsText);
  assert.deepEqual(parsed.map((r) => [r.n, r.severity, r.component, r.quantity]), [
    [1, "severe", "pier P1", "~30 cm patch"],
    [2, "moderate", "web of girder G2", "~2mm wide, ~3m long"],
    [3, "minor", "deck slab near support S2-1", "hairline, single"],
  ]);
  assert.equal(parsed[0].notes, "Exposed reinforcement — reference card says severe.");
  assert.equal(parsed[1].notes, "");
  assert.equal(parsed[2].notes, "Monitor at next visit; no measurement taken today.");
  // the marker line itself and blank lines are not records
  assert.deepEqual(parseRecordsText(`\n${recordsText}\n\n`), parsed);
});
