/**
 * Firebase bootstrap.
 *
 * Three modes:
 * - **Live**: a real `VITE_FIREBASE_CONFIG` is provided (production hosting or
 *   a local `.env`). Auth (anonymous) + Firestore + Remote Config + AI Logic.
 * - **Demo**: no config → skip all Firebase services; the app runs fully local
 *   (localStorage persistence, AI on-device path still available through the
 *   Chrome Prompt API because it never leaves the device).
 * - **Emulator** (`VITE_USE_EMULATOR=1`, no config): the real SDKs against the
 *   local Emulator Suite.
 *
 * Nothing that needs the network is awaited before the first render. The
 * anonymous sign-in and the Remote Config fetch run in the background: the UI
 * renders at once on the baked-in defaults, lists the owner's data once the
 * user exists (authReady), and applies fetched values when they arrive. Until
 * 2026-11-25 both were awaited, and with Google's endpoints unreachable the
 * page stayed blank for 85 s (SPEC §10, §13).
 */
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAI, GoogleAIBackend } from "firebase/ai";
import { initAI, setCloudModel } from "./ai";
import { parseFlagOverrides, DEFAULT_CLOUD_MODEL, FEATURE_DEFAULTS } from "./flags";

const EMULATOR = import.meta.env.VITE_USE_EMULATOR === "1";
const RAW_CONFIG = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;

export interface RuntimeMode {
  app: FirebaseApp | null;
  mode: "live" | "demo";
  emulator: boolean;
}

export const runtime: RuntimeMode = { app: null, mode: "demo", emulator: EMULATOR };

/** Remote Config values with safe local defaults (works offline / demo). */
export interface RemoteToggles {
  cloudModel: string;
  featureReportDrafting: boolean;
  featureSeverityCheck: boolean;
}

function parseConfig(): Record<string, string> | null {
  if (!RAW_CONFIG) return null;
  try {
    const cfg = JSON.parse(RAW_CONFIG);
    return cfg.apiKey ? cfg : null;
  } catch {
    return null;
  }
}

/* ---------- state the background work feeds ---------- */

const cachedToggles: RemoteToggles = {
  cloudModel: DEFAULT_CLOUD_MODEL,
  featureReportDrafting: FEATURE_DEFAULTS.reportDrafting,
  featureSeverityCheck: FEATURE_DEFAULTS.severityCheck,
};

/** The Remote Config values in force: the baked-in defaults until a fetch says otherwise
 *  (in demo mode, until the demo-only URL flag does — see initFirebase). Read by the UI
 *  through featureGate() in flags.ts. */
export function remoteToggles(): RemoteToggles {
  return { ...cachedToggles };
}

type TogglesListener = (toggles: RemoteToggles) => void;
const togglesListeners = new Set<TogglesListener>();

/** Told whenever the values in force change — i.e. when a Remote Config fetch arrives after
 *  the first render. The UI updates the switched controls in place (it must not re-render:
 *  a half-typed note has to survive). */
export function onRemoteTogglesChange(fn: TogglesListener): () => void {
  togglesListeners.add(fn);
  return () => togglesListeners.delete(fn);
}

function publishRemoteToggles(): void {
  (globalThis as { __ssRemoteToggles?: RemoteToggles }).__ssRemoteToggles = { ...cachedToggles };
  togglesListeners.forEach((fn) => fn({ ...cachedToggles }));
}

/** How long the app lets a Remote Config fetch take before it counts as settled and goes
 *  with what it has (the defaults, as a rule). A value that arrives later is still applied.
 *  The SDK's own fetch timeout does not cover the Installations registration that precedes
 *  the fetch — that request hung for 84.5 s on 2026-11-25. */
export const REMOTE_CONFIG_TIMEOUT_MS = 5_000;

