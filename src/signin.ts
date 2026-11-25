/**
 * Anonymous sign-in — what a failed sign-in means for the UI.
 *
 * A sign-in fails for two very different reasons, and they call for opposite
 * advice. Either the network did not answer — try again — or the deployment
 * does not allow the sign-in at all: Firebase Authentication has no
 * configuration for the project (its owner has not opened Authentication in
 * the console), or anonymous sign-in is switched off there. Nothing a visitor
 * does changes the second, and until 2026-11-26 the Projects panel answered it
 * with "Check the connection and reload the page".
 *
 * Pure (no SDK / browser state), so the decision is unit-tested in plain node
 * (tests/signin.test.ts).
 */

export type SignInFailure =
  /** The deployment does not allow anonymous sign-in. `code` is the server's name for it. */
  | { kind: "not-enabled"; code: string }
  /** Anything else — as a rule a network that did not answer. */
  | { kind: "other" };

/**
 * The server's names for "this project does not allow the sign-up". The
 * browser SDK reports them as `auth/` plus the same words in lower case with
 * hyphens. ADMIN_ONLY_OPERATION its error table maps to
 * `auth/admin-restricted-operation`; a name the table lacks — the other two —
 * it hyphenates itself (`auth/configuration-not-found`).
 */
const NOT_ENABLED: { server: string; sdk: string }[] = [
  { server: "CONFIGURATION_NOT_FOUND", sdk: "auth/configuration-not-found" },
  { server: "ADMIN_ONLY_OPERATION", sdk: "auth/admin-restricted-operation" },
  { server: "OPERATION_NOT_ALLOWED", sdk: "auth/operation-not-allowed" },
];

/** Why the sign-in rejected with `error`, as far as can be told: the deployment does not
 *  allow it — and which server code says so — or something else. Read off the SDK's `code`;
 *  an error that carries only text is read for the server's name or the SDK's. */
export function signInFailure(error: unknown): SignInFailure {
  const e = error as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : "";
  const text = String(e?.message ?? error ?? "").toUpperCase();
  for (const { server, sdk } of NOT_ENABLED) {
    if (code === sdk || text.includes(server) || text.includes(sdk.toUpperCase())) return { kind: "not-enabled", code: server };
  }
  return { kind: "other" };
}

export interface SignInFailureText {
  /** The Projects panel, in place of the project list. */
  panel: string;
  /** The ＋ New refusal. */
  alert: string;
}

const CONSOLE_PATH = "Firebase console → Authentication → Sign-in method → Anonymous → Enable";

/**
 * What the Projects panel and the ＋ New refusal say about a failed sign-in.
 * `error` is the failure as the SDK printed it.
 *
 * A deployment that does not allow the sign-in is said so, with the console
 * path that changes it — and without advice to reload, which cannot help. Any
 * other failure keeps the wording the app always had.
 */
export function signInFailureText(failure: SignInFailure, error: string): SignInFailureText {
  if (failure.kind === "not-enabled") {
    return {
      panel: `This deployment has not enabled anonymous sign-in (${failure.code}) — projects and records need it. The project's owner must turn it on: ${CONSOLE_PATH}. Reloading the page does not help until then.`,
      alert: `Not signed in: this deployment has not enabled anonymous sign-in, so projects cannot be saved. The project's owner must turn it on (${CONSOLE_PATH}).`,
    };
  }
  return {
    panel: `Could not sign in (${error.slice(0, 160)}) — projects and records need the anonymous sign-in. Check the connection and reload the page.`,
    alert: "Not signed in: projects cannot be saved without the anonymous sign-in. Check the connection and reload the page.",
  };
}
