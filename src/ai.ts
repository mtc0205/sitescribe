/**
 * Hybrid inference layer — the heart of SiteScribe.
 *
 * Wraps Firebase AI Logic (`firebase/ai`) so every feature states its routing
 * intent once (see docs/SPEC.md §5) and the UI receives an honest engine badge
 * built from `GenerateContentResponse.inferenceSource`.
 */
import type { AiAnswer, EngineBadgeInfo } from "./types";
import { ruleBasedStructure, type DefectJson } from "./extract";
import {
  SYSTEM,
  badgeFromSource,
  hybridModelParams,
  answerWithinBudget,
  structureWithinBudget,
  fieldQaWithoutEngine,
  reportWithoutEngine,
  severityWithoutEngine,
} from "./engine";
import { DEFAULT_CLOUD_MODEL } from "./flags";

export type { DefectJson };

// Re-exported so the rest of the app never imports `firebase/ai` directly.
import {
  getGenerativeModel,
  InferenceMode,
  type GenerativeModel,
  type AI,
  type GenerateContentRequest,
} from "firebase/ai";

export { InferenceMode };

/** severity enum values shared by prompt + response schema. */
const SEVERITY_VALUES = ["unknown", "minor", "moderate", "severe"] as const;

const DEFECT_SCHEMA = {
  type: "object",
  properties: {
    component: { type: "string", description: "Structural member or location, e.g. 'web of girder G2'" },
    defectType: { type: "string", description: "Defect category, e.g. 'longitudinal crack', 'efflorescence'" },
    quantity: { type: "string", description: "Size/extent as stated, e.g. '~2mm wide, ~3m long'" },
    severity: { type: "string", enum: [...SEVERITY_VALUES] },
    notes: { type: "string", description: "Additional observations: seepage, corrosion, exposure, access constraints" },
  },
  required: ["component", "defectType", "quantity", "severity", "notes"],
} as const;

// The JSON shape is spelled out in the prompt itself because the on-device
// path of the SDK ignores `generationConfig` (responseSchema/responseMimeType)
// and only forwards the prompt text; the cloud path still enforces
// DEFECT_SCHEMA on top of it.
const STRUCTURE_PROMPT = `You are a field assistant for civil infrastructure inspection.
Convert the engineer's spoken/typed note into ONE structured defect record.
Reply with ONLY a JSON object — no prose, no Markdown, no code fences — with exactly these keys:
{"component": string, "defectType": string, "quantity": string, "severity": string, "notes": string}
- component: structural member or location, e.g. "web of girder G2"
- defectType: defect category in standard bridge/tunnel inspection vocabulary (e.g. longitudinal crack, spalling, efflorescence, seepage, delamination)
- quantity: size/extent exactly as stated, e.g. "~2mm wide, ~3m long"; keep the engineer's numbers and units, never invent precision
- severity: one of "unknown", "minor", "moderate", "severe"; judge only from explicit cues in the note; when unsure use "unknown"
- notes: short, factual, no advice (seepage, corrosion, exposure, access constraints)`;

const QA_PROMPT = `You are a field assistant for civil infrastructure inspection.
Answer in at most 4 short sentences, practical and safety-first.
The inspector may be offline under a structure; be direct, no follow-up questions.`;

const REPORT_PROMPT = `You are drafting a field inspection report section from structured defect records.
Group related defects by component, keep every measurement verbatim, flag records with severity "severe" or "moderate" for engineer review, and end with a short "Recommended follow-up" list.
Output clean Markdown.`;

/** Callback subscribers for engine state shown in the status bar: the badge, and the
 *  feature the event belongs to — SYSTEM for model state and download progress, so the
 *  subscriber can keep an answer's badge on the chip when a model-state line follows it. */
type EngineListener = (badge: EngineBadgeInfo, event: { feature: string }) => void;
const engineListeners = new Set<EngineListener>();
export function onEngineUpdate(fn: EngineListener): () => void {
  engineListeners.add(fn);
  return () => engineListeners.delete(fn);
}

/** Rolling log of engine events (SPEC §6.4), shown in the home screen's
 *  collapsed *Engine & diagnostics* section — there is no settings screen (§8). */
export interface EngineLogEntry {
  ts: string;
  feature: string;
  badge: EngineBadgeInfo;
}
const engineLog: EngineLogEntry[] = [];
export function getEngineLog(): readonly EngineLogEntry[] {
  return engineLog;
}
function emitEngine(badge: EngineBadgeInfo, feature: string = SYSTEM) {
  const entry: EngineLogEntry = { ts: new Date().toISOString(), feature, badge };
  // Download progress ticks every second or so: keep ONE rolling entry for the
  // download instead of flooding the log (50 ticks would hide every real event).
  if (badge.engine === "download" && engineLog[0]?.badge.engine === "download") engineLog[0] = entry;
  else engineLog.unshift(entry);
  if (engineLog.length > 50) engineLog.length = 50;
  engineListeners.forEach((fn) => fn(badge, { feature }));
}