export interface RemoteConfigStatus {
  /** True once the fetch settled, failed, or ran out of REMOTE_CONFIG_TIMEOUT_MS. */
  settled: boolean;
  /** How it settled: "activated" | "no-change" | "failed" | "timed-out". */
  outcome?: "activated" | "no-change" | "failed" | "timed-out";
  /** Milliseconds after navigation start at which it settled. */
  settledAfterMs?: number;
  /** Set when the fetch came through after the app had already stopped waiting. */
  late?: "activated" | "no-change" | "failed";
}
let remoteConfigStatus: RemoteConfigStatus = { settled: false };
export function getRemoteConfigStatus(): RemoteConfigStatus {
  return { ...remoteConfigStatus };
}

export type AuthState =
  | { state: "none" } // demo mode: no Firebase Auth
  | { state: "pending" } // no anonymous user yet; the sign-in is under way
  | { state: "signed-in"; uid: string }
  | { state: "failed"; error: string };

let authState: AuthState = { state: "none" };
export function getAuthState(): AuthState {
  return authState;
}

let settleAuthReady: (uid: string) => void = () => {};
let failAuthReady: (reason: unknown) => void = () => {};
/** Settles with the anonymous user's uid once that user exists — a restored session or a
 *  completed sign-in — and rejects if the sign-in fails. Nothing on the render path awaits
 *  it; what needs an owner (the demo seeds, project listings) does. */
export const authReady: Promise<string> = new Promise((resolve, reject) => {
  settleAuthReady = resolve;
  failAuthReady = reject;
});
// A sign-in failure must never surface as an unhandled rejection; callers attach their own handlers.
authReady.catch(() => {});

