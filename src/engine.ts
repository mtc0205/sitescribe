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
import type { AiAnswer, DefectRecord, EngineBadgeInfo } from "./types.ts";
import { repairJson, ruleBasedStructure, ruleBasedCrossCheck } from "./extract.ts";
import type { DefectJson } from "./extract.ts";

/**
 * What the app hands to `getGenerativeModel()` for a hybrid call. The cloud model has to
 * sit in `inCloudParams`: SDK 13.4.0 ignores a top-level `model` given next to a `mode`
 * (it warns "… will be ignored") and calls its own default instead — which is what
 * happened to every request until 2026-11-25, whatever Remote Config said.
 */
export function hybridModelParams<M extends string>(mode: M, cloudModel: string): { mode: M; inCloudParams: { model: string } } {
  return { mode, inCloudParams: { model: cloudModel } };
}

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

/* ---------- budgets: a hung network must degrade like a failed one ---------- */

/** Thrown when an engine call outlives its budget. A hung connection looks exactly like
 *  this — neither an answer nor an error, for as long as the browser lets it hang (84.5 s
 *  on 2026-11-25). */
export class BudgetExceeded extends Error {
  /** The budget that ran out, in whole seconds — for labels that say so. */
  readonly seconds: number;
  constructor(budgetMs: number) {
    super(`AI call timed out (${Math.round(budgetMs / 1000)}s)`);
    this.seconds = Math.round(budgetMs / 1000);
  }
}

/** What became of a call after its budget had been lost. */
export interface LateReply<T> {
  reply?: T;
  error?: unknown;
}

/**
 * Run `call` under a budget. Resolves with the reply if it arrives in time, rejects with
 * BudgetExceeded if it does not. A reply that arrives after the budget was lost is
 * dropped: `onLate` is told about it and nothing else ever sees it — so a late reply can
 * neither take the status chip nor change an answer that was already settled.
 */
export function withinBudget<T>(call: Promise<T>, budgetMs: number, onLate: (late: LateReply<T>) => void = () => {}): Promise<T> {
  let lost = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      lost = true;
      reject(new BudgetExceeded(budgetMs));
    }, budgetMs);
  });
  // The call's own fate after the budget does not matter any more, but it must be observed.
  call.then(
    (reply) => {
      if (lost) onLate({ reply });
    },
    (error) => {
      if (lost) onLate({ error });
    },
  );
  return Promise.race([call, budget]).finally(() => clearTimeout(timer));
}

/**
 * One engine call for F2-F4 under a budget. Exactly one engine event is emitted, and only
 * for the answer the user gets: the reply when it arrives in time, otherwise what
 * `withoutEngine` makes of the failure — a BudgetExceeded included. `withoutEngine` may
 * throw to pass a failure on to the caller instead. A reply that arrives late is dropped.
 */
export async function answerWithinBudget(
  call: () => Promise<AiAnswer>,
  budgetMs: number,
  withoutEngine: (reason: unknown) => AiAnswer,
  emit: (answer: AiAnswer) => void,
  onLate?: (late: LateReply<AiAnswer>) => void,
): Promise<AiAnswer> {
  try {
    const reply = await withinBudget(call(), budgetMs, onLate);
    emit(reply);
    return reply;
  } catch (e) {
    const fallback = withoutEngine(e);
    emit(fallback);
    return fallback;
  }
}

/* ---------- what the user gets when no engine answered (F2-F4) ---------- */

/** F2. A failure is "no engine reachable"; a timed-out call says that instead — a hung
 *  connection is not an offline device. */
export function fieldQaWithoutEngine(reason: unknown): AiAnswer {
  const captureStillWorks = "Defect capture still works: notes are structured by transparent rules and will sync later.";
  if (reason instanceof BudgetExceeded) {
    return {
      text: `No engine answered within ${reason.seconds} seconds — the on-device model and the cloud engine neither replied nor failed (a hung connection looks like this). ${captureStillWorks}`,
      badge: { engine: "unavailable", label: "No engine answered in time", short: "No engine answered in time" },
    };
  }
  return {
    text: `Field Q&A needs either the on-device model or a connection — none was reachable. ${captureStillWorks}`,
    badge: { engine: "unavailable", label: "No engine reachable (offline, no device model)", short: "No engine reachable" },
  };
}

/** F3. Only a timed-out call is answered here; any other failure is passed on to the
 *  caller, which reports it ("Report drafting failed: …"). The text is empty on purpose:
 *  the UI shows the badge alone, as it does offline. */
export function reportWithoutEngine(reason: unknown): AiAnswer {
  if (reason instanceof BudgetExceeded) {
    return {
      text: "",
      badge: { engine: "unavailable", label: "Report drafting timed out — the cloud engine did not answer in time", short: "Report drafting timed out" },
    };
  }
  throw reason;
}

/** F4. The rule-based cross-check against the same reference card, whatever kept the
 *  engine from answering. */
export function severityWithoutEngine(record: DefectJson, _reason: unknown): AiAnswer {
  return {
    text: ruleBasedCrossCheck(record),
    badge: { engine: "unavailable", label: "Rule-based fallback (no AI engine reachable)", short: "Rule-based fallback" },
  };
}