/* ---------- engine simulation (demo mode only, always labelled) ----------
 *
 * The cloud backend only exists after the Firebase project is wired up
 * (post-hackathon-night). To let the UI demonstrate all four badge states
 * BEFORE that, `?engine=sim_cloud|sim_fallback` short-circuits `ask()` in
 * demo mode with a clearly labelled SIMULATED badge. Real runs never touch
 * this path: simulation requires BOTH demo mode AND the explicit URL flag,
 * and every simulated badge carries "(simulated)" in its label.
 */

export type SimulationKind = "off" | "cloud" | "fallback";

let simulation: SimulationKind = "off";

export function setEngineSimulation(kind: SimulationKind): void {
  simulation = kind;
}
/** The cloud-state simulation in effect right now. The URL flag counts only in demo
 *  mode (see isSimulated): in emulator and live mode nothing is simulated, so this
 *  says "off" there whatever the URL asks for — and so does every label in the UI. */
export function engineSimulation(): SimulationKind {
  return isSimulated() ? simulation : "off";
}

/** Read `?engine=` from the URL (called once at boot). */
export function initEngineSimulationFromUrl(): SimulationKind {
  try {
    const v = new URLSearchParams(location.search).get("engine");
    if (v === "sim_cloud" || v === "sim_fallback") simulation = v === "sim_cloud" ? "cloud" : "fallback";
    else simulation = "off";
  } catch {
    simulation = "off";
  }
  return simulation;
}

function isSimulated(): boolean {
  return (
    simulation !== "off" &&
    (globalThis as { __ssRuntimeMode?: string }).__ssRuntimeMode === "demo"
  );
}

function simulatedAnswer(prompt: string): AiAnswer {
  const wantsJson = prompt.includes("structured defect record");
  let text: string;
  if (wantsJson) {
    // Synthesise the record with the transparent rule-based extractor so the
    // demoed output stays plausible; the badge says the engine was simulated.
    const note = prompt.split("Engineer's note:").pop() ?? "";
    text = JSON.stringify(ruleBasedStructure(note.trim()));
  } else if (prompt.includes("inspection report")) {
    text = "## Simulated report draft\n\n(simulated cloud output — the real Gemini backend is wired at Firebase project creation)";
  } else {
    text = "(simulated cloud answer — demonstrated for the engine-badge UI state only)";
  }
  const badge: EngineBadgeInfo =
    simulation === "cloud"
      ? { engine: "in_cloud", fellBack: false, label: "Cloud · Gemini (simulated)" }
      : { engine: "in_cloud", fellBack: true, label: "Fell back to cloud · Gemini (simulated)" };
  // No engine event here: the caller emits it, once, for the answer that is used.
  return { text, badge };
}

let aiService: AI | null = null;
let cloudModelName: string = DEFAULT_CLOUD_MODEL;

/**
 * Bind the AI service to an initialized Firebase app.
 * Called once from firebase.ts after initializeApp().
 */
export function initAI(ai: AI, remoteCloudModel?: string): void {
  aiService = ai;
  if (remoteCloudModel) cloudModelName = remoteCloudModel;
}

/** A cloud model name that arrived after the AI service was bound (Remote Config is not
 *  awaited for the first render, see firebase.ts). Applies from the next call on. */
export function setCloudModel(name: string): void {
  if (name) cloudModelName = name;
}

function requireModel(mode: (typeof InferenceMode)[keyof typeof InferenceMode]): GenerativeModel {
  if (!aiService) throw new Error("AI service not initialized (no Firebase config)");
  // The cloud model is the fallback target of PREFER_ON_DEVICE and the engine of
  // ONLY_IN_CLOUD tasks. It must be named in `inCloudParams`: with a hybrid `mode` the
  // SDK ignores a top-level `model` and silently calls its own default instead
  // (hybridModelParams, engine.ts; SPEC §7).
  return getGenerativeModel(aiService, hybridModelParams(mode, cloudModelName));
}

let deviceBudgetedCalls = 0;

/**
 * How long a structuring call may take before the honest rule-based fallback
 * kicks in. Demo and emulator modes have no real cloud backend (there is no AI
 * Logic emulator), so with no on-device model they fail fast (12 s). When the
 * on-device model IS installed, the first inference of a browser session also
 * pays the model-load cost, so that one call gets a long budget and later calls
 * a normal one. Live mode with no device model: 45 s.
 */
