/**
 * Shared domain types for SiteScribe.
 */

/** Which engine served a given AI response. Mirrors the SDK's InferenceSource. */
export type EngineKind = "on_device" | "in_cloud";

/** What the UI badge should display for one AI interaction. */
export interface EngineBadgeInfo {
  engine: EngineKind | "pending" | "download" | "unavailable";
  /** True when on-device was requested but the SDK fell back to cloud. */
  fellBack?: boolean;
  /** Model download progress 0..1 when engine === "download". */
  downloadProgress?: number;
  /** The SDK delivered a reply without `inferenceSource`. "pending" then means "not told", not "waiting" (SPEC §6.1). */
  engineUnknown?: boolean;
  /** Full label — always what the answer itself shows. */
  label: string;
  /** Compact wording for the status bar (same facts, fewer words). Falls back to `label`. */
  short?: string;
}

/** A structured defect record extracted from free-text field notes. */
export interface DefectRecord {
  id: string;
  projectId: string;
  /** ISO timestamp captured in the field. */
  createdAt: string;
  /** ISO timestamp of the last local edit, if any (conflict-merge input). */
  updatedAt?: string;
  /** The raw engineer note the record was extracted from. */
  rawNote: string;
  component: string;
  defectType: string;
  quantity: string;
  severity: "unknown" | "minor" | "moderate" | "severe";
  notes: string;
  /** Which engine produced the fields: a model, `"rule_based"` (no model reply, or an
   *  unusable one — see src/engine.ts), or `"unknown"` (the model produced them but the
   *  SDK did not say which engine). */
  extractedBy: EngineKind | "rule_based" | "unknown";
  /** Set on a record made under the demo's cloud-state simulation (SPEC §6.5): the engine
   *  named in `extractedBy` never ran, so the record keeps its "(simulated)" label. */
  simulated?: boolean;
  /** Pending cloud sync when captured offline (demo/local mode always true until "synced"). */
  syncState: "pending" | "synced";
}

export interface Project {
  id: string;
  name: string;
  structureType: "bridge" | "tunnel" | "hydraulic" | "other";
  createdAt: string;
}

export interface AiAnswer {
  text: string;
  badge: EngineBadgeInfo;
}
