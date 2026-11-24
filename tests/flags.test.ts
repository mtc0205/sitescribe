import { test } from "node:test";
import assert from "node:assert/strict";
import { featureGate, parseFlagOverrides, FEATURE_DEFAULTS } from "../src/flags.ts";

test("the defaults offer both features", () => {
  assert.deepEqual(FEATURE_DEFAULTS, { reportDrafting: true, severityCheck: true });
  assert.deepEqual(featureGate(FEATURE_DEFAULTS, "reportDrafting"), { offered: true, explanation: "", detail: "" });
  assert.deepEqual(featureGate(FEATURE_DEFAULTS, "severityCheck"), { offered: true, explanation: "", detail: "" });
});

test("a flag that is false switches its feature off, with a one-line explanation", () => {
  const off = { reportDrafting: false, severityCheck: false };
  assert.deepEqual(featureGate(off, "reportDrafting"), {
    offered: false,
    explanation: "Report drafting is switched off by Remote Config — no request is sent.",
    detail: "Report drafting is switched off by Remote Config — no request is sent. Switch: feature_report_drafting = false.",
  });
  assert.deepEqual(featureGate(off, "severityCheck"), {
    offered: false,
    explanation: "The severity cross-check is switched off by Remote Config — no request is sent.",
    detail: "The severity cross-check is switched off by Remote Config — no request is sent. Switch: feature_severity_check = false.",
  });
});

test("the explanation is one sentence on one line, and the tooltip adds the switch's key", () => {
  for (const feature of ["reportDrafting", "severityCheck"] as const) {
    for (const via of ["Remote Config", "the demo URL flag"]) {
      const g = featureGate({ reportDrafting: false, severityCheck: false }, feature, via);
      assert.match(g.explanation, /^[^.]*— no request is sent\.$/, `${feature} / ${via}`); // no sentence break before the dash
      assert.ok(g.explanation.length <= 90, `one line of about 105 characters at the narrowest reading column: ${g.explanation.length}`);
      assert.ok(g.detail.startsWith(g.explanation + " Switch: "), `${feature} / ${via}`);
      assert.match(g.detail, /feature_(report_drafting|severity_check) = false\.$/);
    }
  }
});

test("one flag off leaves the other feature untouched", () => {
  const flags = { reportDrafting: false, severityCheck: true };
  assert.equal(featureGate(flags, "reportDrafting").offered, false);
  assert.equal(featureGate(flags, "severityCheck").offered, true);
  assert.deepEqual(featureGate({ ...flags, reportDrafting: true, severityCheck: false }, "severityCheck").offered, false);
});

test("only an explicit false switches a feature off", () => {
  for (const value of [true, undefined, null, 0, "false"]) {
    assert.equal(featureGate({ reportDrafting: value as boolean, severityCheck: true }, "reportDrafting").offered, true, `value: ${String(value)}`);
  }
});

test("the explanation names where the value came from", () => {
  const gate = featureGate({ reportDrafting: false, severityCheck: true }, "reportDrafting", "the demo URL flag");
  assert.equal(gate.explanation, "Report drafting is switched off by the demo URL flag — no request is sent.");
});

test("parseFlagOverrides reads the Remote Config key names, only for a literal false", () => {
  assert.deepEqual(parseFlagOverrides("?feature_report_drafting=false"), { reportDrafting: false });
  assert.deepEqual(parseFlagOverrides("?feature_severity_check=false"), { severityCheck: false });
  assert.deepEqual(parseFlagOverrides("?engine=off&feature_report_drafting=false&feature_severity_check=false"), { reportDrafting: false, severityCheck: false });
  // anything else leaves the defaults alone
  assert.deepEqual(parseFlagOverrides(""), {});
  assert.deepEqual(parseFlagOverrides("?engine=sim_cloud"), {});
  assert.deepEqual(parseFlagOverrides("?feature_report_drafting=true&feature_severity_check=0"), {});
  assert.deepEqual(parseFlagOverrides("?feature_report_drafting=False"), {}); // case-sensitive on purpose
  // never throws
  assert.deepEqual(parseFlagOverrides("%%not=a=valid=query%%"), {});
});
