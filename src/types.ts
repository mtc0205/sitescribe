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
  /** Which engine produced the extraction. */
  extractedBy: EngineKind | "rule_based";
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
