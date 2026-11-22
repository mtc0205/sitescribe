/**
 * Unit tests for scripts/lib/bootstrap-env.mjs (pure helpers only —
 * nothing here touches the network or the user's Firebase account).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSdkConfigOutput, buildEnvFile, parseEnvFile, parseAppIdFromCreate } from "../scripts/lib/bootstrap-env.mjs";

test("parseSdkConfigOutput handles the var firebaseConfig format", () => {
  const out = `=== Web app SDK configuration ===\nvar firebaseConfig = {"apiKey":"AIz-abc","authDomain":"p.firebaseapp.com","projectId":"p","appId":"1:2:web:xyz"};`;
  const cfg = parseSdkConfigOutput(out);
  assert.equal(cfg.projectId, "p");
  assert.equal(cfg.appId, "1:2:web:xyz");
});

test("parseSdkConfigOutput handles bare JSON and rejects junk", () => {
  assert.equal(parseSdkConfigOutput('{"apiKey":"k"}').apiKey, "k");
  assert.equal(parseSdkConfigOutput("no braces here"), null);
  assert.equal(parseSdkConfigOutput('{"unbalanced": '), null);
});

test("parseSdkConfigOutput ignores braces inside strings", () => {
  const cfg = parseSdkConfigOutput('{"apiKey":"a{b}c","projectId":"p"}');
  assert.equal(cfg.apiKey, "a{b}c");
});

test("buildEnvFile writes one-line config and preserves App Check keys", () => {
  const existing = [
    "# old comment",
    "VITE_FIREBASE_CONFIG={\"apiKey\":\"old\"}",
    "VITE_RECAPTCHA_SITE_KEY=6LeAAA",
    "VITE_APPCHECK_DEBUG_TOKEN=",
    "VITE_USE_EMULATOR=0",
  ].join("\n");
  const env = buildEnvFile({ apiKey: "AIz-new", projectId: "sitescribe-x" }, existing);
  const parsed = parseEnvFile(env);
  assert.equal(parsed.VITE_FIREBASE_CONFIG, '{"apiKey":"AIz-new","projectId":"sitescribe-x"}');
  assert.ok(!env.split("\n").some((l) => l.startsWith("VITE_FIREBASE_CONFIG") && l.includes("old")));
  assert.equal(parsed.VITE_RECAPTCHA_SITE_KEY, "6LeAAA");
  assert.equal(parsed.VITE_APPCHECK_DEBUG_TOKEN, "");
  assert.equal(parsed.VITE_USE_EMULATOR, "0");
});

test("buildEnvFile defaults missing keys and keeps emulator flag", () => {
  const env = buildEnvFile({ apiKey: "k", projectId: "p" }, "VITE_USE_EMULATOR=1");
  const parsed = parseEnvFile(env);
  assert.equal(parsed.VITE_USE_EMULATOR, "1");
  assert.equal(parsed.VITE_RECAPTCHA_SITE_KEY, "");
});

test("buildEnvFile rejects incomplete config", () => {
  assert.throws(() => buildEnvFile({ apiKey: "k" }, ""));
  assert.throws(() => buildEnvFile(null, ""));
});

test("parseAppIdFromCreate finds the web app id", () => {
  assert.equal(parseAppIdFromCreate("Created Web app nickname 'SiteScribe' (1:91291531521:web:ab3f9c2d11)"), "1:91291531521:web:ab3f9c2d11");
  assert.equal(parseAppIdFromCreate("no id"), null);
});
