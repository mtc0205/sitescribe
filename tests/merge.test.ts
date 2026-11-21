import { test } from "node:test";
import assert from "node:assert/strict";
import { flushPending, countPending, mergeRecord } from "../src/merge.ts";
import type { DefectRecord } from "../src/types.ts";

function rec(partial: Partial<DefectRecord> & { id: string }): DefectRecord {
  return {
    projectId: "p1",
    createdAt: "2026-11-22T02:00:00.000Z",
    rawNote: "note",
    component: "girder G2",
    defectType: "crack",
    quantity: "2 mm",
    severity: "moderate",
    notes: "field note",
    extractedBy: "on_device",
    syncState: "synced",
    ...partial,
  };
}

test("flushPending flips only the target project's pending records", () => {
  const records = [
    rec({ id: "a", syncState: "pending" }),
    rec({ id: "b", syncState: "pending", projectId: "other" }),
    rec({ id: "c", syncState: "synced" }),
    rec({ id: "d", syncState: "pending" }),
  ];
  const { flipped, count } = flushPending(records, "p1");
  assert.equal(count, 2);
  assert.equal(flipped.find((r) => r.id === "a")?.syncState, "synced");
  assert.equal(flipped.find((r) => r.id === "b")?.syncState, "pending"); // other project untouched
  assert.equal(flipped.find((r) => r.id === "c")?.syncState, "synced");
  assert.equal(countPending(flipped, "p1"), 0);
  assert.equal(countPending(flipped, "other"), 1);
});

test("mergeRecord: newer write wins scalars, notes are unioned", () => {
  const local = rec({ id: "x", notes: "re-measured at 09:00", updatedAt: "2026-11-22T09:00:00.000Z", syncState: "pending" });
  const remote = rec({ id: "x", notes: "first capture", updatedAt: "2026-11-22T08:00:00.000Z", syncState: "synced", severity: "minor" });
  const merged = mergeRecord(local, remote);
  assert.equal(merged.updatedAt, "2026-11-22T09:00:00.000Z"); // local newer → local wins
  assert.equal(merged.severity, "moderate"); // scalar from winner
  assert.ok(merged.notes.includes("re-measured at 09:00"));
  assert.ok(merged.notes.includes("first capture"));
});

test("mergeRecord: identical notes are not duplicated", () => {
  const local = rec({ id: "x", notes: "same note" });
  const remote = rec({ id: "x", notes: "same note" });
  assert.equal(mergeRecord(local, remote).notes, "same note");
});

test("mergeRecord: winner missing quantity keeps the loser's", () => {
  const local = rec({ id: "x", quantity: "(unspecified)", updatedAt: "2026-11-22T10:00:00.000Z" });
  const remote = rec({ id: "x", quantity: "3 mm" });
  const merged = mergeRecord(local, remote);
  assert.equal(merged.quantity, "3 mm");
});
