import { test } from "node:test";
import assert from "node:assert/strict";
import { ruleBasedStructure, ruleBasedCrossCheck, repairJson } from "../src/extract.ts";

test("ruleBasedStructure recognises defect vocabulary", () => {
  const cases: [string, string][] = [
    ["Longitudinal crack on web of girder G2, about 2 mm wide", "longitudinal crack"],
    ["Hairline transverse crack near support, 0.1 mm", "transverse crack"],
    ["White efflorescence deposit near the pier base", "efflorescence"],
    ["Active water seepage on the wall", "seepage"],
    ["Concrete spalling with exposed rebar on pier P1", "spalling"],
    ["Hollow sound, suspected delamination", "delamination"],
    ["Rust staining, reinforcement exposure at bearing", "corrosion / exposed reinforcement"],
    ["Deck visibly sagging between piers", "excessive deflection"],
    ["Paint flaking", "unclassified observation"],
  ];
  for (const [note, expected] of cases) {
    assert.equal(ruleBasedStructure(note).defectType, expected, `note: ${note}`);
  }
});

test("ruleBasedStructure extracts component and keeps measurements verbatim", () => {
  const r = ruleBasedStructure("Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long");
  assert.equal(r.component, "girder G2");
  assert.equal(r.quantity, "2 mm, 3 m");
});

test("ruleBasedStructure severity ladder", () => {
  assert.equal(ruleBasedStructure("crack, 2 mm wide").severity, "moderate");
  assert.equal(ruleBasedStructure("hairline crack, 0.1 mm").severity, "minor");
  assert.equal(ruleBasedStructure("spalling with exposed rebar").severity, "severe");
  assert.equal(ruleBasedStructure("some staining").severity, "unknown");
});

test("repairJson unwraps markdown fences and picks the JSON object", () => {
  const fixed = repairJson('```json\n{"component":"pier P1","defectType":"crack","quantity":"","severity":"unknown","notes":""}\n```');
  assert.equal(fixed.component, "pier P1");
  assert.equal(repairJson('prefix text {"a":1} trailing').a, 1);
  assert.throws(() => repairJson("no json here"), /no JSON object found/);
});

test("ruleBasedCrossCheck thresholds and rebar rule", () => {
  assert.match(ruleBasedCrossCheck({ component: "x", defectType: "crack", quantity: "0.1 mm", severity: "minor", notes: "" }), /hairline/);
  assert.match(ruleBasedCrossCheck({ component: "x", defectType: "crack", quantity: "2 mm", severity: "moderate", notes: "" }), /specialist/);
  assert.match(ruleBasedCrossCheck({ component: "x", defectType: "spalling", quantity: "", severity: "severe", notes: "exposed rebar" }), /SEVERE/);
  assert.match(ruleBasedCrossCheck({ component: "x", defectType: "staining", quantity: "not stated", severity: "unknown", notes: "" }), /measure crack width/i);
  assert.match(ruleBasedCrossCheck({ component: "x", defectType: "crack", quantity: "2 mm", severity: "moderate", notes: "" }), /Rule-based check/);
});
