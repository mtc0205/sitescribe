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
  const cfg = parseConfig();
  if (!cfg) {
    // Demo mode — a real (placeholder-config) Firebase app so the AI Logic
    // SDK initializes locally. Cloud calls fail honestly (no real project);
    // the on-device path works if Chrome's Prompt API has the model.
    const demoCfg = { apiKey: "demo-api-key", authDomain: "sitescribe-demo.firebaseapp.com", projectId: "sitescribe-demo", appId: "1:000000000000:web:demo0000000000000000", storageBucket: "sitescribe-demo.appspot.com", messagingSenderId: "000000000000" };
    const app = initializeApp(demoCfg, "sitescribe-demo");
    runtime.app = app;
    runtime.mode = "demo";
    (globalThis as { __ssRuntimeMode?: string }).__ssRuntimeMode = "demo";
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    initAI(ai);
    return runtime;
  }

  const app = getApps().length ? getApps()[0] : initializeApp(cfg);
  runtime.app = app;
  runtime.mode = "live";

  // App Check: debug provider for local development. The token printed in the
  // console must be registered in Firebase Console > App Check > Apps.
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    const { initializeAppCheck, ReCaptchaV3Provider } = await import("firebase/app-check");
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(cfg.recaptchaSiteKey ?? "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"),
      isTokenAutoRefreshEnabled: true,
    });
  }

  // Auth: anonymous sign-in (upgradeable to Google sign-in later).
  const { getAuth, signInAnonymously } = await import("firebase/auth");
  const auth = getAuth(app);
  if (EMULATOR) await signInAnonymously(auth).catch((e) => console.warn("[auth] emulator sign-in failed:", e));
  else await signInAnonymously(auth).catch((e) => console.warn("[auth] anonymous sign-in failed:", e));

  // Remote Config: model routing + feature toggles, defaults below.
  const { getRemoteConfig, fetchAndActivate, getValue } = await import("firebase/remote-config");
  const rc = getRemoteConfig(app);
  rc.settings.minimumFetchIntervalMillis = 600_000;
  rc.defaultConfig = {
    cloud_model: "gemini-2.5-flash",
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

  // Firestore with offline persistence — records captured in dead zones sync later.
  const { getFirestore, initializeFirestore } = await import("firebase/firestore");
  const fs = EMULATOR ? getFirestore(app) : initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  if (EMULATOR) {
    const { connectFirestoreEmulator } = await import("firebase/firestore");
    connectFirestoreEmulator(fs, "127.0.0.1", 8080);
    console.info("[firestore] connected to emulator 127.0.0.1:8080");
  }

  return runtime;
}

const cachedToggles: RemoteToggles = {
  cloudModel: "gemini-2.5-flash",
  featureReportDrafting: true,
  featureSeverityCheck: true,
};

export function remoteToggles(): RemoteToggles {
  // Live values are cached during initFirebase; defaults otherwise.
  return { ...cachedToggles };
}
