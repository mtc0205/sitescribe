/**
 * Hybrid inference layer — the heart of SiteScribe.
 *
 * Wraps Firebase AI Logic (`firebase/ai`) so every feature states its routing
 * intent once (see docs/SPEC.md §5) and the UI receives an honest engine badge
 * built from `GenerateContentResponse.inferenceSource`.
 */
import type { AiAnswer, EngineBadgeInfo } from "./types";
import { ruleBasedStructure, ruleBasedCrossCheck, repairJson, type DefectJson } from "./extract";

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

/** Callback subscribers for engine state shown in the status bar. */
type EngineListener = (badge: EngineBadgeInfo) => void;
const engineListeners = new Set<EngineListener>();
export function onEngineUpdate(fn: EngineListener): () => void {
  engineListeners.add(fn);
  return () => engineListeners.delete(fn);
}

/** Rolling log of engine events (SPEC §4: Settings → engine badge log). */
export interface EngineLogEntry {
  ts: string;
  feature: string;
  badge: EngineBadgeInfo;
}
const engineLog: EngineLogEntry[] = [];
export function getEngineLog(): readonly EngineLogEntry[] {
  return engineLog;
}
function emitEngine(badge: EngineBadgeInfo, feature = "system") {
  engineLog.unshift({ ts: new Date().toISOString(), feature, badge });
  if (engineLog.length > 50) engineLog.length = 50;
  engineListeners.forEach((fn) => fn(badge));
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
export function engineSimulation(): SimulationKind {
  return simulation;
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

function simulatedAnswer(feature: string, prompt: string): AiAnswer {
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
  emitEngine(badge, feature);
  return { text, badge };
}

let aiService: AI | null = null;
let cloudModelName = "gemini-3.8-flash";

/**
 * Bind the AI service to an initialized Firebase app.
 * Called once from firebase.ts after initializeApp().
 */
export function initAI(ai: AI, remoteCloudModel?: string): void {
  aiService = ai;
  if (remoteCloudModel) cloudModelName = remoteCloudModel;
}

function requireModel(mode: (typeof InferenceMode)[keyof typeof InferenceMode]): GenerativeModel {
  if (!aiService) throw new Error("AI service not initialized (no Firebase config)");
  // Cloud model rides along as the fallback target for PREFER_ON_DEVICE.
  return getGenerativeModel(aiService, {
    model: cloudModelName,
    mode,
  });
}

function badgeFor(engine: "on_device" | "in_cloud", fellBack: boolean): EngineBadgeInfo {
  return engine === "on_device"
    ? { engine, fellBack, label: "On-device · Gemini Nano" }
    : { engine, fellBack, label: "Cloud · Gemini" };
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
 * Warm up / download the on-device model. MUST be invoked from a user gesture
 * (Chrome's Prompt API user-activation requirement); the UI calls this inside
 * the first button click handler.
 */
export async function warmDeviceModel(): Promise<void> {
  const model = requireModel(InferenceMode.PREFER_ON_DEVICE);
  await model.initializeDeviceModel((p) => {
    emitEngine({ engine: "download", downloadProgress: p, label: `Downloading on-device model · ${Math.round(p * 100)}%` });
  });
  // `initializeDeviceModel` only (down)loads the component; it does not bring
  // the weights into memory. Chrome evicts an unused model and the SDK keeps
  // exactly one session alive between calls, so one tiny local inference is
  // what actually preloads it. Done only when the model is already installed —
  // a download is never started from here without the user's click.
  if ((await deviceAvailability()) === "available") {
    await model
      .generateContent({ contents: [{ role: "user", parts: [{ type: "text", text: "Reply with the single word: ready." }] }] })
      .catch((e: unknown) => console.warn("[ai] on-device preload inference failed:", e));
  }
  emitEngine({ engine: "pending", label: "On-device model ready" });
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

/** Core call: single-turn generation in a given mode, returning text + badge. */
async function ask(
  mode: (typeof InferenceMode)[keyof typeof InferenceMode],
  prompt: string,
  options: { responseMimeType?: string; responseSchema?: object; temperature?: number } = {},
  requestedOnDevice = true,
  feature = "ai",
): Promise<AiAnswer> {
  if (isSimulated()) return simulatedAnswer(feature, prompt);
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
  const source = meta.inferenceSource;
  const badge: EngineBadgeInfo = source
    ? badgeFor(source, requestedOnDevice && source === "in_cloud")
    : { engine: "pending", label: "Engine unknown" };
  emitEngine(badge, feature);
  return { text: result.response.text(), badge };
}

/** F1 — free-text field note → structured defect record (JSON). On-device first. */
export async function structureNote(note: string): Promise<{ record: DefectJson; answer: AiAnswer }> {
  try {
    // Race the AI call against a timeout so an unreachable cloud doesn't hang
    // the capture flow in the field (worst case: fall through to rules).
    // Demo mode (placeholder config) has no real cloud: fail fast to rules.
    const budgetMs = await aiBudgetMs();
    const answer = await Promise.race([
      ask(
        InferenceMode.PREFER_ON_DEVICE,
        `${STRUCTURE_PROMPT}\n\nEngineer's note:\n${note}`,
        { responseMimeType: "application/json", responseSchema: DEFECT_SCHEMA, temperature: 0.1 },
        true,
        "F1 structure",
      ),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`AI call timed out (${Math.round(budgetMs / 1000)}s)`)), budgetMs)),
    ]);
    let parsed: DefectJson;
    try {
      parsed = repairJson(answer.text);
      if (!parsed || typeof parsed !== "object" || typeof parsed.component !== "string") throw new Error("unexpected JSON shape");
    } catch {
      // The engine answered, but not with usable JSON (the on-device path has
      // no schema enforcement). Keep the loop alive with the transparent
      // rule-based record and say so inside the record itself.
      const fallback = ruleBasedStructure(note);
      parsed = { ...fallback, notes: `${fallback.notes} [engine reply was not valid JSON — fields structured by rules]`.trim() };
    }
    return { record: parsed, answer };
  } catch (e) {
    // Honest degradation: no on-device model AND no cloud reachability
    // (e.g. offline demo without a Firebase project). Structure the note with
    // transparent rules — the badge says so; we never pretend AI ran.
    console.warn("[ai] structuring failed, using rule-based fallback:", e);
    const badge: EngineBadgeInfo = { engine: "unavailable", label: "Rule-based (no AI engine available)" };
    emitEngine(badge, "F1 structure");
    return { record: ruleBasedStructure(note), answer: { text: "", badge } };
  }
}

;

/** F2 — on-site single-turn Q&A. On-device first. */
export async function askFieldQuestion(question: string): Promise<AiAnswer> {
  try {
    return await ask(InferenceMode.PREFER_ON_DEVICE, `${QA_PROMPT}\n\nQuestion: ${question}`, { temperature: 0.3 }, true, "F2 field QA");
  } catch (e) {
    // Honest degradation: offline with no device model → say so, never fake.
    console.warn("[ai] field QA failed:", e);
    const badge: EngineBadgeInfo = { engine: "unavailable", label: "No engine reachable (offline, no device model)" };
    emitEngine(badge, "F2 field QA");
    return {
      text: "Field Q&A needs either the on-device model or a connection — none was reachable. Defect capture still works: notes are structured by transparent rules and will sync later.",
      badge,
    };
  }
}

/** F3 — report drafting. Cloud only by design (long aggregation, see SPEC §5). */
export async function draftReport(records: DefectJson[]): Promise<AiAnswer> {
  if (!navigator.onLine) {
    const badge: EngineBadgeInfo = { engine: "unavailable", label: "Report drafting needs a connection (cloud task)" };
    emitEngine(badge, "F3 report");
    return { text: "", badge };
  }
  const recordsText = records
    .map((r, i) => `${i + 1}. [${r.severity}] ${r.defectType} — ${r.component} (${r.quantity})${r.notes ? `; ${r.notes}` : ""}`)
    .join("\n");
  return ask(InferenceMode.ONLY_IN_CLOUD, `${REPORT_PROMPT}\n\nRecords:\n${recordsText}`, { temperature: 0.4 }, false, "F3 report");
}

/** F4 — severity cross-check against a maintenance-standard reference card. On-device. */
export async function crossCheckSeverity(record: DefectJson): Promise<AiAnswer> {
  const card = [
    "Reference (crack width, indicative): <0.15mm hairline; 0.15–0.5mm minor (monitor); >0.5mm or active/widening moderate–severe (specialist).",
    "Reference (spalling/exposed rebar): any exposed reinforcement → severe.",
    "Reference (seepage/efflorescence): isolated efflorescence minor; active seepage with deposits moderate; structural saturation severe.",
  ].join("\n");
  const q = `Given the record below and the reference card, answer in 3 sentences: does the recorded severity match the reference? If measurements are missing, say what to measure next.\n\nRecord: ${JSON.stringify(record)}\n\n${card}`;
  try {
    return await ask(InferenceMode.PREFER_ON_DEVICE, q, { temperature: 0.2 }, true, "F4 severity check");
  } catch (e) {
    console.warn("[ai] severity check failed:", e);
    const badge: EngineBadgeInfo = { engine: "unavailable", label: "Rule-based (no AI engine available)" };
    emitEngine(badge, "F4 severity check");
    return { text: ruleBasedCrossCheck(record), badge };
  }
}
