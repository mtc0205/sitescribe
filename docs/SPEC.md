# SiteScribe — Product Specification

> **Offline-first AI field inspection companion for civil engineers.**
> Capture structured defect records inside signal-dead structures (bridge undersides, tunnels, mountain aqueducts) — on-device Gemini Nano when you're offline or the data is sensitive, cloud Gemini when you're back online and need heavy lifting.

Built for the **Firebase #BuildHybridAI 2026 hackathon** (Web / Chrome platform).

---

## 1. Why this exists (the real problem)

Civil inspection happens in the worst possible places for connectivity: under bridge decks, inside tunnels, in mountain valleys next to hydraulic structures. Inspectors today carry paper forms or fragile apps that lose data, and transcription back at the office eats evenings.

Two hard constraints make hybrid inference *structural*, not a gimmick:

1. **Connectivity is genuinely absent** at the point of capture. If the AI helper only works online, it doesn't work where inspections happen.
2. **Infrastructure data is security-sensitive.** Photos and defect notes about a bridge's weak points shouldn't leave the device by default. On-device inference is the privacy story; cloud is opt-in per task.

The builder is a civil/water-resources engineering undergraduate (Zhejiang University) who has walked these sites during coursework — the scenario, vocabulary (JTG/T H21-style defect taxonomy), and pain are first-hand.

## 2. Product name

**SiteScribe** — *site* (where engineers work) + *scribe* (what the AI does: it writes while you inspect).

## 3. Core user story

> Lin, an inspection engineer, steps under a 30-year-old girder bridge at 07:40. No signal. She opens SiteScribe on a ruggedized Chromebook, taps **New Inspection → Girder Bridge #3**, and talks to the phone while walking: "Longitudinal crack on web of girder G2, about two millimeters wide, maybe three meters long, water seepage with white efflorescence nearby." The on-device model (Gemini Nano) instantly returns a **structured defect record** — component, defect type, dimensions, severity hint, exposure notes — which she confirms with one tap. At 17:00 back in range, records sync to Firestore, and she asks the cloud model to **draft the inspection report** cross-referencing the day's 12 records.

## 4. Information architecture (single-page app)

```
Home
 ├─ Project list (bridges/tunnels in your queue)      [Firestore, offline-cached]
 └─ Settings (model routing, engine badge log)
Project detail
 └─ Inspection session (the heart of the app)
     ├─ Quick-capture: type or dictate → structured defect record
     │    · EngineBadge: "⚡ On-device (Gemini Nano)" | "☁ Cloud (Gemini)"
     ├─ Record list (pending sync indicator when offline)
     └─ Ask SiteScribe (single-turn Q&A about what you're looking at)
Report drafts (online task)
 └─ "Draft today's inspection report" → cloud Gemini, cited records
```

## 5. Feature → engine routing (the hybrid decision table)

| # | Feature | Engine | Why this engine |
|---|---------|--------|-----------------|
| F1 | **Speech-to-entry structuring** — free text/dictation → structured defect record (JSON: component, defect type, dimensions, severity, notes) | **On-device first** (`PREFER_ON_DEVICE`), cloud fallback | Happens exactly where there's no signal. Also the privacy-critical path (defect details of infrastructure). Needs to work fully offline. |
| F2 | **Field Q&A** — "what does efflorescence usually indicate?" single-turn answers | **On-device first**, cloud fallback | Asked on-site, offline; answers are general knowledge, Nano-class model is sufficient. |
| F3 | **Report drafting** — aggregate the day's records into a narrative inspection report | **Cloud only** (`ONLY_IN_CLOUD`) | Long-context aggregation across many records; Nano's context window and single-turn limits make this the natural cloud task. Button is visibly disabled offline ("needs connection"). |
| F4 | **Severity cross-check** — compare a record against maintenance-standard categories | **On-device** with small reference card in the prompt | Short input, short output, standards text fits in prompt; private data stays local. |

On-device supports single-turn text(+JPEG/PNG) generation with JSON output — F1/F2/F4 fit inside those limits by design; F3 deliberately doesn't.

## 6. Engine Badge (the demo-defining UI)

Every AI-produced block carries a live badge, driven by `GenerateContentResponse.inferenceSource` (`InferenceSource.ON_DEVICE` / `IN_CLOUD`):

- ⚡ **On-device · Gemini Nano** (green chip) — worked with network off, data never left the device
- ☁ **Cloud · Gemini** (blue chip) — server-side inference
- ⏳ **Downloading model · 42%** — from `initializeDeviceModel(progress => …)` callback
- ↘️ **Fell back to cloud** (amber) — requested on-device, SDK fell back (device model unavailable)

The badge is honest telemetry straight from the SDK — never inferred, never faked.

## 7. Firebase product map

| Product | Role | Notes |
|---|---|---|
| **Firebase AI Logic** | Hybrid inference SDK (`firebase/ai`) — the contest requirement | `getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE })`, `initializeDeviceModel()`, `response.inferenceSource` |
| **App Check** | Required by AI Logic; debug provider for local dev (`self.FIREBASE_APPCHECK_DEBUG_TOKEN = true`), debug token registered in console (allowed in submissions) | reCAPTCHA v3 provider wired for production hosting |
| **Authentication** | Anonymous auth by default (inspectors shouldn't have to sign up to try it) | Upgrade path: Google sign-in to share a project across a team |
| **Firestore** | Projects + inspection records; **offline persistence (IndexedDB)** so records written in signal-dead zones sync automatically when back online | Rules: users read/write only their own data |
| **Remote Config** | Model routing policy without redeploying: cloud model id, on-device/cloud toggles per feature, prompt template version switch | Fallback defaults baked in so the app works before first fetch |
| **Hosting** | Public demo URL for judges | Deploy at submit time |

## 8. Non-goals (v1)

- No photo capture pipeline in v1 (on-device supports JPEG/PNG input — noted as roadmap).
- No team/multi-user workflows.
- No offline voice transcription (Web Speech API requires network in Chrome; dictation story is honest about this — v1 is type-first, voice listed as roadmap).

## 9. Success criteria (hackathon lens)

- **Technological Implementation**: hybrid SDK imported and actually called at runtime; all four `InferenceMode`s exercised where meaningful; engine badge reflects real `inferenceSource`.
- **Design**: complete loop — project → offline capture → sync → report — not a PoC screen.
- **Potential Impact**: real audience (inspection engineers), real constraint (dead zones + data sensitivity), credible domain vocabulary.
- **Quality of Idea**: hybrid as architecture, not checkbox — the offline capture path is the product.

## 10. Repository layout

```
sitescribe/
├── docs/SPEC.md          ← this file
├── src/                  ← Vite + TypeScript app
├── firebase.json         ← emulator + hosting config
├── firestore.rules       ← security rules
└── LICENSE               ← Apache-2.0
```
