import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeFromSource, recordEngine, recordEngineLabel, settleStructureReply, hybridModelParams } from "../src/engine.ts";
import { ruleBasedStructure } from "../src/extract.ts";
import { DEFAULT_CLOUD_MODEL } from "../src/flags.ts";
import type { EngineBadgeInfo } from "../src/types.ts";

// ---- which cloud model a hybrid call names ----

test("hybridModelParams names the cloud model where SDK 13.4.0 reads it: inCloudParams.model", () => {
  const params = hybridModelParams("prefer_on_device", "gemini-3.8-flash");
  assert.deepEqual(params, { mode: "prefer_on_device", inCloudParams: { model: "gemini-3.8-flash" } });
  // A top-level `model` next to a hybrid `mode` is what the SDK ignores ("… will be ignored"),
  // calling its own default instead — so there must not be one.
  assert.ok(!("model" in params));
});

test("the configured model is passed through unchanged, and the default is gemini-3.8-flash", () => {
  assert.equal(hybridModelParams("only_in_cloud", "some-other-model").inCloudParams.model, "some-other-model");
  assert.equal(DEFAULT_CLOUD_MODEL, "gemini-3.8-flash");
  assert.equal(hybridModelParams("prefer_on_device", DEFAULT_CLOUD_MODEL).inCloudParams.model, "gemini-3.8-flash");
});

const NOTE = "Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long.";
const GOOD_JSON = JSON.stringify({
  component: "web of girder G2",
  defectType: "longitudinal crack",
  quantity: "~2mm wide, ~3m long",
  severity: "moderate",
  notes: "seepage with white efflorescence nearby",
});

test("badgeFromSource reads the engine off the SDK's inferenceSource, never off the request", () => {
  const onDevice = badgeFromSource("on_device", true);
  assert.equal(onDevice.engine, "on_device");
  assert.equal(onDevice.label, "On-device · Gemini Nano");
  assert.equal(onDevice.fellBack, false);

  const fellBack = badgeFromSource("in_cloud", true);
  assert.equal(fellBack.engine, "in_cloud");
  assert.equal(fellBack.fellBack, true);
  assert.equal(fellBack.label, "Fell back to cloud · Gemini");

  const cloud = badgeFromSource("in_cloud", false); // a cloud task (report drafting)
  assert.equal(cloud.fellBack, false);
  assert.equal(cloud.label, "Cloud · Gemini");
});

// ---- edge case (b): the SDK omits inferenceSource ----

test("a reply without inferenceSource is badged Engine unknown, not guessed", () => {
  const badge = badgeFromSource(undefined, true);
  assert.equal(badge.label, "Engine unknown");
  assert.equal(badge.engineUnknown, true);
  assert.equal(badge.engine, "pending");
});

test("recordEngine: a record whose model is unnamed is stored as unknown, not rule_based", () => {
  const reply = badgeFromSource(undefined, true);
  const outcome = settleStructureReply(GOOD_JSON, reply, NOTE);
  assert.equal(outcome.fromModel, true); // the model DID produce the fields
  assert.equal(recordEngine(outcome.badge), "unknown");
  assert.match(recordEngineLabel(recordEngine(outcome.badge)), /engine unknown/i);
});

test("recordEngine: every other answer maps to the engine that produced the fields", () => {
  assert.equal(recordEngine(badgeFromSource("on_device", true)), "on_device");
  assert.equal(recordEngine(badgeFromSource("in_cloud", true)), "in_cloud");
  assert.equal(recordEngine(badgeFromSource("in_cloud", false)), "in_cloud");
  const noEngine: EngineBadgeInfo = { engine: "unavailable", label: "Rule-based fallback (no AI engine reachable)" };
  assert.equal(recordEngine(noEngine), "rule_based");
});

// ---- edge case (a): a model answers, but its JSON is unusable ----

test("unusable reply: the record is rule-based, whichever model replied", () => {
  const replies = [
    badgeFromSource("on_device", true),
    badgeFromSource("in_cloud", true),
    badgeFromSource("in_cloud", false),
    badgeFromSource(undefined, true),
  ];
  const expected = ["Gemini Nano", "Gemini", "Gemini", "The engine"];
  const unusable = [
    "I cannot help with that.", // prose
    "", // nothing
    "[1, 2, 3]", // JSON, but not an object
    '{"defectType":"crack"}', // an object, but no component
    '{"component":"pier P1","defectType":', // truncated
  ];
  replies.forEach((replyBadge, i) => {
    for (const text of unusable) {
      const outcome = settleStructureReply(text, replyBadge, NOTE);
      assert.equal(outcome.fromModel, false, `reply ${i} / "${text}"`);
      // the fields are the rule-based extractor's, and the record is badged rule-based
      const rules = ruleBasedStructure(NOTE);
      for (const key of ["component", "defectType", "quantity", "severity"] as const) {
        assert.equal(outcome.record[key], rules[key], `${key} for reply ${i} / "${text}"`);
      }
      assert.equal(outcome.badge.engine, "unavailable");
      assert.match(outcome.badge.label, /^Rule-based \(/);
      assert.ok(outcome.badge.label.includes(expected[i]), `label names the engine that replied: ${outcome.badge.label}`);
      assert.equal(recordEngine(outcome.badge), "rule_based");
      // …while the record says that the model did answer
      assert.equal(outcome.record.notes, `${rules.notes} [${expected[i]} replied, but its reply was not usable JSON — fields structured by rules]`);
    }
  });
});

test("usable reply: the model's fields and the model's own badge, untouched", () => {
  for (const source of ["on_device", "in_cloud", undefined] as const) {
    const replyBadge = badgeFromSource(source, true);
    const outcome = settleStructureReply("```json\n" + GOOD_JSON + "\n```", replyBadge, NOTE);
    assert.equal(outcome.fromModel, true, String(source));
    assert.deepEqual(outcome.record, JSON.parse(GOOD_JSON));
    assert.equal(outcome.badge, replyBadge);
    assert.equal(recordEngine(outcome.badge), source === "on_device" ? "on_device" : source === "in_cloud" ? "in_cloud" : "unknown");
  }
});

// ---- record-card chip text ----

test("recordEngineLabel: one honest label per stored engine", () => {
  assert.equal(recordEngineLabel("on_device"), "⚡ on-device");
  assert.equal(recordEngineLabel("in_cloud"), "☁ cloud");
  assert.equal(recordEngineLabel("rule_based"), "⚙ rule-based");
  assert.equal(recordEngineLabel("unknown"), "⏳ engine unknown");
});

test("recordEngineLabel: only a record made under the demo simulation says (simulated)", () => {
  assert.equal(recordEngineLabel("in_cloud", true), "☁ cloud (simulated)");
  for (const extractedBy of ["on_device", "in_cloud", "rule_based", "unknown"] as const) {
    assert.doesNotMatch(recordEngineLabel(extractedBy), /simulated/i); // a real record never does
  }
  assert.doesNotMatch(recordEngineLabel("rule_based", true), /simulated/i); // its fields really are the rules'
});
