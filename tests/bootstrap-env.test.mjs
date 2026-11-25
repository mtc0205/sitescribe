/**
 * Unit tests for scripts/lib/bootstrap-env.mjs (pure helpers only —
 * nothing here touches the network or the user's Firebase account).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSdkConfigOutput, buildEnvFile, parseEnvFile, parseAppIdFromCreate, deployTargets, settleAuthProbe } from "../scripts/lib/bootstrap-env.mjs";

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
    "VITE_RECAPTCHA_PROVIDER=enterprise",
    "VITE_APPCHECK_DEBUG_TOKEN=",
    "VITE_USE_EMULATOR=0",
  ].join("\n");
  const env = buildEnvFile({ apiKey: "AIz-new", projectId: "sitescribe-x" }, existing);
  const parsed = parseEnvFile(env);
  assert.equal(parsed.VITE_FIREBASE_CONFIG, '{"apiKey":"AIz-new","projectId":"sitescribe-x"}');
  assert.ok(!env.split("\n").some((l) => l.startsWith("VITE_FIREBASE_CONFIG") && l.includes("old")));
  assert.equal(parsed.VITE_RECAPTCHA_SITE_KEY, "6LeAAA");
  assert.equal(parsed.VITE_RECAPTCHA_PROVIDER, "enterprise");
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

// ---- what a deploy carries ----

const FOUR = ["hosting", "firestore:rules", "firestore:indexes", "remote-config"];

test("deployTargets: the four targets of every deploy, and auth only when firebase.json declares providers", () => {
  assert.deepEqual(deployTargets({}), FOUR);
  assert.deepEqual(deployTargets({ auth: {} }), FOUR); // an auth block without providers declares nothing
  assert.deepEqual(deployTargets({ auth: { providers: {} } }), FOUR);
  assert.deepEqual(deployTargets({ auth: { providers: { anonymous: true } } }), [...FOUR, "auth"]);
  assert.deepEqual(deployTargets(null), FOUR);
});

// ---- the anonymous-sign-in check: one more try when the first answer told neither way ----

test("settleAuthProbe: a settled answer is final — enabled, or a 'not enabled' code; nothing is waited for", async () => {
  const answers = [
    { enabled: true, code: null, detail: "signed up uid=x" },
    { enabled: false, code: "CONFIGURATION_NOT_FOUND", detail: "HTTP 400 CONFIGURATION_NOT_FOUND" },
  ];
  for (const answer of answers) {
    let asks = 0;
    const out = await settleAuthProbe(
      async () => {
        asks++;
        return answer;
      },
      { sleep: async () => { throw new Error("must not wait for a settled answer"); } },
    );
    assert.equal(out, answer);
    assert.equal(asks, 1);
  }
});

test("settleAuthProbe: an answer that tells neither is asked for once more, after the delay", async () => {
  const waits = [];
  const answers = [
    { enabled: null, code: null, detail: "TimeoutError" }, // what the bootstrap printed once on 2026-11-26
    { enabled: true, code: null, detail: "signed up uid=x" },
  ];
  const out = await settleAuthProbe(async () => answers.shift(), { sleep: async (ms) => waits.push(ms), delayMs: 1500 });
  assert.equal(out.enabled, true);
  assert.deepEqual(waits, [1500]);
});

test("settleAuthProbe: still nothing the second time — said so, and asked no further", async () => {
  let asks = 0;
  const out = await settleAuthProbe(
    async () => {
      asks++;
      return { enabled: null, code: null, detail: "TimeoutError" };
    },
    { sleep: async () => {} },
  );
  assert.equal(asks, 2);
  assert.equal(out.enabled, null);
  assert.equal(out.detail, "asked twice: TimeoutError");
});
