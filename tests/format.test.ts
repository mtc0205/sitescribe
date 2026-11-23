import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRecordTime, formatLogTime, localDateTime, zoneLabelNow } from "../src/format.ts";

// 2026-11-23T20:34:11Z — the instant behind the "20:34" UTC timestamps seen in the old record cards.
const ISO = "2026-11-23T20:34:11.000Z";

test("formatRecordTime: Asia/Shanghai shows local time with an explicit zone", () => {
  assert.equal(formatRecordTime(ISO, "Asia/Shanghai"), "Nov 24, 04:34 (UTC+8)");
  assert.equal(localDateTime(ISO, "Asia/Shanghai").dateNum, "2026-11-24"); // local date, not the UTC slice
});

test("formatRecordTime: negative and half-hour zones", () => {
  assert.equal(formatRecordTime(ISO, "America/New_York"), "Nov 23, 15:34 (UTC-5)"); // EST in November
  assert.equal(formatRecordTime(ISO, "Asia/Kolkata"), "Nov 24, 02:04 (UTC+5:30)");
  assert.equal(formatRecordTime(ISO, "Pacific/Auckland"), "Nov 24, 09:34 (UTC+13)"); // NZDT
  assert.equal(formatRecordTime(ISO, "UTC"), "Nov 23, 20:34 (UTC+0)");
});

test("formatRecordTime: follows daylight saving of the zone", () => {
  assert.equal(formatRecordTime("2026-07-01T12:00:00.000Z", "America/New_York"), "Jul 1, 08:00 (UTC-4)");
  assert.equal(formatRecordTime("2026-01-01T12:00:00.000Z", "America/New_York"), "Jan 1, 07:00 (UTC-5)");
});

test("localDateTime without a zone uses this device's zone and says so", () => {
  const t = localDateTime(ISO);
  const offset = -new Date(ISO).getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const expected = `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? ":" + String(abs % 60).padStart(2, "0") : ""}`;
  assert.equal(t.zone, expected);
  assert.match(formatRecordTime(ISO), /\([Uu][Tt][Cc][+-]\d/); // never a naked time without a zone
  assert.equal(zoneLabelNow(), expected);
});

test("formatRecordTime: midnight is 00:xx, never 24:xx", () => {
  const out = formatRecordTime("2026-11-23T16:00:00.000Z", "Asia/Shanghai"); // exactly midnight local
  assert.equal(out, "Nov 24, 00:00 (UTC+8)");
});

test("formatLogTime keeps seconds", () => {
  assert.equal(formatLogTime(ISO, "Asia/Shanghai"), "04:34:11");
});

test("invalid input degrades to a dash, never throws", () => {
  assert.equal(formatRecordTime("not a date"), "—");
  assert.equal(formatRecordTime(""), "—");
  assert.equal(localDateTime("garbage").zone, "");
});
