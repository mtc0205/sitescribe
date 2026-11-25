import { test } from "node:test";
import assert from "node:assert/strict";
import { signInFailure, signInFailureText } from "../src/signin.ts";

// ---- what a failed sign-in means ----

test("signInFailure: the server's 'not enabled' codes, as the browser SDK reports them", () => {
  // The SDK hyphenates a server name its error table lacks; CONFIGURATION_NOT_FOUND is one.
  assert.deepEqual(signInFailure({ code: "auth/configuration-not-found", message: "Firebase: Error (auth/configuration-not-found)." }), { kind: "not-enabled", code: "CONFIGURATION_NOT_FOUND" });
  // ADMIN_ONLY_OPERATION the table maps to a name of its own.
  assert.deepEqual(signInFailure({ code: "auth/admin-restricted-operation", message: "Firebase: Error (auth/admin-restricted-operation)." }), { kind: "not-enabled", code: "ADMIN_ONLY_OPERATION" });
  assert.deepEqual(signInFailure({ code: "auth/operation-not-allowed", message: "Firebase: Error (auth/operation-not-allowed)." }), { kind: "not-enabled", code: "OPERATION_NOT_ALLOWED" });
});

test("signInFailure: the server's own words are read too — a failure that carries no `code`", () => {
  assert.deepEqual(signInFailure(new Error("HTTP 400 CONFIGURATION_NOT_FOUND")), { kind: "not-enabled", code: "CONFIGURATION_NOT_FOUND" });
  assert.deepEqual(signInFailure("Firebase: Error (auth/admin-restricted-operation) : ADMIN_ONLY_OPERATION."), { kind: "not-enabled", code: "ADMIN_ONLY_OPERATION" });
  // … or carries the SDK's spelling in its text.
  assert.deepEqual(signInFailure(new Error("Firebase: Error (auth/operation-not-allowed).")), { kind: "not-enabled", code: "OPERATION_NOT_ALLOWED" });
});

test("signInFailure: a network that did not answer is never 'not enabled'", () => {
  const network = { code: "auth/network-request-failed", message: "Firebase: Error (auth/network-request-failed)." };
  assert.deepEqual(signInFailure(network), { kind: "other" });
  assert.deepEqual(signInFailure(new TypeError("Failed to fetch")), { kind: "other" });
  assert.deepEqual(signInFailure(new Error("Load failed")), { kind: "other" });
  assert.deepEqual(signInFailure(null), { kind: "other" });
  assert.deepEqual(signInFailure(undefined), { kind: "other" });
});

test("signInFailure: any other refusal is 'other' too — none of these means anonymous sign-in is off", () => {
  for (const code of ["auth/invalid-api-key", "auth/app-not-authorized", "auth/project-not-found", "auth/internal-error", "auth/too-many-requests", "auth/invalid-tenant-id"]) {
    assert.deepEqual(signInFailure({ code, message: `Firebase: Error (${code}).` }), { kind: "other" }, code);
  }
  // The word alone is not the code.
  assert.deepEqual(signInFailure(new Error("configuration could not be read")), { kind: "other" });
});

// ---- what the UI says about it ----

const SDK_PRINT = "Firebase: Error (auth/configuration-not-found).";

test("a deployment without anonymous sign-in: the panel says so, names the console path, and never says 'check the connection'", () => {
  const t = signInFailureText(signInFailure({ code: "auth/configuration-not-found", message: SDK_PRINT }), SDK_PRINT);
  assert.match(t.panel, /^This deployment has not enabled anonymous sign-in \(CONFIGURATION_NOT_FOUND\) — projects and records need it\./);
  assert.match(t.panel, /Firebase console → Authentication → Sign-in method → Anonymous → Enable\./);
  assert.match(t.panel, /Reloading the page does not help until then\.$/);
  assert.doesNotMatch(t.panel, /check the connection/i);
  // ＋ New says the same thing, short.
  assert.match(t.alert, /^Not signed in: this deployment has not enabled anonymous sign-in, so projects cannot be saved\./);
  assert.doesNotMatch(t.alert, /check the connection/i);
});

test("each 'not enabled' code is named in the panel", () => {
  assert.match(signInFailureText({ kind: "not-enabled", code: "ADMIN_ONLY_OPERATION" }, "").panel, /sign-in \(ADMIN_ONLY_OPERATION\)/);
  assert.match(signInFailureText({ kind: "not-enabled", code: "OPERATION_NOT_ALLOWED" }, "").panel, /sign-in \(OPERATION_NOT_ALLOWED\)/);
});

test("any other failure keeps the wording the app always had, error included and cut at 160 characters", () => {
  const network = "Firebase: Error (auth/network-request-failed).";
  const t = signInFailureText(signInFailure({ code: "auth/network-request-failed", message: network }), network);
  assert.equal(t.panel, `Could not sign in (${network}) — projects and records need the anonymous sign-in. Check the connection and reload the page.`);
  assert.equal(t.alert, "Not signed in: projects cannot be saved without the anonymous sign-in. Check the connection and reload the page.");
  const long = signInFailureText({ kind: "other" }, "x".repeat(400));
  assert.equal((long.panel.match(/x/g) ?? []).length, 160);
});