export async function aiBudgetMs(): Promise<number> {
  if ((await deviceAvailability()) === "available") {
    return deviceBudgetedCalls++ === 0 ? 90_000 : 45_000;
  }
  const mode = (globalThis as { __ssRuntimeMode?: string }).__ssRuntimeMode;
  return mode === "demo" || mode === "emulator" ? 12_000 : 45_000;
}

/**
 * How long F2–F4 may take before the honest fallback kicks in: the budget F1 gets for
 * any call after its first. Until 2026-11-25 these three had none, so on a network that
 * hangs instead of failing they waited for the browser itself to give up — 84.5 s.
 */
export async function callBudgetMs(): Promise<number> {
  if ((await deviceAvailability()) === "available") return 45_000;
  const mode = (globalThis as { __ssRuntimeMode?: string }).__ssRuntimeMode;
  return mode === "demo" || mode === "emulator" ? 12_000 : 45_000;
}

/**
 * Warm up / download the on-device model. MUST be invoked from a user gesture
 * (Chrome's Prompt API user-activation requirement); the UI calls this inside
 * the first button click handler.
 */
export async function warmDeviceModel(): Promise<void> {
  const model = requireModel(InferenceMode.PREFER_ON_DEVICE);
  await model.initializeDeviceModel((p) => {
    emitEngine({ engine: "download", downloadProgress: p, label: `Downloading on-device model · ${Math.round(p * 100)}%`, short: `Downloading model · ${Math.round(p * 100)}%` });
  });
  // `initializeDeviceModel` only (down)loads the component; it does not bring
  // the weights into memory. Chrome evicts an unused model and the SDK keeps
  // exactly one session alive between calls, so one tiny local inference is
  // what actually preloads it. Done only when the model is already installed —
  // a download is never started from here without the user's click.
  const availability = await deviceAvailability();
  if (availability !== "available") {
    // "ready" is never our word — only Chrome's. initializeDeviceModel()
    // resolves without installing anything when the model cannot be used, and
    // this used to announce "On-device model ready" regardless (seen in the
    // engine log of a demo build with no model, 2026-11-24).
    const downloading = availability === "downloadable" || availability === "downloading";
    emitEngine({
      engine: "unavailable",
      label: downloading ? "On-device model still downloading" : "On-device model not available",
      short: downloading ? "On-device model downloading" : "On-device model unavailable",
    });
    return;
  }
  let preloaded = true;
  await model
    .generateContent({ contents: [{ role: "user", parts: [{ type: "text", text: "Reply with the single word: ready." }]}] })
    .catch((e: unknown) => {
      preloaded = false;
      console.warn("[ai] on-device preload inference failed:", e);
    });
  emitEngine(
    preloaded
      ? { engine: "pending", label: "On-device model ready" }
      : { engine: "pending", label: "On-device model available — the first request will load it", short: "On-device model loading" },
  );
}

/**
 * Report whether the browser exposes Chrome's Prompt API at all.
 * (Honest telemetry: this is why the engine badge might say "unavailable".)
 */
export function deviceApiAvailable(): boolean {
  return typeof self !== "undefined" && "LanguageModel" in self;
}

/** Chrome's own answer for the on-device model: "unavailable" | "downloadable" | "downloading" | "available" (null when the API is absent). */
export async function deviceAvailability(): Promise<string | null> {
  if (!deviceApiAvailable()) return null;
  try {
    const api = (self as unknown as { LanguageModel: { availability(): Promise<string> } }).LanguageModel;
    return await api.availability();
  } catch {
    return null;
  }
}

interface GenerateExtras {
  inferenceSource?: "on_device" | "in_cloud";
}

/**
 * One engine call: the reply and its badge — and nothing else. Emitting the engine
 * event is the caller's job, once per call, because only the caller knows whether the
 * reply is actually used (answerWithinBudget, structureNote).
 */
