# SiteScribe

**Offline-first AI field inspection companion for civil engineers.**

Capture structured defect records inside signal-dead structures — bridge undersides, tunnels, mountain aqueducts — with **Gemini Nano running on-device** via [Firebase AI Logic](https://firebase.google.com/docs/ai-logic) hybrid inference, and switch to **cloud Gemini** for heavy report drafting when you're back in range.

> Built for the Firebase **#BuildHybridAI 2026** hackathon (Web / Chrome platform).

## Why hybrid inference is the product here

1. Inspections happen where connectivity doesn't. An AI field assistant that dies offline is useless exactly where it's needed.
2. Infrastructure defect data is security-sensitive. It shouldn't leave the device by default.

Every AI output in SiteScribe carries a live **engine badge** — ⚡ `On-device · Gemini Nano` or ☁ `Cloud · Gemini` — driven by the SDK's own `GenerateContentResponse.inferenceSource`, never inferred or faked.

## Feature routing

| Feature | Engine | Why |
|---|---|---|
| Note → structured defect record (JSON) | on-device first | happens offline; private |
| Field Q&A (single-turn) | on-device first | offline, general knowledge |
| Severity cross-check vs reference card | on-device | short context, private |
| Report drafting (aggregate) | cloud only | long-context aggregation |

See [docs/SPEC.md](docs/SPEC.md) for the full product specification.

## Run locally (demo mode — no Firebase project needed)

```bash
npm install
npm run dev
```

Open the printed URL in **Chrome 139+**, enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, restart, then click **⚡ Capture** once — the on-device model downloads on first use (progress shows in the status chip).

Offline demo: DevTools → Network → **Offline**, then capture a record; the badge stays green ⚡ and the record is marked *pending sync*.

The home screen's **Engine & routing** panel shows live telemetry (runtime mode, Prompt API exposure, model availability), the four badge states, and a rolling engine log. If no engine is reachable at all (offline demo, no model), capture degrades to a clearly-labelled **⚙ rule-based** structurer — the loop never dies and nothing is faked.

For UI demonstrations of the cloud badge states before a Firebase project is wired up, append `?engine=sim_cloud` or `?engine=sim_fallback` — demo-mode-only, every badge carries "(simulated)". Real runs never touch this path.

## Tests & e2e

```bash
npm test          # unit tests: rule-based extraction, conflict merge, pending queue, bootstrap env writer
node scripts/e2e-full.mjs   # full offline→sync walkthrough (Chrome, asserts all four features)
node scripts/e2e-emulator.mjs  # REAL Firebase SDK path against the local Emulator Suite — see below
node scripts/e2e-ondevice.mjs  # on-device proof — real on-device badge only, honest skip otherwise
```

### Launching Chrome for on-device runs

Puppeteer's **default launch args include `--disable-features=…OptimizationHints…`**, which alone makes `LanguageModel.availability()` report `unavailable` forever (A/B verified 2026-11-23 — the culprit was never the machine's GPU). Any harness that exercises the on-device path must launch with `ignoreDefaultArgs: ["--disable-features"]` (see `scripts/e2e-ondevice.mjs`), and point `--profile` at a Chrome profile that already has the Gemini Nano component installed — the model is a per-profile ~4 GB download. `scripts/e2e-ondevice.mjs` fails honestly (exit 2, `tools/ondevice-proof.json` says `model-not-available`) when the model isn't in place; nothing is ever simulated on that path.

## Emulator suite (proves the real-SDK path, no Firebase project needed)

`firebase.json` configures the Emulator Suite (auth 9099, firestore 8080, hosting 5000, UI 4000) and `.firebaserc` pins the reserved demo project id `demo-sitescribe`.

```bash
# once: extract a JDK (e.g. Temurin 21) and point JAVA_HOME at it
VITE_USE_EMULATOR=1 npm run build          # bakes the emulator flag into dist/
firebase emulators:start                   # then open http://127.0.0.1:5000
```

`node scripts/e2e-emulator.mjs` does all of the above itself (build, boot, headless Chrome, teardown) and asserts: anonymous sign-in really creates a user; a record captured **offline** lands in the Firestore emulator after reconnect (verified by a direct REST read); Remote Config falls back to baked-in defaults; and the security rules reject cross-user reads (403 via REST with both users' idTokens). Screenshots land in `../tools/emu-*.png`.

## Ship it: one-command bootstrap (needs your Google login once)

```bash
node scripts/firebase-bootstrap.mjs --login
```

Creates the Firebase project, web app, Firestore database, writes `.env` (git-ignored), deploys hosting + Firestore rules + Remote Config, and *verifies* what it can (anonymous sign-in probe via `accounts:signUp`, hosting URL fetch). `--dry-run` prints every step without touching anything; `--deploy-only` rebuilds and redeploys after you paste an App Check key. Remaining console clicks (Anonymous auth, AI Logic "Get started", App Check key) are printed with exact navigation paths.

> App Check is required by Firebase AI Logic (auto-enforced since 2026-11-02). The app resolves it at build time: debug provider on localhost, `VITE_RECAPTCHA_SITE_KEY` (recommended for the hosted URL) or `VITE_APPCHECK_DEBUG_TOKEN` (accepted by the hackathon rules) from `.env` — see `.env.example`.

## Run with Firebase

1. Create a Firebase project; add a Web app; copy the config.
2. `cp .env.example .env` and paste the config as one line.
3. Enable **Authentication → Anonymous**, **Firestore**, and the **AI Logic** workflow (Gemini Developer API provider).
4. Register the App Check **debug token** printed in your console at *App Check → Apps → Manage debug tokens*.
5. `npm run dev` (or `firebase deploy` after `npm run build`).

## Stack

Vite · TypeScript (no UI framework) · Firebase AI Logic / Auth / Firestore / Remote Config / App Check · Apache-2.0
