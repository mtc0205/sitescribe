/**
 * Firebase bootstrap.
 *
 * Two modes:
 * - **Live**: a real `VITE_FIREBASE_CONFIG` is provided (production hosting or
 *   a local `.env`). Auth (anonymous) + Firestore + Remote Config + AI Logic.
 * - **Demo**: no config → skip all Firebase services; the app runs fully local
 *   (localStorage persistence, AI on-device path still available through the
 *   Chrome Prompt API because it never leaves the device).
 *
 * Emulator mode (`VITE_USE_EMULATOR=1`) points Auth/Firestore at localhost
 * for development without touching production data.
 */
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAI, GoogleAIBackend } from "firebase/ai";
import { initAI } from "./ai";
import { parseFlagOverrides } from "./flags";

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
    cachedToggles.featureReportDrafting = overrides.reportDrafting ?? true;
    cachedToggles.featureSeverityCheck = overrides.severityCheck ?? true;
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    initAI(ai);
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
  //      register once in App Check → Apps → Manage debug tokens.
  //   2. VITE_RECAPTCHA_SITE_KEY (or VITE_FIREBASE_CONFIG.recaptchaSiteKey) →
  //      real reCAPTCHA attestation — recommended for the hosted URL. The
  //      provider class must match what the console registered: v3 by default,
  //      or enterprise when VITE_RECAPTCHA_PROVIDER=enterprise.
  //   3. VITE_APPCHECK_DEBUG_TOKEN → explicit debug token, accepted from any
  //      origin once registered (the hackathon rules accept debug tokens).
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

  // Auth: anonymous sign-in (upgradeable to Google sign-in later).
  const { getAuth, signInAnonymously, connectAuthEmulator } = await import("firebase/auth");
  const auth = getAuth(app);
  if (EMULATOR) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    console.info("[auth] connected to emulator 127.0.0.1:9099");
  }
  if (auth.currentUser && !navigator.onLine) {
    // Offline cold start with a restored session — skip the network round-trip
    // so the app renders from local persistence without waiting for a timeout.
    console.info("[auth] offline with a restored anonymous session — skipping sign-in round-trip");
  } else {
    await signInAnonymously(auth).catch((e) => console.warn(`[auth] anonymous sign-in failed${EMULATOR ? " (emulator)" : ""}:`, e));
  }
  (globalThis as { __ssAuthUid?: string }).__ssAuthUid = auth.currentUser?.uid ?? "";
  // Test hook (emulator e2e): expose the idToken for direct REST assertions.
  if (EMULATOR) void auth.currentUser?.getIdToken().then((t) => ((globalThis as { __ssAuthIdToken?: string }).__ssAuthIdToken = t));

  // Remote Config: model routing + feature toggles, defaults below.
  const { getRemoteConfig, fetchAndActivate, getValue } = await import("firebase/remote-config");
  const rc = getRemoteConfig(app);
  rc.settings.minimumFetchIntervalMillis = 600_000;
  if (EMULATOR) rc.settings.fetchTimeoutMillis = 5_000; // no RC emulator for web SDK → fail fast to defaults
  rc.defaultConfig = {
    cloud_model: "gemini-3.8-flash",
    feature_report_drafting: true,
    feature_severity_check: true,
  };
  await fetchAndActivate(rc).catch((e) => console.warn("[remote-config] fetch failed, using defaults:", e));

  const ai = getAI(app, { backend: new GoogleAIBackend() });
  initAI(ai, getValue(rc, "cloud_model").asString());

  // Cache Remote Config toggles for the UI (values persist between reloads).
  cachedToggles.cloudModel = getValue(rc, "cloud_model").asString();
  cachedToggles.featureReportDrafting = getValue(rc, "feature_report_drafting").asBoolean();
  cachedToggles.featureSeverityCheck = getValue(rc, "feature_severity_check").asBoolean();
  // Test hook (e2e): proves the app runs on baked-in defaults when RC is unreachable.
  (globalThis as { __ssRemoteToggles?: RemoteToggles }).__ssRemoteToggles = { ...cachedToggles };

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

  return runtime;
}

const cachedToggles: RemoteToggles = {
  cloudModel: "gemini-3.8-flash",
  featureReportDrafting: true,
  featureSeverityCheck: true,
};

/** The Remote Config values in force (baked-in defaults until — and unless — a fetch
 *  says otherwise; the feature switches can also be turned off by the demo-only URL
 *  flag, see initFirebase). Read by the UI through featureGate() in flags.ts. */
export function remoteToggles(): RemoteToggles {
  return { ...cachedToggles };
}
