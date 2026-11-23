/**
 * Unit tests for scripts/lib/base-url.mjs (pure resolution + probe verdicts).
 * Run by `npm test` via node --test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBaseUrl, probeBaseUrl } from "../scripts/lib/base-url.mjs";

const NO_ENV = {};

test("resolveBaseUrl defaults to 127.0.0.1:5173 (the `npm run dev` port)", () => {
  assert.equal(resolveBaseUrl([], NO_ENV), "http://127.0.0.1:5173");
});

test("resolveBaseUrl honours --port and strips nothing else", () => {
  assert.equal(resolveBaseUrl(["--port", "5187"], NO_ENV), "http://127.0.0.1:5187");
});

test("resolveBaseUrl honours --url and drops trailing slashes", () => {
  assert.equal(resolveBaseUrl(["--url", "https://sitescribe-demo.web.app///"], NO_ENV), "https://sitescribe-demo.web.app");
});

test("resolveBaseUrl precedence: --url > --port > env > default", () => {
  assert.equal(resolveBaseUrl(["--url", "http://a.test", "--port", "9"], { SS_PORT: "8", SS_BASE_URL: "http://env.test" }), "http://a.test");
  assert.equal(resolveBaseUrl(["--port", "9"], { SS_PORT: "8", SS_BASE_URL: "http://env.test" }), "http://127.0.0.1:9");
  assert.equal(resolveBaseUrl([], { SS_BASE_URL: "http://env.test/" }), "http://env.test");
  assert.equal(resolveBaseUrl([], { SS_PORT: "8" }), "http://127.0.0.1:8");
});

test("resolveBaseUrl ignores a --port/--url flag without a value", () => {
  assert.equal(resolveBaseUrl(["--port"], NO_ENV), "http://127.0.0.1:5173");
  assert.equal(resolveBaseUrl(["--port", "--headed"], NO_ENV), "http://127.0.0.1:5173");
});

test("probeBaseUrl rejects a server that is not SiteScribe (title mismatch)", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<!doctype html><html><title>TriToMorrow</title></html>", { status: 200 });
  try {
    const r = await probeBaseUrl("http://127.0.0.1:5173");
    assert.equal(r.ok, false);
    assert.equal(r.title, "TriToMorrow");
    assert.match(r.reason, /NOT SiteScribe/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("probeBaseUrl accepts the SiteScribe shell", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<title>SiteScribe — Offline-first AI inspection companion</title>", { status: 200 });
  try {
    const r = await probeBaseUrl("http://127.0.0.1:5187");
    assert.equal(r.ok, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("probeBaseUrl reports an unreachable server without throwing", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const e = new Error("connect ECONNREFUSED");
    e.cause = { code: "ECONNREFUSED" };
    throw e;
  };
  try {
    const r = await probeBaseUrl("http://127.0.0.1:5999");
    assert.equal(r.ok, false);
    assert.match(r.reason, /nothing answered/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