export async function initFirebase(): Promise<RuntimeMode> {
  let cfg = parseConfig();

  // Emulator mode without a .env config: use the reserved demo project id so
  // the REAL SDK path (Auth + Firestore + Remote Config + AI Logic) runs
  // against the local Firebase Emulator Suite — no real project touched.
  if (!cfg && EMULATOR) {
    cfg = {
      apiKey: "demo-api-key",
      authDomain: "demo-sitescribe.firebaseapp.com",
      projectId: "demo-sitescribe",
      appId: "1:000000000000:web:demo0000000000000001",
      storageBucket: "demo-sitescribe.appspot.com",
      messagingSenderId: "000000000000",
    };
  }

  if (!cfg) {
    // Demo mode — a real (placeholder-config) Firebase app so the AI Logic
    // SDK initializes locally. Cloud calls fail honestly (no real project);
    // the on-device path works if Chrome's Prompt API has the model.
    const demoCfg = { apiKey: "demo-api-key", authDomain: "sitescribe-demo.firebaseapp.com", projectId: "sitescribe-demo", appId: "1:000000000000:web:demo0000000000000000", storageBucket: "sitescribe-demo.appspot.com", messagingSenderId: "000000000000" };
    const app = initializeApp(demoCfg, "sitescribe-demo");
    runtime.app = app;
    runtime.mode = "demo";
    (globalThis as { __ssRuntimeMode?: string }).__ssRuntimeMode = "demo";
    // Demo mode has no Remote Config, so the feature switches keep their defaults —
    // unless the URL switches one off (keys named after the Remote Config ones). That
    // is the only way to see the switched-off UI without a Firebase project: tests
    // and screenshots. It has no effect in emulator or live mode, where Remote
    // Config alone decides (see remoteToggles()).
    const overrides = parseFlagOverrides(location.search);
    cachedToggles.featureReportDrafting = overrides.reportDrafting ?? FEATURE_DEFAULTS.reportDrafting;
    cachedToggles.featureSeverityCheck = overrides.severityCheck ?? FEATURE_DEFAULTS.severityCheck;
    publishRemoteToggles();
    authState = { state: "none" };
    settleAuthReady("");
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    initAI(ai, cachedToggles.cloudModel);
    return runtime;
  }

  const app = getApps().length ? getApps()[0] : initializeApp(cfg);
  runtime.app = app;
  runtime.mode = "live";
  (globalThis as { __ssRuntimeMode?: string }).__ssRuntimeMode = EMULATOR ? "emulator" : "live";

  // App Check — required by Firebase AI Logic (auto-enforced since 2026-11-02;
  // see firebase.google.com/docs/ai-logic/app-check). Skipped in emulator mode
  // (the suite does not enforce App Check). Resolution order:
  //   1. localhost/127.0.0.1 → debug provider; console prints a token to
  //   register once in App Check → Apps → Manage debug tokens.
  //   2. VITE_RECAPTCHA_SITE_KEY (or VITE_FIREBASE_CONFIG.recaptchaSiteKey) →
  //   real reCAPTCHA attestation — recommended for the hosted URL. The
  //   provider class must match what the console registered: v3 by default,
  //   or enterprise when VITE_RECAPTCHA_PROVIDER=enterprise.
  //   3. VITE_APPCHECK_DEBUG_TOKEN → explicit debug token, accepted from any
  //   origin once registered (the hackathon rules accept debug tokens).
  if (!EMULATOR) {
    const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    const siteKey = (import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined) || cfg.recaptchaSiteKey;
    const explicitDebugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined;
    const providerKind: "v3" | "enterprise" =
      (import.meta.env.VITE_RECAPTCHA_PROVIDER as string | undefined)?.toLowerCase() === "enterprise" ? "enterprise" : "v3";
    const { initializeAppCheck, ReCaptchaV3Provider, ReCaptchaEnterpriseProvider } = await import("firebase/app-check");
    if (isLocal || !siteKey) {
      const dbg = self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string };
      dbg.FIREBASE_APPCHECK_DEBUG_TOKEN = explicitDebugToken ?? true;
      console.info(
        explicitDebugToken
          ? "[app-check] debug provider with configured token (register it in App Check → Manage debug tokens)"
          : "[app-check] debug provider — register the token printed below in App Check → Apps → Manage debug tokens",
      );
    } else {
      console.info(`[app-check] reCAPTCHA ${providerKind} provider (site key from env)`);
    }
    // Google's public test key only applies when no real site key is set, i.e.
    // on the debug path above, where the SDK swaps in the debug provider anyway.
    const key = siteKey ?? "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI";
    initializeAppCheck(app, {
      provider: providerKind === "enterprise" ? new ReCaptchaEnterpriseProvider(key) : new ReCaptchaV3Provider(key),
      isTokenAutoRefreshEnabled: true,
    });
  }

  // Auth: anonymous sign-in (upgradeable to Google sign-in later). The round trip is
  // NOT awaited: an unreachable network would otherwise hold the first render for as
  // long as the browser lets a connection hang.
  const { getAuth, signInAnonymously, connectAuthEmulator, onAuthStateChanged } = await import("firebase/auth");
  const auth = getAuth(app);
  if (EMULATOR) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    console.info("[auth] connected to emulator 127.0.0.1:9099");
  }
  authState = { state: "pending" };
  onAuthStateChanged(auth, (user) => {
    (globalThis as { __ssAuthUid?: string }).__ssAuthUid = user?.uid ?? "";
    if (!user) return; // signed out, or not signed in yet
    authState = { state: "signed-in", uid: user.uid };
    settleAuthReady(user.uid);
    // Test hook (emulator e2e): expose the idToken for direct REST assertions.
    if (EMULATOR) void user.getIdToken().then((t) => ((globalThis as { __ssAuthIdToken?: string }).__ssAuthIdToken = t));
  });
  if (auth.currentUser && !navigator.onLine) {
    // Offline cold start with a restored session — skip the network round-trip
    // altogether; the listener above reports the restored user.
    console.info("[auth] offline with a restored anonymous session — skipping sign-in round-trip");
  } else {
    void signInAnonymously(auth).catch((e) => {
      console.warn(`[auth] anonymous sign-in failed${EMULATOR ? " (emulator)" : ""}:`, e);
      authState = { state: "failed", error: String(e) };
      failAuthReady(e);
    });
  }

  // Firestore with offline persistence — records captured in dead zones sync later.
  // persistentLocalCache (IndexedDB) is REQUIRED for the offline promise:
  // writes made offline resolve locally and sync when connectivity returns.
  const { initializeFirestore, persistentLocalCache } = await import("firebase/firestore");
  const fs = initializeFirestore(app, {
    localCache: persistentLocalCache(),
    ...(EMULATOR ? {} : { experimentalAutoDetectLongPolling: true }),
  });
  if (EMULATOR) {
    const { connectFirestoreEmulator } = await import("firebase/firestore");
    connectFirestoreEmulator(fs, "127.0.0.1", 8080);
    console.info("[firestore] connected to emulator 127.0.0.1:8080");
  }

  // AI Logic on the default cloud model; a fetched `cloud_model` is applied below.
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  initAI(ai, cachedToggles.cloudModel);

  // Remote Config: model routing + feature toggles. The defaults are in force from the
  // first render on; the fetch is NOT awaited.
  const { getRemoteConfig, fetchAndActivate, getValue } = await import("firebase/remote-config");
  const rc = getRemoteConfig(app);
  rc.settings.minimumFetchIntervalMillis = 600_000;
  rc.settings.fetchTimeoutMillis = REMOTE_CONFIG_TIMEOUT_MS; // every mode: a slow fetch must not linger
  rc.defaultConfig = {
    cloud_model: DEFAULT_CLOUD_MODEL,
    feature_report_drafting: FEATURE_DEFAULTS.reportDrafting,
    feature_severity_check: FEATURE_DEFAULTS.severityCheck,
  };
  publishRemoteToggles();
  const applyFetchedValues = () => {
    const before = JSON.stringify(cachedToggles);
    cachedToggles.cloudModel = getValue(rc, "cloud_model").asString() || DEFAULT_CLOUD_MODEL;
    cachedToggles.featureReportDrafting = getValue(rc, "feature_report_drafting").asBoolean();
    cachedToggles.featureSeverityCheck = getValue(rc, "feature_severity_check").asBoolean();
    if (JSON.stringify(cachedToggles) === before) return;
    setCloudModel(cachedToggles.cloudModel); // takes effect from the next call on
    publishRemoteToggles();
  };
  const fetched: Promise<Exclude<RemoteConfigStatus["outcome"], "timed-out">> = fetchAndActivate(rc).then(
    (activated) => {
      applyFetchedValues();
      return activated ? "activated" : "no-change";
    },
    (e) => {
      console.warn("[remote-config] fetch failed, using defaults:", e);
      return "failed";
    },
  );
  // Bounded: whatever the network does, Remote Config counts as settled after
  // REMOTE_CONFIG_TIMEOUT_MS and the app goes with what it has by then. A fetch that
  // comes through later still has its values applied (above).
  let stoppedWaiting = false;
  const settle = (outcome: RemoteConfigStatus["outcome"], late = false) => {
    if (late) remoteConfigStatus = { ...remoteConfigStatus, late: outcome as RemoteConfigStatus["late"] };
    else remoteConfigStatus = { settled: true, outcome, settledAfterMs: Math.round(performance.now()) };
    (globalThis as { __ssRemoteConfig?: RemoteConfigStatus }).__ssRemoteConfig = getRemoteConfigStatus();
  };
  void Promise.race([fetched, new Promise<"timed-out">((r) => setTimeout(() => r("timed-out"), REMOTE_CONFIG_TIMEOUT_MS))]).then((outcome) => {
    stoppedWaiting = outcome === "timed-out";
    settle(outcome);
    if (!stoppedWaiting) return;
    // The fetch is still hanging; report how it ends whenever it does.
    void fetched.then((how) => settle(how, true));
  });

  return runtime;
}
