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
npm test          # unit tests: rule-based extraction, conflict merge, pending queue
node scripts/e2e-full.mjs   # full offline→sync walkthrough (Chrome, asserts all four features)
```

## Run with Firebase

1. Create a Firebase project; add a Web app; copy the config.
2. `cp .env.example .env` and paste the config as one line.
3. Enable **Authentication → Anonymous**, **Firestore**, and the **AI Logic** workflow (Gemini Developer API provider).
4. Register the App Check **debug token** printed in your console at *App Check → Apps → Manage debug tokens*.
5. `npm run dev` (or `firebase deploy` after `npm run build`).

## Stack

Vite · TypeScript (no UI framework) · Firebase AI Logic / Auth / Firestore / Remote Config / App Check · Apache-2.0
