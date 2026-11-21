/**
 * Pure sync-domain logic: pending queue transitions + conflict merge.
 *
 * Extracted from store.ts so the offline→sync core (the contest-critical
 * loop) is unit-testable without a browser. store.ts keeps the persistence
 * side (localStorage / Firestore) and calls into these.
 */
import type { DefectRecord } from "./types";

/** Flip all pending records of a project to synced; return how many. */
export function flushPending(records: DefectRecord[], projectId: string): { flipped: DefectRecord[]; count: number } {
  let count = 0;
  const flipped = records.map((r) => {
    if (r.projectId === projectId && r.syncState === "pending") {
      count++;
      return { ...r, syncState: "synced" as const };
    }
    return r;
  });
  return { flipped, count };
}

export function countPending(records: DefectRecord[], projectId: string): number {
  return records.filter((r) => r.projectId === projectId && r.syncState === "pending").length;
}

/**
 * Conflict merge for the moment a locally-edited record meets its cloud copy.
 * Strategy: last-write-wins on `updatedAt` (fallback `createdAt`) for scalar
 * fields, plus a defensive union for free-text notes so nothing typed in the
 * field is silently dropped.
 */
export function mergeRecord(local: DefectRecord, remote: DefectRecord): DefectRecord {
  const lt = Date.parse(local.updatedAt ?? local.createdAt);
  const rt = Date.parse(remote.updatedAt ?? remote.createdAt);
  const newer = rt > lt ? remote : local;
  const older = newer === local ? remote : local;
  const notes = unionNotes(local.notes, remote.notes);
  return {
    ...newer,
    // Measurements are only ever captured once in the field; if the losing
    // copy somehow carries a quantity the winner lacks, keep it.
    quantity: newer.quantity && newer.quantity !== "(unspecified)" ? newer.quantity : older.quantity,
    notes,
    // Once either side is synced, the merged record is synced.
    syncState: local.syncState === "synced" && remote.syncState === "synced" ? "synced" : newer.syncState,
  };
}

/** Join two note strings, dropping the shorter one if it is a prefix. */
function unionNotes(a: string, b: string): string {
  const x = (a ?? "").trim();
  const y = (b ?? "").trim();
  if (!x) return y;
  if (!y) return x;
  if (x === y) return x;
  if (x.startsWith(y) || y.startsWith(x)) return x.length >= y.length ? x : y;
  return `${x} | ${y}`;
}