async function generate(
  mode: (typeof InferenceMode)[keyof typeof InferenceMode],
  prompt: string,
  options: { responseMimeType?: string; responseSchema?: object; temperature?: number } = {},
  requestedOnDevice = true,
): Promise<AiAnswer> {
  if (isSimulated()) return simulatedAnswer(prompt);
  const model = requireModel(mode);
  const request: GenerateContentRequest = {
    contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
  };
  if (options.responseMimeType || options.temperature !== undefined) {
    request.generationConfig = {
      ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
      ...(options.responseSchema ? { responseSchema: options.responseSchema as never } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    };
  }
  const result = await model.generateContent(request);
  const meta = (result.response as unknown as GenerateExtras);
  // The engine is read off the response, never inferred from the requested mode;
  // a response that does not say is badged "Engine unknown" (engine.ts).
  const badge = badgeFromSource(meta.inferenceSource, requestedOnDevice);
  return { text: result.response.text(), badge };
}

/** F1 — free-text field note → structured defect record (JSON). On-device first, under a
 *  budget (aiBudgetMs): a hung network falls through to the rules like a failed one, and a
 *  reply that comes too late is dropped (structureWithinBudget, engine.ts). */
export async function structureNote(note: string): Promise<{ record: DefectJson; answer: AiAnswer }> {
  const budgetMs = await aiBudgetMs();
  return structureWithinBudget(
    () =>
      generate(
        InferenceMode.PREFER_ON_DEVICE,
        `${STRUCTURE_PROMPT}\n\nEngineer's note:\n${note}`,
        { responseMimeType: "application/json", responseSchema: DEFECT_SCHEMA, temperature: 0.1 },
        true,
      ),
    note,
    budgetMs,
    (a) => emitEngine(a.badge, "F1 structure"),
    {
      onLate: () => console.warn("[ai] a structuring reply arrived after the budget was lost — dropped; the record is already rule-based"),
      // Honest degradation: no on-device model AND no cloud reachability
      // (e.g. offline demo without a Firebase project). Structure the note with
      // transparent rules — the badge says so; we never pretend AI ran.
      onFallback: (e) => console.warn("[ai] structuring failed, using rule-based fallback:", e),
    },
  );
}

/** F2 — on-site single-turn Q&A. On-device first. Under a budget (callBudgetMs): a hung
 *  network ends in "No engine answered in time", a failed one in "No engine reachable". */
export async function askFieldQuestion(question: string): Promise<AiAnswer> {
  const budgetMs = await callBudgetMs();
  return answerWithinBudget(
    () => generate(InferenceMode.PREFER_ON_DEVICE, `${QA_PROMPT}\n\nQuestion: ${question}`, { temperature: 0.3 }, true),
    budgetMs,
    (e) => {
      // Honest degradation: say what happened, never fake an answer.
      console.warn("[ai] field QA failed:", e);
      return fieldQaWithoutEngine(e);
    },
    (a) => emitEngine(a.badge, "F2 field QA"),
  );
}

/** F3 — report drafting. Cloud only by design (long aggregation, see SPEC §5). */
export async function draftReport(records: DefectJson[]): Promise<AiAnswer> {
  if (!navigator.onLine) {
    const badge: EngineBadgeInfo = { engine: "unavailable", label: "Report drafting needs a connection (cloud task)", short: "Report needs a connection" };
    emitEngine(badge, "F3 report");
    return { text: "", badge };
  }
  const recordsText = records
    .map((r, i) => `${i + 1}. [${r.severity}] ${r.defectType} — ${r.component} (${r.quantity})${r.notes ? `; ${r.notes}` : ""}`)
    .join("\n");
  const budgetMs = await callBudgetMs();
  try {
    return await answerWithinBudget(
      () => generate(InferenceMode.ONLY_IN_CLOUD, `${REPORT_PROMPT}\n\nRecords:\n${recordsText}`, { temperature: 0.4 }, false),
      budgetMs,
      reportWithoutEngine, // a timed-out call is answered with the badge alone; other failures go on
      (a) => emitEngine(a.badge, "F3 report"),
    );
  } catch (e) {
    console.warn("[ai] report drafting failed:", e);
    throw e; // the UI reports it ("Report drafting failed: …"), as before
  }
}

/** F4 — severity cross-check against a maintenance-standard reference card. On-device.
 *  Under a budget (callBudgetMs); whatever kept the engine from answering, the rule-based
 *  cross-check against the same card answers and says so. */
export async function crossCheckSeverity(record: DefectJson): Promise<AiAnswer> {
  const card = [
    "Reference (crack width, indicative): <0.15mm hairline; 0.15–0.5mm minor (monitor); >0.5mm or active/widening moderate–severe (specialist).",
    "Reference (spalling/exposed rebar): any exposed reinforcement → severe.",
    "Reference (seepage/efflorescence): isolated efflorescence minor; active seepage with deposits moderate; structural saturation severe.",
  ].join("\n");
  const q = `Given the record below and the reference card, answer in 3 sentences: does the recorded severity match the reference? If measurements are missing, say what to measure next.\n\nRecord: ${JSON.stringify(record)}\n\n${card}`;
  const budgetMs = await callBudgetMs();
  return answerWithinBudget(
    () => generate(InferenceMode.PREFER_ON_DEVICE, q, { temperature: 0.2 }, true),
    budgetMs,
    (e) => {
      console.warn("[ai] severity check failed:", e);
      return severityWithoutEngine(record, e);
    },
    (a) => emitEngine(a.badge, "F4 severity check"),
  );
}
