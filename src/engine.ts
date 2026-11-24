/**
 * Engine attribution — pure decisions about which engine produced what.
 *
 * One rule drives this file: a record, and the chip on it, name the engine that
 * produced its FIELDS. An engine that replied with text that could not be used
 * does not get the credit — the rule-based structurer produced the fields — and
 * an engine the SDK did not name is never guessed at.
 *
 * No SDK / browser dependencies, so the decisions are unit-tested in plain node
 * (tests/engine.test.ts), the same way extract.ts and format.ts are.
 */
import type { DefectRecord, EngineBadgeInfo } from "./types.ts";
import { repairJson, ruleBasedStructure } from "./extract.ts";
import type { DefectJson } from "./extract.ts";

/** What the SDK reports as the source of a reply (`GenerateContentResponse.inferenceSource`). */
export type InferenceSource = "on_device" | "in_cloud";

/** Badge for a reply the SDK delivered. One without `inferenceSource` is badged
 *  "Engine unknown" — the field is optional, and the engine is never guessed. */
export function badgeFromSource(source: InferenceSource | undefined, requestedOnDevice: boolean): EngineBadgeInfo {
  if (source === "on_device") return { engine: "on_device", fellBack: false, label: "On-device · Gemini Nano" };
  if (source === "in_cloud") {
    return requestedOnDevice
      ? { engine: "in_cloud", fellBack: true, label: "Fell back to cloud · Gemini" }
      : { engine: "in_cloud", fellBack: false, label: "Cloud · Gemini" };
  }
  return { engine: "pending", engineUnknown: true, label: "Engine unknown" };
}

/**
 * `extractedBy` for a record whose answer carried `badge`: the engine that
 * produced the fields — what the record card shows and what is stored.
 *
 * Only answer badges are passed here (never the warm-up or download events):
 *   model fields      → that engine
 *   "Engine unknown"  → "unknown": the model DID produce the fields, the SDK just did not say which one
 *   anything else     → "rule_based": no model replied, or the reply was unusable (see settleStructureReply)
 */
export function recordEngine(badge: EngineBadgeInfo): DefectRecord["extractedBy"] {
  if (badge.engineUnknown) return "unknown";
  if (badge.engine === "on_device") return "on_device";
  if (badge.engine === "in_cloud") return "in_cloud";
  return "rule_based";
}

/** Text of the engine chip on a record card (SPEC §4.3). A record made under the demo's
 *  cloud-state simulation says so for as long as it exists — the engine named in
 *  `extractedBy` never ran — whether or not the simulation is still on. */
export function recordEngineLabel(extractedBy: DefectRecord["extractedBy"], simulated = false): string {
  const base =
    extractedBy === "on_device" ? "⚡ on-device" :
    extractedBy === "in_cloud" ? "☁ cloud" :
    extractedBy === "unknown" ? "⏳ engine unknown" :
    "⚙ rule-based";
  return simulated && extractedBy !== "rule_based" ? `${base} (simulated)` : base;
}

/** What an F1 call produced from the engine's reply. */
export interface StructureOutcome {
  record: DefectJson;
  /** The badge that is true for `record` — not always the one the reply carried. */
  badge: EngineBadgeInfo;
  /** The model's fields were used. False: the reply was unusable and the rules structured the note. */
  fromModel: boolean;
}

/** Can this parsed value stand in as a defect record? */
export function usableDefectJson(value: unknown): value is DefectJson {
  return !!value && typeof value === "object" && typeof (value as DefectJson).component === "string";
}

/** The engine that answered, in words — for a record its reply could not produce. */
function repliedWith(replyBadge: EngineBadgeInfo): string {
  if (replyBadge.engine === "on_device") return "Gemini Nano";
  if (replyBadge.engine === "in_cloud") return "Gemini";
  return "The engine";
}

/**
 * F1 outcome of a reply that arrived: the record, and the badge that is true for it.
 *
 * Usable JSON → the model's fields and the model's badge. Anything else (no JSON
 * object, text that does not parse, a shape that is not a defect record) → the
 * fields come from the rule-based extractor, and the record is badged — and
 * stored — as rule-based, while its notes and badge say that the engine did
 * reply. Until 2026-11-25 such a record carried the model's chip.
 */
export function settleStructureReply(replyText: string, replyBadge: EngineBadgeInfo, note: string): StructureOutcome {
  let parsed: unknown = null;
  try {
    parsed = repairJson(replyText);
  } catch {
    parsed = null; // not JSON at all
  }
  if (usableDefectJson(parsed)) return { record: parsed, badge: replyBadge, fromModel: true };

  const fallback = ruleBasedStructure(note);
  const who = repliedWith(replyBadge);
  return {
    record: { ...fallback, notes: `${fallback.notes} [${who} replied, but its reply was not usable JSON — fields structured by rules]`.trim() },
    badge: {
      engine: "unavailable",
      label: `Rule-based (${who} replied, but not with usable JSON)`,
      short: "Rule-based (reply unusable)",
    },
    fromModel: false,
  };
}
