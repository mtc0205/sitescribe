import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetExceeded, withinBudget, answerWithinBudget, structureWithinBudget, fieldQaWithoutEngine, reportWithoutEngine, severityWithoutEngine } from "../src/engine.ts";
import { ruleBasedStructure } from "../src/extract.ts";
import type { AiAnswer, EngineBadgeInfo } from "../src/types.ts";

/** A call whose reply the test controls: neither resolves nor rejects until told to. */
function heldCall<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REPLY: AiAnswer = { text: "fine", badge: { engine: "on_device", label: "On-device · Gemini Nano" } };
const FALLBACK: AiAnswer = { text: "rules", badge: { engine: "unavailable", label: "Rule-based fallback" } };

// ---- the budget itself ----

test("BudgetExceeded carries the budget it ran out of", () => {
  const e = new BudgetExceeded(12_000);
  assert.ok(e instanceof Error);
  assert.equal(e.seconds, 12);
  assert.equal(e.message, "AI call timed out (12s)");
});

test("withinBudget: a reply in time is returned unchanged, nothing is reported late", async () => {
  const call = heldCall<string>();
  const late: unknown[] = [];
  const out = withinBudget(call.promise, 1_000, (l) => late.push(l));
  call.resolve("in time");
  assert.equal(await out, "in time");
  await sleep(20);
  assert.deepEqual(late, []);
});

test("withinBudget: a failure in time is passed on as it is", async () => {
  const call = heldCall<string>();
  const out = withinBudget(call.promise, 1_000);
  call.reject(new Error("network down"));
  await assert.rejects(out, /network down/);
});

test("withinBudget: a call that never answers is given up after the budget, not after 84 seconds", async () => {
  const call = heldCall<string>();
  const t0 = Date.now();
  await assert.rejects(withinBudget(call.promise, 40), (e) => e instanceof BudgetExceeded && e.seconds === 0);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 35, `the budget is waited for: ${elapsed} ms`);
  assert.ok(elapsed < 1_000, `and not a minute longer: ${elapsed} ms`);
});

test("withinBudget: a reply that arrives after the budget is dropped — reported late, seen by nobody else", async () => {
  const call = heldCall<string>();
  const late: unknown[] = [];
  // What a caller does when the budget is lost: it settles on the fallback, for good.
  let settled = "pending";
  const out = withinBudget(call.promise, 20, (l) => late.push(l)).catch((e: unknown) => {
    settled = `fallback (${e instanceof BudgetExceeded ? "budget" : "other"})`;
  });
  await out;
  assert.equal(settled, "fallback (budget)");
  call.resolve("too late"); // the hung network finally answers
  await sleep(10);
  assert.deepEqual(late, [{ reply: "too late" }]); // told once, and only here
  assert.equal(settled, "fallback (budget)"); // what the caller settled on is untouched
});

test("withinBudget: a failure that arrives after the budget is reported late as well", async () => {
  const call = heldCall<string>();
  const late: unknown[] = [];
  await assert.rejects(withinBudget(call.promise, 20, (l) => late.push(l)));
  call.reject(new Error("timed out in the browser, 84 s later"));
  await sleep(10);
  assert.equal(late.length, 1);
  assert.match(String((late[0] as { error?: unknown }).error), /84 s later/);
});

// ---- one engine event, for the answer the user gets ----

test("answerWithinBudget: a reply in time is emitted once and returned", async () => {
  const call = heldCall<AiAnswer>();
  const emitted: AiAnswer[] = [];
  const out = answerWithinBudget(() => call.promise, 1_000, () => FALLBACK, (a) => emitted.push(a));
  call.resolve(REPLY);
  assert.equal(await out, REPLY);
  assert.deepEqual(emitted, [REPLY]);
});

test("answerWithinBudget: a hung call gives the fallback, emitted once — and the late reply changes nothing", async () => {
  const call = heldCall<AiAnswer>();
  const emitted: AiAnswer[] = [];
  const late: unknown[] = [];
  const out = answerWithinBudget(() => call.promise, 20, () => FALLBACK, (a) => emitted.push(a), (l) => late.push(l));
  assert.equal(await out, FALLBACK);
  assert.deepEqual(emitted, [FALLBACK]);
  call.resolve(REPLY); // late: must not be emitted, must not replace the fallback
  await sleep(10);
  assert.deepEqual(emitted, [FALLBACK]);
  assert.deepEqual(late, [{ reply: REPLY }]);
});

test("answerWithinBudget: a failure in time gives the fallback made from that failure", async () => {
  const call = heldCall<AiAnswer>();
  const emitted: AiAnswer[] = [];
  const reasons: unknown[] = [];
  const out = answerWithinBudget(() => call.promise, 1_000, (e) => (reasons.push(e), FALLBACK), (a) => emitted.push(a));
  call.reject(new Error("offline"));
  assert.equal(await out, FALLBACK);
  assert.match(String(reasons[0]), /offline/);
  assert.deepEqual(emitted, [FALLBACK]);
});

