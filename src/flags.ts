/**
 * Remote Config feature switches — the gate decision and the demo-only override.
 *
 * `feature_report_drafting` and `feature_severity_check` are kill-switches (SPEC §7):
 * when one is false the feature is not offered — its control is disabled with a
 * one-line explanation — and no request is sent. Both default to true.
 *
 * Pure (no SDK / browser state), so the decision is unit-tested in plain node
 * (tests/flags.test.ts).
 */

export interface FeatureFlags {
  reportDrafting: boolean;
  severityCheck: boolean;
}

export const FEATURE_DEFAULTS: FeatureFlags = { reportDrafting: true, severityCheck: true };

export type GatedFeature = keyof FeatureFlags;

export interface FeatureGate {
  /** False: the control is disabled and nothing is requested. */
  offered: boolean;
  /** One honest line for the disabled control (empty when offered). */
  explanation: string;
}

const KEYS: Record<GatedFeature, string> = {
  reportDrafting: "feature_report_drafting",
  severityCheck: "feature_severity_check",
};
const NAMES: Record<GatedFeature, string> = {
  reportDrafting: "Report drafting",
  severityCheck: "The severity cross-check",
};

/**
 * What the UI does with `feature`, given the flags in force. Only an explicit
 * `false` switches a feature off — the defaults are `true`.
 * `via` names where the value came from, for the explanation ("Remote Config").
 */
export function featureGate(flags: FeatureFlags, feature: GatedFeature, via = "Remote Config"): FeatureGate {
  if (flags[feature] !== false) return { offered: true, explanation: "" };
  return {
    offered: false,
    explanation: `${NAMES[feature]} is switched off by ${via} (${KEYS[feature]} = false) — no request is sent.`,
  };
}

/**
 * Demo-mode-only override: `?feature_report_drafting=false` and/or
 * `?feature_severity_check=false` — the Remote Config key names, so the
 * switched-off UI can be exercised without a Firebase project. Only the literal
 * "false" switches a feature off; returns just the keys that were switched off.
 * (Applied in demo mode only — see firebase.ts. In emulator and live mode Remote
 * Config alone decides.)
 */
export function parseFlagOverrides(search: string): Partial<FeatureFlags> {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return {};
  }
  const out: Partial<FeatureFlags> = {};
  if (params.get(KEYS.reportDrafting) === "false") out.reportDrafting = false;
  if (params.get(KEYS.severityCheck) === "false") out.severityCheck = false;
  return out;
}
