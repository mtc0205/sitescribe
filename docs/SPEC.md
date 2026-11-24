# SiteScribe — Product Specification

> **Offline-first AI field inspection companion for civil engineers.**
> Capture structured defect records inside signal-dead structures (bridge undersides, tunnels, mountain aqueducts) — on-device Gemini Nano when you're offline or the data is sensitive, cloud Gemini when you're back online and need heavy lifting.

Built for the **Firebase #BuildHybridAI 2026 hackathon** (Web / Chrome platform).

> **Revision of 2026-11-25.** This revision replaces the 2026-11-20 description of a diagnostics-first screen with the product-first interface shipped on 2026-11-23/24. Every statement below was checked against the code at commit `5cc400c`. Section numbers 1–8 keep their meaning, so the references in the code (`SPEC §4`, `§5`, `§6`, `§8`) stay valid. [§13](#13-known-gaps--verified-vs-never-observed) separates what has been seen in a running build from what has only been read in the code.
>
> **Amended in the night of 2026-11-25**, after the audit that found the UI and the docs claiming a few things the code did not do: which engine a record is credited to (§5.1, §6.1), simulation labelling (§4.1, §4.2, §4.3, §6.2, §6.3, §6.5), the Remote Config feature switches (§4.2, §5, §7), test counts (§11, §12) and the list of known gaps (§13) were re-checked against the application code at commit `f7f7b22`.

---

## 1. Why this exists (the real problem)

Civil inspection happens in the worst possible places for connectivity: under bridge decks, inside tunnels, in mountain valleys next to hydraulic structures. Inspectors today carry paper forms or fragile apps that lose data, and transcription back at the office eats evenings.

Two hard constraints make hybrid inference *structural*, not a gimmick:

1. **Connectivity is genuinely absent** at the point of capture. If the AI helper only works online, it doesn't work where inspections happen.
2. **Infrastructure data is security-sensitive.** Photos and defect notes about a bridge's weak points shouldn't leave the device by default. On-device inference is the privacy story; cloud is opt-in per task.

The builder is a civil/water-resources engineering undergraduate (Zhejiang University) who has walked these sites during coursework — the scenario, vocabulary (JTG/T H21-style defect taxonomy), and pain are first-hand.

## 2. Product name

**SiteScribe** — *site* (where engineers work) + *scribe* (what the AI does: it writes while you inspect).

## 3. Core user story (v1: typed, not dictated)

> Lin, an inspection engineer, steps under a 30-year-old girder bridge at 07:40. No signal. She opens SiteScribe on a ruggedized Chromebook. The home screen shows her queue of projects and a three-step picture of what is about to happen — field note → structured record → sync when back in range. She opens **Girder Bridge No.3** and **types** into *Capture defect*: "Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long." Gemini Nano, already loaded on the device, returns a **structured defect record** — component, defect type, quantity, severity, notes. The record is saved at once, marked *pending sync*, and the chip on it names the engine that produced it. At 17:00, back in range, the pending records sync to Firestore and the chips flip to *synced*; she taps **Draft report** and cloud Gemini turns the day's records into a report she can copy as Markdown or print.

v1 has no speech input. Notes are typed and the button says **Capture**, not "Dictate" (§8).

## 4. Information architecture (single-page app, two views)

### 4.1 Home — product first

Top to bottom:

1. **Top bar** (both views): brand; connectivity chip (`⇅ online` / `✕ offline`); engine chip (§6.3); runtime chip (`local demo` / `emulator` / `firebase live`). Directly under it, on this view and on the inspection session alike, comes the banner of the demo simulation — only while that simulation is on (§6.5).
2. **Two-column first screen**
   - *Left:* the hero — "Field inspections in dead zones, still structured." — with one call to action, **Open today's inspection →** (opens the first project, or starts a new one when there is none), and **Projects**: one card per project (name, structure type, record count, "since" date) plus **＋ New** (two browser prompts: name, then structure type `bridge` / `tunnel` / `hydraulic` / `other`).
   - *Right:* **From field note to structured record** (hint: *works offline*), a three-step walkthrough:

     | Step | Title | What is shown |
     |---|---|---|
     | 1 | Say it like you'd talk | the example note as a speech bubble: "Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long." |
     | 2 | Structured where you stand | the record card for that note, built at render time by the real rule-based extractor (§5.2) and labelled as its output, with the note that Gemini Nano or cloud Gemini fill the same fields |
     | 3 | Syncs when you're back in range | `⏳ pending sync` → `✓ synced` |
3. **Badge legend** — "Every answer is badged with the engine that produced it": the four engine states as an always-visible row of chips, each with a one-line explanation (§6.2).
4. **Engine & diagnostics** — a single collapsed bar. Its summary line states the on-device model state in plain words (for example "on-device model not installed"), then — only while the demo simulation is on — `simulation: cloud — badges say "(simulated)"`, and the number of engine events. Expanded, it holds the runtime label, whether the browser exposes the Prompt API, the model availability Chrome reports, the simulation state, the demo-only simulation switches (*off / cloud / fallback*) and the engine log (§6.4), which is rendered only once there is an event.
5. **Footer**: licence line and "every engine badge is live SDK telemetry — never faked".

The first screen is about the inspection loop. Engine telemetry is still on the page, one click away, but no longer owns it. Below 960 px wide the two columns stack and the legend becomes 2 × 2; below 480 px the legend is a single column.

### 4.2 Inspection session (one project)

Top bar: **← Projects** and the same three status chips — and, with the demo simulation on, the same banner as the home view (§6.5). Then three panels:

| Panel | Controls | Behaviour |
|---|---|---|
| **Capture defect** (hint: *on-device first · works offline*) | text area (placeholder "Type it like you'd talk: …"), **⚡ Capture** | F1 (§5). The result block *Structured record* shows the engine badge, the record card and a *Check severity vs reference* button (F4; the one on this preview card is not wired — §13). The record is saved immediately — there is no separate confirm step — and the preview is replaced by the saved card. A failure prints "Capture failed: …". |
| **Records (n)** | **↻ Back in range**, **☁ Draft report** | compact record cards (§4.3), newest first, each with *Check severity vs reference* (F4). **Draft report** runs F3; the result is preformatted text with **Copy Markdown** and **Print / PDF**. With no records it says "Capture some records first." When Remote Config switches F3 or F4 off, its control is disabled and one line under the header says why (§7). |
| **Ask SiteScribe** (hint: *on-device first · single-turn*) | question input, **Ask** (Enter also submits) | F2. One question, one answer; no conversation history is kept. |

**↻ Back in range** prints a count for 2.5 s ("↻ Back in range (2 synced)"): records flipped in demo mode, records of this project that are synced in emulator and live mode. In demo mode it simulates the server acknowledgement; in emulator and live mode it waits for Firestore to acknowledge the queued writes (§4.5).

### 4.3 Record cards

One compact card per record, three rows at most:

- **Head row:** severity dot (grey = not assessed, green = minor, amber = moderate, red = severe) · defect type as the title · component · on the right the engine chip (`⚡ on-device` / `☁ cloud` / `⚙ rule-based` / `⏳ engine unknown`, read from the saved `extractedBy`; a record made under the demo simulation adds ` (simulated)`, §6.5) and the sync chip (`⏳ pending sync` / `✓ synced`).
- **Meta row:** quantity · severity · capture time.
- **Notes**, when present.

Rules: a model field left empty prints "(unspecified)"; the card resets `white-space`, so a card inside the capture result has no blank rows and no box inside a box; the sync chip is hidden on the capture-result preview and on the home-screen example.

### 4.4 Timestamps — local time, zone stated

Records are stored as ISO-8601 UTC strings and are always displayed in the viewer's local time with the zone spelled out:

| Where | Format | Example |
|---|---|---|
| Record card | `Nov 24, 03:33 (UTC+8)` | hovering shows the stored instant |
| Project card | local calendar date | `since 2026-11-23` |
| Engine log | `HH:MM:SS`, zone printed once in the log header | `04:34:11` · `local time UTC+8` |

Half-hour zones and daylight saving are handled. An unparsable value prints "—" and never throws.

### 4.5 Sync state

| Mode | Online capture | Offline capture | Flip to *synced* |
|---|---|---|---|
| Demo | `✓ synced` at once | `⏳ pending sync` | **↻ Back in range** (simulation) |
| Emulator / live | `⏳ pending sync` | `⏳ pending sync` | automatic, when the server acknowledges the write; **↻ Back in range** just waits for the queue |

In emulator and live mode a record is *born* pending, whatever the connectivity: *synced* means "the server has it", never "the device is online".

## 5. Feature → engine routing (the hybrid decision table)

| # | Feature | Where | `InferenceMode` | If that engine cannot answer |
|---|---|---|---|---|
| F1 | **Note → structured defect record** (JSON) | Capture defect | `PREFER_ON_DEVICE` | the SDK falls back to cloud; if no model answers inside the budget (§9) or the reply is not usable JSON, the rule-based extractor produces the record, which is saved and badged as rule-based (§5.1) |
| F2 | **Field Q&A**, single-turn | Ask SiteScribe | `PREFER_ON_DEVICE` | an honest text instead of an answer ("Field Q&A needs either the on-device model or a connection — none was reachable…"); capture keeps working |
| F3 | **Report drafting** from the day's records | Draft report | `ONLY_IN_CLOUD` | offline no call is made; the badge says "Report drafting needs a connection (cloud task)" |
| F4 | **Severity cross-check** against a short indicative reference card (crack-width bands, exposed reinforcement, seepage/efflorescence) | Check severity vs reference | `PREFER_ON_DEVICE` | a rule-based cross-check against the same card |

The SDK offers four modes (`PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`, `ONLY_IN_CLOUD`, `PREFER_IN_CLOUD`); the app uses the two in the table. The cloud model named in Remote Config is handed to the SDK as the top-level `model` of every request — which SDK 13.4.0 ignores whenever a hybrid `mode` is set, so it is not the model that is actually called (§7, §13). F3 receives the records as a plain numbered list and is asked for clean Markdown. F3 and F4 can be switched off by Remote Config (§7); F1 and F2 cannot.

### 5.1 The record and why its JSON keys are spelled out in the prompt

```
{ "component": string, "defectType": string, "quantity": string,
  "severity": "unknown" | "minor" | "moderate" | "severe", "notes": string }
```

The SDK's on-device path ignores `generationConfig` — it forwards only the prompt text — so `responseSchema` and `responseMimeType` cannot be relied on there. The structuring prompt therefore states the keys and the allowed severity values itself; the cloud path additionally enforces the schema.

A record is credited to the engine that produced its **fields**, never to the one that merely replied. So when a model answers but not with usable JSON — nothing that parses, not an object, no string `component` — the fields come from the rule-based extractor and the record says so everywhere: it is saved with `extractedBy: "rule_based"`, its chip reads `⚙ rule-based`, its badge `⚙ Rule-based (Gemini Nano replied, but not with usable JSON)` (`Gemini` for a cloud reply, `The engine` when the SDK did not say which), and its `notes` end with "[Gemini Nano replied, but its reply was not usable JSON — fields structured by rules]". The decision is `settleStructureReply()` in `src/engine.ts`, unit-tested and driven end to end by `e2e-full` (e2e-16). Until 2026-11-25 such a record carried the model's chip.

### 5.2 Rule-based extractor (the transparent fallback)

Pure functions with no SDK dependency, unit-tested, also used for the home-screen example:

- **Defect type: the defect the note mentions first.** Each entry of the vocabulary is searched in the lower-cased note and the earliest match wins; when two entries match at the same position the more specific one wins ("longitudinal crack" before "crack"). No match → "unclassified observation". Vocabulary: efflorescence, seepage, spalling, delamination, corrosion / exposed reinforcement, longitudinal crack, transverse crack, crack, excessive deflection, settlement.
- **Component:** the member named after on / near / at / of (for example "girder G2", "pier P1"), otherwise "unspecified component".
- **Quantity:** every measurement in the note (mm, cm, m, m²) kept verbatim, otherwise "not stated".
- **Severity:** exposed reinforcement, "severe" or "large" → severe; else a width above 0.5 mm → moderate; else hairline, minor or small → minor; else unknown.
- **Notes:** the first 200 characters of the note.

It is never presented as AI output: the record chip says `⚙ rule-based`.

## 6. Engine badge

### 6.1 The four routing states and what drives each

| State | Badge (colour) | Driven by | Seen when |
|---|---|---|---|
| **On-device** | green · `⚡ On-device · Gemini Nano` | `GenerateContentResponse.inferenceSource === "on_device"` | F1 and F2 with the model installed (asserted with the network cut); F4 uses the same mode |
| **Cloud** | blue · `☁ Cloud · Gemini` | `inferenceSource === "in_cloud"` on a request that did **not** ask for on-device (F3) | report drafting † |
| **Fell back to cloud** | amber · `☁ Fell back to cloud · Gemini` (the legend chip reads `↘ Fell back to cloud`) | `inferenceSource === "in_cloud"` on a request that **did** ask for on-device (F1, F2, F4) | on-device was preferred but could not serve the request † |
| **Rule-based fallback** | grey (neutral) · `⚙ Rule-based fallback (no AI engine reachable)` | no usable model reply: the call threw, or outlived its budget | no model and no reachable cloud |
| **Rule-based, reply unusable** | grey (neutral) · `⚙ Rule-based (… replied, but not with usable JSON)` | a model answered, but with text that could not be used; the fields are the rules' (§5.1) | edge case, driven by `e2e-full` with a canned reply |

† Never observed for real — there is no Firebase project yet (§13). Only the labelled demo simulation (§6.5) has shown these two chips.

The engine is never inferred from the requested mode; it is read from the response. "Cloud" and "Fell back to cloud" differ in exactly one fact: whether that request preferred on-device. When the SDK answers without `inferenceSource` (the field is optional), the chip says `⏳ Engine unknown` rather than guessing, and the record is stored with `extractedBy: "unknown"` and shows `⏳ engine unknown` on its card — the model did produce the fields (`badgeFromSource()` and `recordEngine()` in `src/engine.ts`). The installed SDK (13.4.0) always sets the field, so this path is driven by `e2e-full` with the property hidden where the app reads it (e2e-17).

Other labels shown in the same chips:

| Label | Meaning |
|---|---|
| `⏳ Downloading on-device model · 42%` | progress callback of `initializeDeviceModel()` |
| `⚡ On-device model ready` | installed and preloaded: one tiny local inference succeeded |
| `⏳ On-device model available — the first request will load it` | installed, but the preload inference failed |
| `⚙ On-device model still downloading` / `⚙ On-device model not available` | after a warm-up attempt, when Chrome does not report the model as available |
| `⚙ No engine reachable (offline, no device model)` | F2 fallback |
| `⚙ Report drafting needs a connection (cloud task)` | F3 while offline |

"Ready" is never the app's own word: it is emitted only when Chrome reports `available` and the preload inference succeeds. Red is reserved for real failures and the offline indicator; the rule-based fallback is neutral grey on purpose.

### 6.2 Where badges appear

1. **Answer blocks** — *Structured record*, the Q&A answer, the severity check and the report draft each carry the badge of the engine that produced them.
2. **Record cards** — the engine chip from the saved `extractedBy` (§4.3), so a record keeps saying which engine structured it.
3. **Status bar** — the engine chip (§6.3).
4. **Legend** (home screen, always visible) — a static explanation of the four states:

   | Chip in the legend | Note underneath |
   |---|---|
   | `⚡ On-device · Gemini Nano` | **live**: Chrome's answer for this browser, in words — "Installed — capture, Q&A and severity checks run on this device, offline." / "Optional — Chrome downloads the model on first use." / "Downloading the on-device model · N% — …" / "Not supported in this browser — …" / "Not installed on this device — …" (the last three end by naming what answers instead: the cloud engine, or the rule-based fallback) |
   | `☁ Cloud · Gemini` | "report drafting, and capture where the on-device model isn't installed" |
   | `↘ Fell back to cloud` | "on-device was preferred but could not serve the request" |
   | `⚙ Rule-based` | "no engine reachable — transparent keyword rules keep capture working" |

   While the demo simulation is on, the legend's two cloud chips carry ` (simulated)` as well (§6.5); in a real run they read exactly as above.

5. **Engine log** (§6.4).

### 6.3 Status-bar engine chip — which engine is on duty

- Before any engine event: `⚡ On-device ready` (model installed) · `☁ Cloud engine · on-device optional` (live Firebase, model not installed) · `⚙ Rule-based structuring` (demo or emulator, model not installed). With the demo simulation on, none of these: the chip states the simulated label, `☁ Cloud · Gemini (simulated)` or `↘ Fell back to cloud · Gemini (simulated)`.
- After an event: the short form of the latest engine event that is not a download tick — an answer's badge, or a model-state line from the warm-up (`On-device model ready`, `On-device model loading`, `On-device model downloading`, `On-device model unavailable`). Download progress is shown here only until the first answer exists.

### 6.4 Engine log

The session's engine events, held in memory (not persisted), newest first, at most 50 entries: local time · feature (`F1 structure`, `F2 field QA`, `F3 report`, `F4 severity check`, `system`) · badge. A model download is one rolling entry instead of one per progress tick. An F1 call whose reply turns out unusable leaves two rows: the engine's answer, then `Rule-based (… replied, but not with usable JSON)` (§5.1).

### 6.5 Simulation of the cloud states (demo mode only)

`?engine=sim_cloud` or `?engine=sim_fallback` short-circuits the AI calls **only when the app runs in demo mode**: the answer text is produced locally (structuring by the rule-based extractor; a placeholder for Q&A — the report draft is not a report, see §13) and the badge reads `Cloud · Gemini (simulated)` or `Fell back to cloud · Gemini (simulated)`. Everything that reflects the simulated engine carries the label in its own text:

- the answer badges (F1–F4) and their rows in the engine log;
- record cards: a record made under the simulation is stored with `simulated: true`, its chip reads `cloud (simulated)`, and it goes on doing so after the simulation is switched off and in later sessions;
- the status chip: the simulated label before the first answer and after each one;
- the legend's two cloud chips, and the diagnostics summary (`simulation: cloud — badges say "(simulated)"`).

A banner ("Simulation is on…") sits directly under the top bar on **both** views, home and inspection session. The diagnostics facts show the simulation state, and `?engine=off` turns it off. In emulator and live mode the flag has no effect at all: nothing is simulated, and no banner and no simulation state is shown, because `engineSimulation()` reports the simulation that is in effect. Model-state lines and download progress are real telemetry and are never labelled.

`e2e-full` asserts each of these (e2e-18…21) and that a real run shows none of it; `e2e-emulator` asserts that the flag has no effect outside demo mode.

## 7. Firebase product map

| Product | Role in the shipped code | Status |
|---|---|---|
| **Firebase AI Logic** | `getGenerativeModel(ai, { model: <cloud model>, mode })` for each call; `initializeDeviceModel(progress)`; `response.inferenceSource` drives the badge | on-device path proven with the network cut; cloud path never called against a real project |
| **Cloud model** | `gemini-3.8-flash` by default — same value in `src/ai.ts`, `src/firebase.ts` (Remote Config default) and `remoteconfig.template.json`; passed to `getGenerativeModel()` as the top-level `model` | the default value is asserted in the emulator run (the cached Remote Config value). **It is not the model that is actually called:** SDK 13.4.0 ignores a top-level `model` whenever a hybrid `mode` is set — it takes `inCloudParams.model` instead, which the app does not pass, and falls back to its own default, `gemini-3.5-flash-lite`. The request observed on 2026-11-25 named that model (§13). Never reached by a real project |
| **App Check** | live mode only. localhost or no site key → debug provider (token printed to the console, or `VITE_APPCHECK_DEBUG_TOKEN`). A site key (`VITE_RECAPTCHA_SITE_KEY`) → reCAPTCHA attestation, v3 by default, Enterprise with `VITE_RECAPTCHA_PROVIDER=enterprise`. Auto-refresh on | code only; production attestation never verified (§13) |
| **Authentication** | anonymous sign-in only; an offline cold start with a restored session skips the sign-in round trip | proven against the Auth emulator |
| **Firestore** | `persistentLocalCache()` (IndexedDB); collections `projects` and `records`, both stamped with `owner`; rules allow owner-only read / update / delete and create only for one's own uid; listings read the local cache, never the server | proven against the Firestore emulator |
| **Remote Config** | three keys with baked-in defaults: `cloud_model`, `feature_report_drafting`, `feature_severity_check`; fetch at most every 10 minutes. The two feature keys are kill-switches (`featureGate()` in `src/flags.ts`): when one is `false` its feature is not offered — the control is disabled and one line under *Records* says why (`Report drafting is switched off by Remote Config — no request is sent.`; the key is in the disabled control's tooltip) — and no request is sent. Defaults stay `true` | only the fallback to defaults was ever exercised against a real fetch; the switched-off state was exercised through the demo-only URL flags, not through Remote Config. `cloud_model` is read and cached but does not reach the request (previous row) |
| **Hosting** | `firebase.json`: `dist/`, single-page rewrite, cache headers, `sw.js` served `no-cache` | never deployed |

### 7.1 Running modes

| | Demo (default) | Emulator | Live |
|---|---|---|---|
| Entered when | no `VITE_FIREBASE_CONFIG` | `VITE_USE_EMULATOR=1` and no config | a `VITE_FIREBASE_CONFIG` containing an `apiKey` |
| Firebase app | placeholder config, so that AI Logic initialises locally | reserved project id `demo-sitescribe` | the real project |
| Runtime chip | `local demo` | `emulator` | `firebase live` |
| Auth, Firestore, Remote Config | not used | real SDKs against the local Emulator Suite (Auth 9099, Firestore 8080, hosting 5000) | real backend |
| App Check | not used | not used (the suite does not enforce it) | debug or reCAPTCHA provider |
| Data | `localStorage` (`sitescribe.v1`) | Firestore emulator + local cache | Firestore + IndexedDB cache |
| Demo seeds | yes | yes | no |
| Cloud model | none — calls fail honestly | none (there is no AI Logic emulator) | real |
| On-device model | real, if Chrome has it | real, if Chrome has it | real, if Chrome has it |
| Sync chip | §4.5: *Back in range* simulates the acknowledgement | §4.5: flips on the emulator's acknowledgement | §4.5: flips on the server's acknowledgement |
| Badge-state simulation (`?engine=…`) | available | off | off |
| Feature switches | URL flags stand in for Remote Config: `?feature_report_drafting=false`, `?feature_severity_check=false` (demo mode only; the explanation then reads `… switched off by the demo URL flag — no request is sent.`) | Remote Config only — the URL flags are ignored | Remote Config only — the URL flags are ignored |

**Demo seeds** (only when there are no projects yet): one project, "Girder Bridge No.3 — Qiantang tributary", with three sample records created 24, 23 and 22 hours earlier. Every seed is labelled "Sample record (demo seed)", attributed to `rule_based` and synced — so the first-time visitor lands in a believable context without any record claiming an engine that never ran.

## 8. Non-goals (v1)

- **No speech input.** Notes are typed. (The Web Speech API needs the network in Chrome; voice is roadmap.)
- **No photo capture.** Every prompt v1 sends is text-only.
- **No team or multi-user workflows**; no Google sign-in (anonymous auth only).
- **No settings screen**; engine state lives in the collapsed *Engine & diagnostics* section of the home screen.
- **No editing or deleting records** in the UI; records are append-only.
- **Report drafting is not available offline**, by design.

## 9. On-device model lifecycle and call budgets

**What the app asks Chrome.** `"LanguageModel" in self` says whether the Prompt API is exposed; `LanguageModel.availability()` answers `unavailable`, `downloadable`, `downloading` or `available`. That answer drives the legend note, the diagnostics summary and the first budget below.

**At boot.** If Chrome already answers `available`, the app calls `initializeDeviceModel()` and runs one tiny local inference ("Reply with the single word: ready."). `initializeDeviceModel()` only loads the component; the first real inference would otherwise pay the cost of bringing the weights into memory. Boot never starts a download; in any other state it does nothing.

**On the first Capture or Ask click** — a user gesture, which Chrome requires — and once per session:

- model installed → wait for the preload, so that this very request can be served on-device;
- model not installed → start Chrome's download in the background and **continue immediately**. The request is answered by the cloud (live mode) or the rule-based fallback (demo or emulator), and the badge says which. Measured on 2026-11-24 in demo mode on a profile without the model: before this change, no record 25 s after the click (download at 32 %); after it, a record after 1.0 s.

**Download progress** is shown in the legend note and the diagnostics summary, as one rolling engine-log entry, and in the status-bar chip until the first answer exists.

**Budgets.** Only the structuring call (F1) is raced against a timeout, so an unreachable cloud cannot hang capture in the field. F2–F4 simply wait for the SDK to succeed or fail — which on a network that hangs rather than refusing means waiting for the browser's own connection timeout (84.5 s observed on 2026-11-25, §13).

| Chrome's answer for the on-device model | Runtime | Budget for F1 |
|---|---|---|
| `available`, first structuring call of the page session | any | **90 s** — it also loads the weights |
| `available`, later calls | any | 45 s |
| anything else | demo or emulator | 12 s — no cloud backend exists there, so fail fast to the rules |
| anything else | live | 45 s — gives the cloud path time to answer |

When the budget runs out, the record is structured by the rule-based extractor and badged accordingly.

## 10. Offline behaviour

| Action while offline | Model installed | No model |
|---|---|---|
| Capture | structured on-device; record *pending sync* | rule-based fallback as soon as the SDK's cloud fallback fails — at the latest when the budget (§9) runs out: 12 s in demo or emulator mode, 45 s in live mode |
| Ask SiteScribe | answered on-device | honest "no engine reachable" text |
| Check severity | answered on-device | rule-based cross-check |
| Draft report | no call; badge "Report drafting needs a connection (cloud task)" | same |
| Connectivity changes | only the connectivity chip is updated; the view is not re-rendered, so a half-typed note survives | same |

- **Persistence.** Demo mode keeps everything in `localStorage`. Emulator and live mode use Firestore's offline persistence: writes made offline resolve locally and are sent when connectivity returns.
- **Cold start offline (emulator or live mode).** With a restored anonymous session the app skips the sign-in round trip and renders from local persistence.
- **App shell.** A production build registers a service worker generated at build time: it precaches the shell, serves navigations network-first with the cached shell as fallback and same-origin assets cache-first, and never touches cross-origin (Firebase / Gemini) traffic.
- **Remote Config.** A failed fetch leaves the baked-in defaults in place. The first render waits for that fetch (and, before it, for the Installations registration it needs): where Google's endpoints hang instead of refusing, that wait was 85 s on 2026-11-25 (§13).

## 11. Success criteria and acceptance criteria

### 11.1 Success criteria (hackathon lens)

- **Technological Implementation**: hybrid SDK imported and actually called at runtime; the on-device path proven with the network cut; engine badge reflects real `inferenceSource`.
- **Design**: complete loop — project → offline capture → sync → report — not a PoC screen; the first screen shows the product, not the diagnostics.
- **Potential Impact**: real audience (inspection engineers), real constraint (dead zones + data sensitivity), credible domain vocabulary.
- **Quality of Idea**: hybrid as architecture, not checkbox — the offline capture path is the product.

### 11.2 Acceptance criteria

"Last recorded result" is the verification run of 2026-11-25 on the application code at commit `f7f7b22` (unit tests, `e2e-full`, the contrast audit), as recorded in the README and the night report; the emulator and on-device rows carry their own dates. "code reading" means the criterion is visible in the source but asserted by no script.

| # | Criterion | Checked by | Last recorded result |
|---|---|---|---|
| A1 | The first screen (1280 × 800) holds the hero, Projects, the three steps, the legend and the collapsed diagnostics bar | `scripts/ui-screens.mjs` first-screen audit | pass |
| A2 | Diagnostics are collapsed by default; the engine log renders only with events | code reading | — |
| A3 | The home-screen example card is the rule-based extractor's real output | code reading | — |
| A4 | Typed capture only; no speech API anywhere in `src/` | code reading | — |
| A5 | The rule-based extractor takes the defect mentioned first; a tie keeps the more specific one | `npm test` | 79 / 79 unit tests |
| A6 | Record times are local with an explicit zone | `npm test` (7 format tests), `e2e-full` | pass |
| A7 | A connectivity change keeps a half-typed note | `e2e-full` | 31 / 31 |
| A8 | Demo mode: seeds are synced, an online capture is synced at once, an offline capture is pending, *Back in range* flips it | `e2e-full` | 31 / 31 |
| A9 | Demo and emulator mode fake no engine: badges read rule-based / no engine / needs a connection | `e2e-full`, `e2e-emulator` | pass |
| A10 | Real SDK chain: anonymous sign-in, an offline write is absent from the server and arrives after reconnect, the chip flips, rules reject cross-user access | `e2e-emulator` | 21 / 21 (2026-11-25, Firestore emulator port moved — §12) |
| A11 | The app renders after an offline hard reload and the records survive it | `e2e-emulator` | 21 / 21 |
| A12 | With the model installed and the network cut, the F1 and F2 badges come from `inferenceSource === "on_device"` | `e2e-ondevice` | 2 / 2 (2026-11-24; not re-run on 2026-11-25 — §13) |
| A13 | Every checked text / background pair is at least 4.5 : 1 | `ui-screens.mjs` | 160 / 160, minimum 5.7 : 1 |
| A14 | The first capture does not wait for the model download | manual probe, 2026-11-24 | observed; no automated assertion |
| A15 | Real cloud badge, real fell-back badge, hosted URL, production App Check | — | **never observed** (§13) |
| A16 | A record is credited to the engine that produced its fields: an unusable reply gives a rule-based record, a reply without `inferenceSource` gives `Engine unknown` / `unknown` | `npm test` (8 engine tests), `e2e-full` (e2e-16/17, canned replies) | pass |
| A17 | With the demo simulation on, every answer badge, legend chip, status chip, record card and log row says "(simulated)" and the banner is on both views; a real run shows none of it | `e2e-full` (e2e-18…21), `e2e-emulator` | pass |
| A18 | A feature switch set to `false` disables its control with a one-line explanation, and no request is sent | `npm test` (7 switch tests), `e2e-full` (e2e-22, demo URL flags) | pass |

## 12. Test commands

```bash
npm run check                                   # TypeScript, strict — 0 errors
npm test                                        # unit tests (node --test): extractor, engine attribution, feature switches, pending queue / merge, local-time formatting, base-URL guard, bootstrap env writer, video maths — no browser
npm run dev -- --port 5187 --strictPort         # dev server for the e2e scripts (5173 may be taken by another project)

node scripts/e2e-full.mjs --port 5187           # demo mode on a FRESH profile: 31 assertions — the loop, two F1 edge cases with canned replies, simulation labelling, the feature switches
node scripts/e2e-emulator.mjs                   # real SDK vs the local Emulator Suite: builds, boots and stops it itself (needs JAVA_HOME): 21 assertions
node scripts/e2e-ondevice.mjs --url http://127.0.0.1:5187   # real Gemini Nano only; exit 2 = honest skip when the model is absent
node scripts/ui-screens.mjs --port 5187         # screenshots + contrast / first-screen audit
node scripts/firebase-bootstrap.mjs --dry-run   # prints the project-bootstrap steps, touches nothing
```

- `e2e-ondevice.mjs` takes `--url` (default `http://127.0.0.1:5173`), not `--port`; it needs a Chrome profile that already has the on-device model (`--profile`).
- `e2e-full.mjs` blocks `*googleapis.com*` while it emulates being offline: Chrome's offline emulation fails simple requests at once but lets CORS preflights run, so the AI call would otherwise hang for the browser's connection timeout. Its two F1 edge cases (e2e-16/17) are driven with the SDK's cloud reply canned inside the browser; a canned reply can only ever lead to a rule-based or an "Engine unknown" record.
- `e2e-emulator.mjs` needs ports 4000, 5000, 8080 and 9099 free and refuses to start otherwise. Its last run, on 2026-11-25, was on a clean copy whose only difference was the Firestore emulator port (8090, because another service held 8080): 21 / 21.

- `e2e-ondevice.mjs` takes `--url` (default `http://127.0.0.1:5173`), not `--port`; it needs a Chrome profile that already has the on-device model (`--profile`).
- The e2e and screenshot scripts write their evidence (screenshots, `ondevice-proof.json`) to the sibling `tools/` directory, outside the repository.
- `e2e-full.mjs`, `e2e-walkthrough.mjs`, `ui-*.mjs` and `capture-video.mjs` refuse to run (exit 2) against a server that is not SiteScribe.
- Video pipeline (`make-vo.mjs`, `capture-video.mjs`, `assemble-video.mjs`) is documented in the README.

## 13. Known gaps — verified vs. never observed

**Verified in a running build** (2026-11-25 on the application code at commit `f7f7b22`, for the first three bullets; see README "Verified state"):

- The demo-mode loop and the fixes of that night: rule-based fallback, pending → synced, honest F2 / F3 behaviour offline, local-time stamps, both F1 edge cases, simulation labelling, the feature switches — `e2e-full` 31 / 31.
- The real Firebase SDK chain against the local Emulator Suite: anonymous auth, offline write queue, owner-only rules, PWA shell after an offline reload, and that the demo-only URL switches have no effect there — `e2e-emulator` 21 / 21, on a copy with the Firestore emulator port moved (§12).
- Contrast of every probed text / background pair — `ui-screens.mjs` 160 / 160 at 4.5 : 1 or above.
- On-device inference with the network cut, on real Gemini Nano — `e2e-ondevice` 2 / 2 on 2026-11-24. **Not re-run on 2026-11-25** (the machine stayed below the memory threshold set for that suite), so the 2026-11-25 change on the F1 path (`settleStructureReply()`) has not been exercised on a real device model.

**Never observed** — all of it blocked on the same thing: no Firebase project exists yet (no `.env`, no login, never deployed):

- Real cloud inference. `Cloud · Gemini` and `Fell back to cloud · Gemini` have only ever been seen as the labelled demo simulation.
- Production App Check attestation (reCAPTCHA or a registered debug token) end to end. Only the code path and the bootstrap script's `--dry-run` exist.
- The hosted URL, and a real Remote Config fetch (only the fallback to defaults was exercised). The switched-off state of the feature switches was exercised through the demo-only URL flags, not through Remote Config.
- That the first capture on a browser without the model is answered by the cloud once a project is wired up. Expected by design; in demo mode the rule-based fallback answers instead.

**Known defects — seen on 2026-11-25 and left unfixed** (outside the scope of that night):

- **The cloud model name never reaches the request.** `requireModel()` in `src/ai.ts` calls `getGenerativeModel(ai, { model: <cloud model>, mode })`; SDK 13.4.0 warns that with a hybrid `mode` a top-level `model` "cannot be configured at the top level … will be ignored", and calls its default `gemini-3.5-flash-lite` instead. Observed: the F1 request named `gemini-3.5-flash-lite`. The fix is to pass `inCloudParams: { model }`.
- **The first render waits for Remote Config.** `initFirebase()` awaits `fetchAndActivate()` before Firestore is set up and the UI renders, and the Installations registration that precedes the fetch is not covered by the 5 s fetch timeout. With Google's endpoints blackholed, the emulator-mode page stayed blank for 85 s. A device that is truly offline fails these requests at once (§10).
- **F2–F4 have no time budget.** On a network that hangs instead of refusing they stay on *thinking…* / *checking…* until the browser gives up — 84.5 s on 2026-11-25 (§9).
- **The model warm-up's closing line replaces the answer's badge in the status chip** after the first capture on a browser without the model (`On-device model unavailable`, …) — real telemetry, but not "the badge of the latest answer" (§6.3).
- **The severity-check button of the capture preview is not wired.** `refreshRecords()` attaches the handler to the buttons in *Records* only; the one on the card inside *Structured record* does nothing. (It is disabled like the others when F4 is switched off.)
- **The simulated report draft is not a report.** `simulatedAnswer()` tests for "structured defect record" before "inspection report", and the report prompt contains the former: with the simulation on, *Inspection report draft* shows a JSON record built from the prompt text instead of the placeholder. Badge and record are labelled "(simulated)".

**Read in the code only** — edge cases no test reaches:

- **A late reply overrides the status chip.** `ask()` emits the engine event inside the SDK call, so an F1 reply that arrives after the budget was already lost to the rules still updates the status chip and the log with the model's badge. The record itself stays rule-based.
- Records made under the demo simulation before commit `7c2731f` carry no stored flag: in a demo profile that still holds them they read `☁ cloud` without "(simulated)". Demo mode never writes to Firestore.
- Live mode, very first launch offline: anonymous sign-in needs one online round trip; until then nothing can be listed or saved.
- The README's browser prerequisite ("Chrome 139+, enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`") was written on an earlier night and has not been re-checked.

## 14. Repository layout

```
sitescribe/
├── index.html                  ← shell; the app mounts into #app
├── src/
│   ├── main.ts                 ← both views, badge rendering, boot sequence
│   ├── ai.ts                   ← AI Logic wrapper: routing, budgets, engine log, demo simulation
│   ├── extract.ts              ← rule-based extractor and JSON repair (pure)
│   ├── engine.ts               ← engine attribution: which engine produced a record's fields (pure)
│   ├── flags.ts                ← Remote Config feature switches: the gate decision and the demo URL override (pure)
│   ├── firebase.ts             ← demo / emulator / live bootstrap, Remote Config, App Check
│   ├── store.ts                ← localStorage / Firestore persistence, demo seeds
│   ├── format.ts               ← local-time formatting (pure)
│   ├── merge.ts                ← pending-queue logic (used); conflict merge (unit-tested, not wired into the UI)
│   ├── types.ts
│   └── styles.css
├── tests/                      ← unit tests (node --test)
├── scripts/                    ← e2e, screenshot, video and bootstrap scripts, on-device probes
├── docs/SPEC.md                ← this file
├── docs/screenshots/
├── firestore.rules · firestore.indexes.json · remoteconfig.template.json · firebase.json
├── vite.config.ts              ← build; generates the service-worker precache list
└── LICENSE                     ← Apache-2.0
```