test("answerWithinBudget: a withoutEngine that throws passes the failure on, and nothing is emitted", async () => {
  const call = heldCall<AiAnswer>();
  const emitted: AiAnswer[] = [];
  const out = answerWithinBudget(() => call.promise, 1_000, (e) => { throw e; }, (a) => emitted.push(a));
  call.reject(new Error("bad request"));
  await assert.rejects(out, /bad request/);
  assert.deepEqual(emitted, []);
});

// ---- the honest fallback states ----

const label = (a: AiAnswer) => (a.badge as EngineBadgeInfo).label;

test("F2: a hung connection says so — it is not passed off as an offline device", () => {
  const timedOut = fieldQaWithoutEngine(new BudgetExceeded(12_000));
  assert.equal(label(timedOut), "No engine answered in time");
  assert.match(timedOut.text, /^No engine answered within 12 seconds/);
  assert.match(timedOut.text, /Defect capture still works/);
  const failed = fieldQaWithoutEngine(new Error("Failed to fetch"));
  assert.equal(label(failed), "No engine reachable (offline, no device model)");
});

test("F3: a timed-out report is said so with the badge alone; other failures are passed on", () => {
  const timedOut = reportWithoutEngine(new BudgetExceeded(45_000));
  assert.equal(timedOut.text, "");
  assert.equal(label(timedOut), "Report drafting timed out — the cloud engine did not answer in time");
  assert.throws(() => reportWithoutEngine(new Error("400")), /400/);
});

test("F4: without an engine the rule-based cross-check answers, and says it is rule-based", () => {
  const a = severityWithoutEngine({ component: "x", defectType: "crack", quantity: "2 mm", severity: "moderate", notes: "" }, new BudgetExceeded(12_000));
  assert.equal(label(a), "Rule-based fallback (no AI engine reachable)");
  assert.match(a.text, /specialist/);
  assert.match(a.text, /Rule-based check/);
});

// ---- F1: a reply that arrives after the budget must touch neither chip nor record ----

const NOTE = "Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long.";
const MODEL_JSON = JSON.stringify({ component: "web of girder G2", defectType: "longitudinal crack", quantity: "~2mm wide, ~3m long", severity: "moderate", notes: "seepage nearby" });
const MODEL_REPLY: AiAnswer = { text: MODEL_JSON, badge: { engine: "on_device", fellBack: false, label: "On-device · Gemini Nano" } };
const FALLBACK_LABEL = "Rule-based fallback (no AI engine reachable)";
const labels = (emitted: AiAnswer[]) => emitted.map((a) => (a.badge as EngineBadgeInfo).label);

test("F1: a usable reply in time is the record, with the model's badge, emitted once", async () => {
  const emitted: AiAnswer[] = [];
  const out = await structureWithinBudget(async () => MODEL_REPLY, NOTE, 1_000, (a) => emitted.push(a));
  assert.deepEqual(out.record, JSON.parse(MODEL_JSON));
  assert.equal(out.answer, MODEL_REPLY);
  assert.deepEqual(emitted, [MODEL_REPLY]);
});

test("F1: an unusable reply gives a rule-based record and ONE event — the rule-based badge, not the model's", async () => {
  const emitted: AiAnswer[] = [];
  const out = await structureWithinBudget(async () => ({ ...MODEL_REPLY, text: "I cannot help with that." }), NOTE, 1_000, (a) => emitted.push(a));
  assert.equal(out.record.component, ruleBasedStructure(NOTE).component); // "girder G2", not the model's wording
  assert.equal(out.answer.badge.label, "Rule-based (Gemini Nano replied, but not with usable JSON)");
  assert.deepEqual(labels(emitted), ["Rule-based (Gemini Nano replied, but not with usable JSON)"]);
});

test("F1: a hung call gives the rule-based record — and the reply that arrives late changes nothing", async () => {
  const call = heldCall<AiAnswer>();
  const emitted: AiAnswer[] = [];
  const late: unknown[] = [];
  const out = await structureWithinBudget(() => call.promise, NOTE, 20, (a) => emitted.push(a), { onLate: (l) => late.push(l) });
  // after the budget: rule-based record, one fallback event
  assert.equal(out.record.component, "girder G2");
  assert.equal(out.answer.badge.label, FALLBACK_LABEL);
  assert.deepEqual(labels(emitted), [FALLBACK_LABEL]);
  call.resolve(MODEL_REPLY); // the hung network answers after all
  await sleep(10);
  assert.deepEqual(labels(emitted), [FALLBACK_LABEL]); // nothing emitted for it: no chip, no log row
  assert.equal(out.record.component, "girder G2"); // the record is not rewritten with the model's fields
  assert.equal(out.answer.badge.label, FALLBACK_LABEL);
  assert.deepEqual(late, [{ reply: MODEL_REPLY }]);
});

test("F1: a failure in time gives the rule-based record, emitted once, and is reported", async () => {
  const emitted: AiAnswer[] = [];
  const reasons: unknown[] = [];
  const out = await structureWithinBudget(async () => { throw new Error("Failed to fetch"); }, NOTE, 1_000, (a) => emitted.push(a), { onFallback: (e) => reasons.push(e) });
  assert.equal(out.record.defectType, ruleBasedStructure(NOTE).defectType);
  assert.deepEqual(labels(emitted), [FALLBACK_LABEL]);
  assert.match(String(reasons[0]), /Failed to fetch/);
});
