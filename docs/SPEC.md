# SiteScribe — Product Specification

> **Offline-first AI field inspection companion for civil engineers.**
> Capture structured defect records inside signal-dead structures (bridge undersides, tunnels, mountain aqueducts) — on-device Gemini Nano when you're offline or the data is sensitive, cloud Gemini when you're back online and need heavy lifting.

Built for the **Firebase #BuildHybridAI 2026 hackathon** (Web / Chrome platform).

> **Revision of 2026-11-25.** This revision replaces the 2026-11-20 description of a diagnostics-first screen with the product-first interface shipped on 2026-11-23/24. Every statement below was checked against the code at commit `5cc400c`. Section numbers 1–8 keep their meaning, so the references in the code (`SPEC §4`, `§5`, `§6`, `§8`) stay valid. [§13](#13-known-gaps--verified-vs-never-observed) separates what has been seen in a running build from what has only been read in the code.
>
> **Amended in the night of 2026-11-25**, after the audit that found the UI and the docs claiming a few things the code did not do: which engine a record is credited to (§5.1, §6.1), simulation labelling (§4.1, §4.2, §4.3, §6.2, §6.3, §6.5), the Remote Config feature switches (§4.2, §5, §7), test counts (§11, §12) and the list of known gaps (§13) were re-checked against the application code at commit `f7f7b22`.
>
> **Amended in the day of 2026-11-25**, which fixed the defects that night's §13 listed (commits `4e858b3` to `58bac03`): the cloud model now reaches the request (§5, §7); the first render does not wait for the network (§4.1, §7, §10); every call runs under a budget (§5, §6.1, §9); the severity button on the capture preview works (§4.2); an answer's badge keeps the status chip and a late reply changes nothing (§6.3, §6.4); the simulated report is a report (§6.5). These statements were re-checked against the application code at commit `58bac03`.
>
> **Amended in the night of 2026-11-26**, after the project was wired to a real Firebase project and deployed: the deployment's state and the two steps it still waits on (§7, §13); what the Projects panel says when the deployment has not enabled anonymous sign-in, and that it is redrawn when the sign-in fails (§4.1, §10); what every badge says when the cloud engine is not available on this project (§5, §6.1); test counts (§11, §12) and the readiness check (§12) — and, later that night, after anonymous sign-in had been switched on from the CLI and the hosted app had been seen in use (§7, §11.2, §13). These statements were re-checked against the application code at commit `c9aac06`.

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
   - *Left:* the hero — "Field inspections in dead zones, still structured." — with one call to action, **Open today's inspection →** (opens the first project, or starts a new one when there is none), and **Projects**: one card per project (name, structure type, record count, "since" date) plus **＋ New** (two browser prompts: name, then structure type `bridge` / `tunnel` / `hydraulic` / `other`). In emulator and live mode the panel needs the anonymous user, who is not waited for (§10): until that user exists it says "Signing in anonymously…", and a failed sign-in is stated there too — it never shows an empty list for a signed-in owner. What it states depends on the failure (`signin.ts`): a deployment that has not enabled anonymous sign-in is named as that — "This deployment has not enabled anonymous sign-in (CONFIGURATION_NOT_FOUND) — projects and records need it. The project's owner must turn it on: Firebase console → Authentication → Sign-in method → Anonymous → Enable. Reloading the page does not help until then." — while any other failure keeps "Could not sign in (…) … Check the connection and reload the page." **＋ New** is refused while there is no user to own the project, with the matching reason.
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
| **Capture defect** (hint: *on-device first · works offline*) | text area (placeholder "Type it like you'd talk: …"), **⚡ Capture** | F1 (§5). The result block *Structured record* shows the engine badge, the record card and a *Check severity vs reference* button — the same action as the button on each record in *Records* (F4); until 2026-11-25 the one on this card had no handler. The record is saved immediately — there is no separate confirm step — and the preview is replaced by the saved card. A failure prints "Capture failed: …". |
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
| F1 | **Note → structured defect record** (JSON) | Capture defect | `PREFER_ON_DEVICE` | the SDK falls back to cloud; if no model answers inside the budget (§9) or the reply is not usable JSON, the rule-based extractor produces the record, which is saved and badged as rule-based (§5.1). When the cloud engine is not available on this project, the badge says so (§6.1) |
| F2 | **Field Q&A**, single-turn | Ask SiteScribe | `PREFER_ON_DEVICE` | an honest text instead of an answer: "No engine reachable (offline, no device model)" when the call failed and the device is offline, "No engine reachable (no device model, and the cloud engine did not answer)" when it failed and the device is online (until 2026-11-27 both said "offline"), "No engine answered in time" when it ran out of its budget (§9), "No engine reachable (the cloud engine is not available on this project)" when the cloud refused for that reason; capture keeps working |
| F3 | **Report drafting** from the day's records | Draft report | `ONLY_IN_CLOUD` | offline no call is made; the badge says "Report drafting needs a connection (cloud task)". A call that runs out of its budget ends in "Report drafting timed out — the cloud engine did not answer in time", shown with the badge alone; a cloud engine that is not available on this project ends the same way in "Report drafting unavailable — the cloud engine is not available on this project"; any other failure is reported as "Report drafting failed: …" |
| F4 | **Severity cross-check** against a short indicative reference card (crack-width bands, exposed reinforcement, seepage/efflorescence) | Check severity vs reference | `PREFER_ON_DEVICE` | a rule-based cross-check against the same card — whether the call failed or ran out of its budget; its badge names the cause when the cloud engine is not available on this project |

The SDK offers four modes (`PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`, `ONLY_IN_CLOUD`, `PREFER_IN_CLOUD`); the app uses the two in the table. The cloud model named in Remote Config is passed to the SDK as `inCloudParams.model` of every request (`hybridModelParams()` in `src/engine.ts`) — the place SDK 13.4.0 reads it under a hybrid `mode`. Until 2026-11-25 it was passed as a top-level `model`, which the SDK ignores there, so every request went to the SDK's own default. F3 receives the records as a plain numbered list and is asked for clean Markdown. F3 and F4 can be switched off by Remote Config (§7); F1 and F2 cannot. Every call runs under a budget (§9) and emits exactly one engine event — for the answer the user gets.

### 5.1 The record and why its JSON keys are spelled out in the prompt

```
{ "component": string, "defectType": string, "quantity": string,
  "severity": "unknown" | "minor" | "moderate" | "severe", "notes": string }
```

The SDK's on-device path ignores `generationConfig` — it forwards only the prompt text — so `responseSchema` and `responseMimeType` cannot be relied on there. The structuring prompt therefore states the keys and the allowed severity values itself; the cloud path additionally enforces the schema.

A record is credited to the engine that produced its **fields**, never to the one that merely replied. So when a model answers but not with usable JSON — nothing that parses, not an object, no string `component` — the fields come from the rule-based extractor and the record says so everywhere: it is saved with `extractedBy: "rule_based"`, its chip reads `⚙ rule-based`, its badge `⚙ Rule-based (Gemini Nano replied, but not with usable JSON)` (`Gemini` for a cloud reply, `The engine` when the SDK did not say which), and its `notes` end with "[Gemini Nano replied, but its reply was not usable JSON — fields structured by rules]". The decision is `settleStructureReply()` in `src/engine.ts`, unit-tested and driven end to end by `e2e-full` (e2e-16). Until 2026-11-25 such a record carried the model's chip.

An F1 call emits exactly one engine event, for the badge that is true for the record (`structureWithinBudget()`), and a reply that arrives after the budget is dropped: it changes neither the status chip nor a record (§9).

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
| **Rule-based fallback** | grey (neutral) · `⚙ Rule-based fallback (no AI engine reachable)` | no usable model reply: the call threw, or outlived its budget | no model and no reachable cloud; a call that ran out of its budget on a hung network (e2e-23). When the cloud engine is not available on this project, the same grey badge names that cause instead (§6.1.1, e2e-24) |
| **Rule-based, reply unusable** | grey (neutral) · `⚙ Rule-based (… replied, but not with usable JSON)` | a model answered, but with text that could not be used; the fields are the rules' (§5.1) | edge case, driven by `e2e-full` with a canned reply |

† Never observed for real (§13): the real project answers every cloud call so far with the free-tier refusal. Only the labelled demo simulation (§6.5) has shown these two chips.

The engine is never inferred from the requested mode; it is read from the response. "Cloud" and "Fell back to cloud" differ in exactly one fact: whether that request preferred on-device. When the SDK answers without `inferenceSource` (the field is optional), the chip says `⏳ Engine unknown` rather than guessing, and the record is stored with `extractedBy: "unknown"` and shows `⏳ engine unknown` on its card — the model did produce the fields (`badgeFromSource()` and `recordEngine()` in `src/engine.ts`). The installed SDK (13.4.0) always sets the field, so this path is driven by `e2e-full` with the property hidden where the app reads it (e2e-17).

Other labels shown in the same chips:

| Label | Meaning |
|---|---|
| `⏳ Downloading on-device model · 42%` | progress callback of `initializeDeviceModel()` |
| `⚡ On-device model ready` | installed and preloaded: one tiny local inference succeeded |
| `⏳ On-device model available — the first request will load it` | installed, but the preload inference failed |
| `⚙ On-device model still downloading` / `⚙ On-device model not available` | after a warm-up attempt, when Chrome does not report the model as available |
| `⚙ No engine reachable (offline, no device model)` | F2 when its call failed and the device is offline |
| `⚙ No engine reachable (no device model, and the cloud engine did not answer)` | F2 when its call failed and the device is online. Until 2026-11-27 this case read "offline, no device model" too — on the hosted app, under an "online" chip, while the cloud call was being refused |
| `⚙ No engine answered in time` | F2 when its call ran out of its budget (§9) |
| `⚙ Report drafting needs a connection (cloud task)` | F3 while offline |
| `⚙ Report drafting timed out — the cloud engine did not answer in time` | F3 when its call ran out of its budget (§9) |
| `⚙ Report drafting unavailable — the cloud engine is not available on this project` | F3 when the cloud refused because the project cannot use the Gemini API (§6.1.1) |

"Ready" is never the app's own word: it is emitted only when Chrome reports `available` and the preload inference succeeds. Red is reserved for real failures and the offline indicator; the rule-based fallback is neutral grey on purpose.

#### 6.1.1 A cloud engine the project cannot use

Firebase AI Logic answers HTTP 403 with "The Gemini API free tier is not available for this project" when the Google account cannot use the free tier — the account's standing with Google, which neither a retry nor another connection changes (first seen on the real project on 2026-11-26; §13). The AI Logic SDK passes that sentence on in its error, `cloudNotAvailableOnProject()` in `src/engine.ts` reads it, and each feature names the cause instead of the "no engine reachable" wording that would send the reader after a connection that is fine:

| Feature | Badge | Elsewhere |
|---|---|---|
| F1 | `⚙ Rule-based fallback (the cloud engine is not available on this project)` | the status chip `Rule-based (cloud not available on this project)`; the record is rule-based, as for any failed call |
| F2 | `⚙ No engine reachable (the cloud engine is not available on this project)` | "No engine answered: there is no on-device model on this device, and the cloud engine is not available on this project. Defect capture still works: …" |
| F3 | `⚙ Report drafting unavailable — the cloud engine is not available on this project` | the badge alone — no report, no report buttons — as after a timed-out call |
| F4 | `⚙ Rule-based fallback (the cloud engine is not available on this project)` | the rule-based cross-check, ending "(Rule-based check — no AI engine answered.)" |

Nothing is faked here: no cloud badge appears, and every engine-log row of such a call carries the same words. Any other refusal — another 403 included — keeps its usual wording. `e2e-full` drives it with the real project's answer, byte for byte (e2e-24); against the code before 2026-11-26 those three assertions fail.

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
- After an answer: the badge of the latest answer, in its short form. A model-state line from the warm-up (`On-device model ready`, `On-device model loading`, `On-device model downloading`, `On-device model unavailable`) has the chip only until the first answer exists; once there is an answer, such a line goes to the engine log and the diagnostics alone — the answer's badge wins (`takesChip()` in `src/engine.ts`, unit-tested; until 2026-11-25 the warm-up's closing line pushed the first answer's badge off the chip on a browser without the model). Download progress is shown here only until the first answer exists.

### 6.4 Engine log

The session's engine events, held in memory (not persisted), newest first, at most 50 entries: local time · feature (`F1 structure`, `F2 field QA`, `F3 report`, `F4 severity check`, `system`) · badge. A model download is one rolling entry instead of one per progress tick. Every feature call leaves exactly one row — the badge that is true for the answer the user gets. So an F1 call whose reply turns out unusable leaves one row, `Rule-based (… replied, but not with usable JSON)` (§5.1), and a reply that arrives after its budget leaves none (§9).

### 6.5 Simulation of the cloud states (demo mode only)

`?engine=sim_cloud` or `?engine=sim_fallback` short-circuits the AI calls **only when the app runs in demo mode**: the answer text is produced locally and the badge reads `Cloud · Gemini (simulated)` or `Fell back to cloud · Gemini (simulated)`. The texts come from `src/sim.ts`, where each call is recognised by the marker that only its prompt has — the engineer's note for structuring, the record list for a report; until 2026-11-25 calls were recognised by phrases they share, and the "report" was a JSON record built from the prompt. What the calls get:

- structuring: the note structured by the rule-based extractor;
- Q&A and the severity check: the placeholder "(simulated cloud answer — demonstrated for the engine-badge UI state only)";
- report drafting: a short report-shaped text — the heading "## Simulated inspection report", the line "(simulated cloud output — no report was drafted; …)", the records it was given, and a follow-up that flags the severe and moderate ones by number and calls itself simulated.

Everything that reflects the simulated engine carries the label in its own text:

- the answer badges (F1–F4) and their rows in the engine log;
- record cards: a record made under the simulation is stored with `simulated: true`, its chip reads `cloud (simulated)`, and it goes on doing so after the simulation is switched off and in later sessions;
- the status chip: the simulated label before the first answer and after each one;
- the legend's two cloud chips, and the diagnostics summary (`simulation: cloud — badges say "(simulated)"`).

A banner ("Simulation is on…") sits directly under the top bar on **both** views, home and inspection session. The diagnostics facts show the simulation state, and `?engine=off` turns it off. In emulator and live mode the flag has no effect at all: nothing is simulated, and no banner and no simulation state is shown, because `engineSimulation()` reports the simulation that is in effect. Model-state lines and download progress are real telemetry and are never labelled.

`e2e-full` asserts each of these (e2e-18…21), that the simulated report is a report, and that a real run shows none of the labels; `e2e-emulator` asserts that the flag has no effect outside demo mode.

## 7. Firebase product map

| Product | Role in the shipped code | Status |
|---|---|---|
| **Firebase AI Logic** | `getGenerativeModel(ai, { mode, inCloudParams: { model: <cloud model> } })` for each call; `initializeDeviceModel(progress)`; `response.inferenceSource` drives the badge | on-device path proven with the network cut (last on 2026-11-25, after the capture path was restructured). Against the real project (2026-11-26) the cloud request reaches Gemini and is refused — HTTP 403, the free tier is unavailable for the builder's account — so no cloud answer has ever been seen; the refusal is what §6.1.1 describes (§13) |
| **Cloud model** | `gemini-3.8-flash` by default — `DEFAULT_CLOUD_MODEL` in `src/flags.ts`, used by `src/ai.ts` and `src/firebase.ts`; the same value in `remoteconfig.template.json`. Passed as `inCloudParams.model`, where SDK 13.4.0 reads it under a hybrid `mode` | asserted where it matters: the AI Logic request that the capture sends names `gemini-3.8-flash`, and the SDK no longer warns that the model is ignored (`e2e-emulator`). Until 2026-11-25 every request went to the SDK's own default, `gemini-3.5-flash-lite`. Named in the request the real project refused on 2026-11-26; no model has answered it yet |
| **App Check** | live mode only. localhost or no site key → debug provider (token printed to the console, or `VITE_APPCHECK_DEBUG_TOKEN`). A site key (`VITE_RECAPTCHA_SITE_KEY`) → reCAPTCHA attestation, v3 by default, Enterprise with `VITE_RECAPTCHA_PROVIDER=enterprise`. Auto-refresh on. **The hosted URL uses a registered debug token, and `VITE_APPCHECK_DEBUG_TOKEN` is baked into the public bundle** — anyone can exchange it, so it attests nothing about who is calling (§13) | the debug token exchanges for an App Check token (verified against the real project, 2026-11-26). That AI Logic accepts the attestation is **not** verified: while Gemini refuses the call, it refuses it with any token and with none. reCAPTCHA attestation was never exercised |
| **Authentication** | anonymous sign-in only; an offline cold start with a restored session skips the sign-in round trip. The sign-in is never awaited for the first render: the owner's data follows once the user exists (`authReady`), and its failure is stated in the Projects panel by its meaning (`signin.ts`, §4.1) | proven against the Auth emulator. Against the real project the sign-in failed with `auth/configuration-not-found` until 2026-11-26 03:08, when the anonymous provider was deployed from `firebase.json` (`firebase deploy --only auth`); the hosted app has signed in since (§13) |
| **Firestore** | `persistentLocalCache()` (IndexedDB); collections `projects` and `records`, both stamped with `owner`; rules allow owner-only read / update / delete and create only for one's own uid; listings read the local cache, never the server | proven against the Firestore emulator. The real project has a database, and the rules and indexes were deployed on 2026-11-26; a record captured on the hosted URL went from *pending sync* to *synced* there that night (03:10) |
| **Remote Config** | three keys with baked-in defaults: `cloud_model`, `feature_report_drafting`, `feature_severity_check`; fetch at most every 10 minutes. The fetch is never awaited for the first render: the app starts on the defaults, counts the fetch as settled after 5 s whatever the network does (`REMOTE_CONFIG_TIMEOUT_MS`), and applies values that arrive later — the cloud model from the next call on, the feature switches in place. The two feature keys are kill-switches (`featureGate()` in `src/flags.ts`): when one is `false` its feature is not offered — the control is disabled and one line under *Records* says why (`Report drafting is switched off by Remote Config — no request is sent.`; the key is in the disabled control's tooltip) — and no request is sent. Defaults stay `true` | until 2026-11-26 only the fallback to defaults was ever exercised: settled as `failed` after 1–2 s on this network, and as `timed-out` after 5.1 s with every request held (`e2e-emulator`). The switched-off state was exercised through the demo-only URL flags, not through Remote Config. Against the real project the fetch succeeded on 2026-11-26: settled as `no-change` after 1.9 s, with the defaults |
| **Hosting** | `firebase.json`: `dist/`, single-page rewrite, cache headers, `sw.js` served `no-cache` | deployed on 2026-11-26 (hosting, Firestore rules and indexes, Remote Config template), first at 02:15 and again at 03:08–03:09: `https://sitescribe-5998a.web.app/` answers HTTP 200 and serves the application code of commit `c9aac06`; the commits after it change scripts and documents only. Whether the cache headers reach the browser was not checked |

### 7.1 Running modes

| | Demo (default) | Emulator | Live |
|---|---|---|---|
| Entered when | no `VITE_FIREBASE_CONFIG` | `VITE_USE_EMULATOR=1` and no config | a `VITE_FIREBASE_CONFIG` containing an `apiKey` |
| Firebase app | placeholder config, so that AI Logic initialises locally | reserved project id `demo-sitescribe` | the real project |
| Runtime chip | `local demo` | `emulator` | `firebase live` |
| Auth, Firestore, Remote Config | not used | real SDKs against the local Emulator Suite (Auth 9099, Firestore 8080, hosting 5000) | real backend |
| App Check | not used | not used (the suite does not enforce it) | debug or reCAPTCHA provider |
| Data | `localStorage` (`sitescribe.v1`) | Firestore emulator + local cache | Firestore + IndexedDB cache |
| Demo seeds | yes — before the first render | yes — once the anonymous user exists, so a moment after the first render | no |
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

**Budgets.** Every call is raced against a timeout, so a network that hangs — neither answering nor failing — cannot hold the field loop. F1 uses `aiBudgetMs()`, F2–F4 `callBudgetMs()`: the budget F1 gets for any call after its first. Until 2026-11-25 only F1 had one, and F2–F4 waited for the browser itself to give up: 84.5 s.

| Chrome's answer for the on-device model | Call | Runtime | Budget |
|---|---|---|---|
| `available` | F1, first structuring call of the page session | any | **90 s** — it also loads the weights |
| `available` | any other call, F1–F4 | any | 45 s |
| anything else | F1 | demo or emulator | 12 s — no cloud backend exists there, so fail fast to the rules |
| anything else | F2–F4 | demo or emulator | 12 s |
| anything else | F1–F4 | live | 45 s — gives the cloud path time to answer |

When a budget runs out (`withinBudget()` in `src/engine.ts`, unit-tested): F1 and F4 fall back to the rules; F2 says "No engine answered in time"; F3 "Report drafting timed out" (§5). A reply that arrives after the budget is dropped — it changes neither the status chip nor a record that was already settled; it is only mentioned in the console. On a hung network in demo mode `e2e-full` measures about 12.3 s for each of the four (e2e-23).

## 10. Offline behaviour

| Action while offline | Model installed | No model |
|---|---|---|
| Capture | structured on-device; record *pending sync* | rule-based fallback as soon as the SDK's cloud fallback fails — at the latest when the budget (§9) runs out: 12 s in demo or emulator mode, 45 s in live mode |
| Ask SiteScribe | answered on-device | honest "no engine reachable" text — or "No engine answered in time" when the call ran out of its budget (§9) |
| Check severity | answered on-device | rule-based cross-check |
| Draft report | no call; badge "Report drafting needs a connection (cloud task)" | same |
| Connectivity changes | only the connectivity chip is updated; the view is not re-rendered, so a half-typed note survives | same |

- **Persistence.** Demo mode keeps everything in `localStorage`. Emulator and live mode use Firestore's offline persistence: writes made offline resolve locally and are sent when connectivity returns.
- **First render (emulator or live mode).** Nothing that needs the network is awaited: neither the anonymous sign-in nor the Remote Config fetch. The home view renders at once on the baked-in defaults; the Projects panel says "Signing in anonymously…" until the anonymous user exists, and states a failed sign-in — since 2026-11-26 it is also redrawn when the sign-in fails (until then it kept "Signing in anonymously…" for good), and it names a deployment that has not enabled anonymous sign-in as that (§4.1); the owner's projects and the demo seeds follow when the user is there. Remote Config counts as settled after 5 s whatever the network does, and values that arrive later are applied then (§7). Measured with every Firebase / Google request held — neither answered nor failed — on 2026-11-25: first render after 84 ms, Remote Config settled as `timed-out` after 5.1 s, and the seeded project appeared as soon as the sign-in was let through (`e2e-emulator`). Until that day both round trips were awaited, and where Google's endpoints hang the page stayed blank for 85 s.
- **Cold start offline (emulator or live mode).** With a restored anonymous session the app skips the sign-in round trip and renders from local persistence.
- **App shell.** A production build registers a service worker generated at build time: it precaches the shell, serves navigations network-first with the cached shell as fallback and same-origin assets cache-first, and never touches cross-origin (Firebase / Gemini) traffic.
- **Remote Config.** A failed fetch leaves the baked-in defaults in place.

## 11. Success criteria and acceptance criteria

### 11.1 Success criteria (hackathon lens)

- **Technological Implementation**: hybrid SDK imported and actually called at runtime; the on-device path proven with the network cut; engine badge reflects real `inferenceSource`.
- **Design**: complete loop — project → offline capture → sync → report — not a PoC screen; the first screen shows the product, not the diagnostics.
- **Potential Impact**: real audience (inspection engineers), real constraint (dead zones + data sensitivity), credible domain vocabulary.
- **Quality of Idea**: hybrid as architecture, not checkbox — the offline capture path is the product.

### 11.2 Acceptance criteria

"Last recorded result" is the verification run of 2026-11-26 on the application code at commit `c9aac06`, as recorded in the README "Verified state" and the progress report; rows last exercised on 2026-11-25 (on application code at `58bac03`) say so, and the emulator and on-device rows say how they were run. "code reading" means the criterion is visible in the source but asserted by no script.

| # | Criterion | Checked by | Last recorded result |
|---|---|---|---|
| A1 | The first screen (1280 × 800) holds the hero, Projects, the three steps, the legend and the collapsed diagnostics bar | `scripts/ui-screens.mjs` first-screen audit | pass |
| A2 | Diagnostics are collapsed by default; the engine log renders only with events | code reading | — |
| A3 | The home-screen example card is the rule-based extractor's real output | code reading | — |
| A4 | Typed capture only; no speech API anywhere in `src/` | code reading | — |
| A5 | The rule-based extractor takes the defect mentioned first; a tie keeps the more specific one | `npm test` | 139 / 139 unit tests |
| A6 | Record times are local with an explicit zone | `npm test` (7 format tests), `e2e-full` | pass |
| A7 | A connectivity change keeps a half-typed note | `e2e-full` | 41 / 41 |
| A8 | Demo mode: seeds are synced, an online capture is synced at once, an offline capture is pending, *Back in range* flips it | `e2e-full` | 41 / 41 |
| A9 | Demo and emulator mode fake no engine: badges read rule-based / no engine / needs a connection | `e2e-full`, `e2e-emulator` | pass |
| A10 | Real SDK chain: anonymous sign-in, an offline write is absent from the server and arrives after reconnect, the chip flips, rules reject cross-user access | `e2e-emulator` | 27 / 27 (2026-11-25, Firestore emulator port moved — §12) |
| A11 | The app renders after an offline hard reload and the records survive it | `e2e-emulator` | 27 / 27 |
| A12 | With the model installed and the network cut, the F1 and F2 badges come from `inferenceSource === "on_device"` | `e2e-ondevice` | 2 / 2 — four runs on 2026-11-25 (15:03, 19:18, 19:44, 19:49); the last three on the final capture path, the last with a clean tree |
| A13 | Every checked text / background pair is at least 4.5 : 1 | `ui-screens.mjs` | 160 / 160, minimum 5.7 : 1 |
| A14 | The first capture does not wait for the model download | manual probe, 2026-11-24 | observed; no automated assertion |
| A15 | Real cloud badge, real fell-back badge, production App Check | — | **never observed** (§13): the real project answers every cloud call with the free-tier refusal; the App Check debug token exchanges, but nothing shows yet that AI Logic accepts the attestation |
| A26 | A deployment that has not enabled anonymous sign-in is named as that in the Projects panel and in the ＋ New refusal; any other failed sign-in keeps the old advice; the panel is redrawn when the sign-in fails | `npm test` (7 sign-in tests); no e2e suite reaches it | pass — unit. Seen against the real project on 2026-11-26, while anonymous sign-in was still off (until 03:08): the panel read "This deployment has not enabled anonymous sign-in (CONFIGURATION_NOT_FOUND) …" |
| A27 | When the cloud engine is not available on this project, F1–F4 each name the cause; the record stays rule-based; the report is no report; no cloud badge appears | `npm test` (5 tests), `e2e-full` (e2e-24, the real project's HTTP 403 canned in) | pass — against the code of 2026-11-25 the three e2e assertions fail |
| A28 | One command says whether the hosted app is ready, and prints no key or token | `npm test` (18 readiness tests); `scripts/live-readiness.mjs` against the real project | pass — on 2026-11-26 after 03:08: 4 / 5 green, exit 1, the verdict names the one step still open (the Gemini API free tier) |
| A29 | Anonymous sign-in is declared in `firebase.json` and deployed with the rest; the bootstrap's anonymous check asks once more when the first answer told neither way | `npm test` (4 tests), `firebase-bootstrap.mjs --dry-run` | pass — on the real project `accounts:signUp` has answered 200 since 2026-11-26 03:08 |
| A16 | A record is credited to the engine that produced its fields: an unusable reply gives a rule-based record, a reply without `inferenceSource` gives `Engine unknown` / `unknown` | `npm test` (11 engine tests, 17 budget tests), `e2e-full` (e2e-16/17, canned replies) | pass |
| A17 | With the demo simulation on, every answer badge, legend chip, status chip, record card and log row says "(simulated)" and the banner is on both views; a real run shows none of it | `e2e-full` (e2e-18…21), `e2e-emulator` | pass |
| A18 | A feature switch set to `false` disables its control with a one-line explanation, and no request is sent | `npm test` (7 switch tests), `e2e-full` (e2e-22, demo URL flags) | pass |
| A19 | The configured cloud model reaches the request | `e2e-emulator` (the AI Logic request the capture sends) | pass — it names `gemini-3.8-flash`; the SDK no longer warns that the model is ignored |
| A20 | The first render does not wait for the network | `e2e-emulator` | pass — project card 347 ms after navigation; with every Firebase / Google request held: first render 84 ms, Remote Config settled as `timed-out` after 5.1 s, owner's data after the sign-in was let through. Seen again on 2026-11-26 on a local live-mode build against the real project: the page rendered while the sign-in failed |
| A21 | On a hung network F1–F4 each fall back within their budget to their own honest state | `npm test` (17 budget tests), `e2e-full` (e2e-23) | pass — F1 after 12.4 s, F4 + F2 + F3 together after 12.3 s (last run; 12.2–12.5 s across the day's runs) |
| A22 | The severity button on the capture preview answers like the ones in *Records* | `e2e-full` | pass |
| A23 | An answer's badge keeps the status chip when the warm-up's closing line follows | `npm test`, `e2e-full` | pass — the system row is in the log, the chip still shows the answer |
| A24 | A reply that arrives after the F1 budget changes neither the status chip nor a record nor the log | `npm test`, `e2e-full` (e2e-23: the hung request is answered with a canned model reply) | pass — against the previous code the same assertion fails |
| A25 | The simulated report draft is a report that says it is simulated, not a JSON record | `npm test` (6 tests), `e2e-full` | pass |

## 12. Test commands

```bash
npm run check                                   # TypeScript, strict — 0 errors
npm test                                        # unit tests (node --test): extractor, engine attribution, call budgets and late replies, what a cloud refusal and a refused sign-in mean, simulation texts, feature switches, pending queue / merge, local-time formatting, base-URL guard, bootstrap env writer, deploy targets and the sign-in probe, video maths, the readiness checks' decisions — no browser
VITE_FIREBASE_CONFIG= npm run dev -- --port 5187 --strictPort   # dev server in DEMO mode for the e2e scripts (5173 may be taken by another project; once a .env exists, its Firebase config must be blanked this way or the dev server comes up in live mode)

node scripts/e2e-full.mjs --port 5187           # demo mode on a FRESH profile: 41 assertions — the loop, two F1 edge cases with canned replies, simulation labelling, the feature switches, a hung network, a cloud engine the project cannot use
node scripts/live-readiness.mjs                   # the REAL project, no browser: CLI login, hosting URL and build, anonymous sign-in, Gemini through AI Logic; exit 0 only when all are green
node scripts/e2e-emulator.mjs                   # real SDK vs the local Emulator Suite: builds, boots and stops it itself (needs JAVA_HOME): 27 assertions
node scripts/e2e-ondevice.mjs --url http://127.0.0.1:5187   # real Gemini Nano only; exit 2 = honest skip when the model is absent
node scripts/ui-screens.mjs --port 5187         # screenshots + contrast / first-screen audit
node scripts/firebase-bootstrap.mjs --dry-run   # prints the project-bootstrap steps (the auth providers firebase.json declares included), touches nothing
```

- `e2e-ondevice.mjs` takes `--url` (default `http://127.0.0.1:5173`), not `--port`; it needs a Chrome profile that already has the on-device model (`--profile`).
- `e2e-full.mjs` blocks `*googleapis.com*` while it emulates being offline: Chrome's offline emulation fails simple requests at once but lets CORS preflights run, so the AI call would otherwise hang for the browser's connection timeout. Its two F1 edge cases (e2e-16/17) and its hung-network phase (e2e-23) are driven with the SDK's cloud request intercepted inside the browser — answered with a canned reply, or paused and never answered. A canned reply can only ever lead to a rule-based or an "Engine unknown" record there; it is never a cloud badge on a record.
- `e2e-emulator.mjs` needs ports 4000, 5000, 8080 and 9099 free and refuses to start otherwise. Its last run, on 2026-11-25, was on a clean copy whose only difference was the Firestore emulator port (8090, because another service held 8080): 27 / 27. Its held-network step pauses every request to the Firebase / Google hosts itself, so it does not depend on what the real network does with Google.
- The e2e and screenshot scripts write their evidence (screenshots, `ondevice-proof.json`) to the sibling `tools/` directory, outside the repository.
- `e2e-full.mjs`, `e2e-walkthrough.mjs`, `ui-*.mjs` and `capture-video.mjs` refuse to run (exit 2) against a server that is not SiteScribe.
- Video pipeline (`make-vo.mjs`, `capture-video.mjs`, `assemble-video.mjs`) is documented in the README.

## 13. Known gaps — verified vs. never observed

**Verified in a running build** — the rows without a date on 2026-11-25, on the application code at commit `58bac03`; the rows dated 2026-11-26 on the application code at commit `c9aac06` (see README "Verified state"):

- The demo-mode loop and every fix of 2026-11-25: rule-based fallback, pending → synced, honest F2 / F3 behaviour offline, local-time stamps, both F1 edge cases, simulation labelling, the feature switches, the preview's severity button, the status chip against the warm-up line, a late reply, the simulated report — `e2e-full` 38 / 38 that day, 41 / 41 with the 2026-11-26 row below.
- A hung network: every AI Logic request paused and never answered; F1 fell back after 12.4 s, F4 + F2 + F3 together after 12.3 s, each to its own honest state (`e2e-full`, e2e-23).
- The real Firebase SDK chain against the local Emulator Suite: anonymous auth, offline write queue, owner-only rules, PWA shell after an offline reload, that the demo-only URL switches have no effect there, that the AI Logic request names `gemini-3.8-flash`, and the first render with every Firebase / Google request held — `e2e-emulator` 27 / 27, on a copy with the Firestore emulator port moved (§12).
- Contrast of every probed text / background pair — `ui-screens.mjs` 160 / 160 at 4.5 : 1 or above.
- On-device inference with the network cut, on real Gemini Nano — `e2e-ondevice` 2 / 2, four times on 2026-11-25 (15:03, 19:18, 19:44, 19:49); the last three on the final capture path, the last with a clean tree.
- **2026-11-26, demo mode — a cloud engine the project cannot use.** The AI Logic request is answered with the bytes the real project sent (HTTP 403): every badge, the status chip and every engine-log row name the cause, the capture stays a rule-based record, the report is no report, and no cloud badge appears (`e2e-full`, e2e-24). Against the application code of the day before, the same three assertions fail.
- **2026-11-26, the real project, from Node** (`scripts/live-readiness.mjs`, runs between 02:35 and 03:03): the CLI is logged in; `https://sitescribe-5998a.web.app/` answers HTTP 200 and serves the build in `dist/`; `accounts:signUp` answered `CONFIGURATION_NOT_FOUND`, so anonymous sign-in was not enabled; the registered App Check debug token exchanges for an App Check token (about 0.5–0.6 s); the AI Logic request for `gemini-3.8-flash` is answered with HTTP 403 "The Gemini API free tier is not available for this project".
- **2026-11-26, the real project, in a browser** (a local live-mode build, headless Chrome, a fresh profile): the page rendered at once; the Remote Config fetch settled as `no-change` after 1.9 s, with the defaults; the sign-in failed with `auth/configuration-not-found`; the Projects panel read "This deployment has not enabled anonymous sign-in (CONFIGURATION_NOT_FOUND) — projects and records need it. …" and ＋ New was refused with the same reason — anonymous sign-in was still off then.
- **2026-11-26, 03:08 — anonymous sign-in switched on from the CLI.** `firebase.json` declares `auth.providers.anonymous` (commit `00259a8`); `firebase deploy --only auth` enabled the provider, and `accounts:signUp` has answered 200 since (the bootstrap's own probe, 03:14:00). The console's Authentication page was never opened for it.
- **2026-11-26, 03:09–03:10 — the hosted app in use.** On `https://sitescribe-5998a.web.app/`, in a fresh browser profile: the sign-in settled in 4 s → “No projects yet” → a project was created → a capture answered in 1.0 s with `⚙ Rule-based fallback (the cloud engine is not available on this project)` → `⏳ pending sync` → `✓ synced` after 6 s. The only failing request was the 403 of `generateContent`.
- **2026-11-27, 02:27–03:28 — the hosted app, every feature, plain Chrome** (five runs, a fresh profile each, no on-device model; harness `tools/night-2026-11-27/harness/hosted-smoke-f234.mjs`, logs under `tools/night-2026-11-27/hosted-smoke/`; the JSON of the first two runs was lost to a harness bug, their screenshots and console output were kept). In every run the sign-in settled → "No projects yet" → a project created through ＋ New → a capture, then Q&A, the severity check, report drafting and "↻ Back in range" (3.4 s after the page had loaded, in the two runs whose logs were kept). Sync: the record was `⏳ pending sync` and `✓ synced` 0.6–1.0 s later (Firestore's acknowledgement). The Gemini endpoint's answer changed during the night — HTTP 403 at 02:10 (per the handover note, not a log of this shift), requests that never got an answer (02:27–02:30, and Q&A's at 02:42), HTTP 500 "This model is currently experiencing high demand" (02:34–02:36, `live-readiness` included), and HTTP 429 "… per day limit exceeded on Free Tier", limit 20, from 02:37 on. What was on screen: the capture `⚙ Rule-based fallback (no AI engine reachable)` — in 0.9 s and 1.1 s in the two logged runs, in 19 s and 45 s in the two others; the severity check the same badge over the rule-based cross-check (0.5–0.6 s, and 45 s once); report drafting the red "Report drafting failed: … [429 ] You exceeded your current quota …" block with no badge (0.6–7.9 s; the 500 once; and, when the request hung, `⚙ Report drafting timed out — the cloud engine did not answer in time` after 45 s); Q&A `⚙ No engine answered in time` when its request hung (45.0 s), otherwise `⚙ No engine reachable (offline, no device model)` — the wrong cause, the device being online — which is fixed since (`e2e-full`, e2e-25, with the real 500 canned in). In the two logged runs: no uncaught error, no unhandled rejection, every spinner settled within its budget.

**The hosted deployment as of 2026-11-26** — how it is wired, and what that implies:

- **Hosting, Firestore rules and indexes, and the Remote Config template** were deployed with `firebase deploy` (`scripts/firebase-bootstrap.mjs`, `--existing-project`, then `--deploy-only`) at 02:15 and again at 03:08–03:09. The hosted URL serves the application code of commit `c9aac06` — the honest states of §4.1 and §6.1.1 included; the commits after it change scripts and documents only.
- **AI Logic uses the Gemini Developer API provider**, enabled through the CLI: `FIREBASE_CLI_EXPERIMENTS=ailogic firebase ailogic:providers:enable gemini-developer-api --project sitescribe-5998a`. The console's *AI Logic → Get started* does the same job. The project's AI Logic configuration had to exist before any call got past "Firebase AI Logic genai config not found".
- **App Check is a registered debug token, and it ships in the public bundle.** `VITE_APPCHECK_DEBUG_TOKEN` is read from `.env` at build time, so the token is in the JavaScript anyone can download, and anyone can exchange it for App Check tokens of this app. It shows that the provider is wired; it attests nothing about who is calling. The hackathon's rules accept debug tokens; Firebase's own documentation advises against a debug token in a production build. The alternative in the code — a reCAPTCHA site key as `VITE_RECAPTCHA_SITE_KEY` — has never been exercised.
- **Authentication is deployed from `firebase.json`.** `"auth": {"providers": {"anonymous": true}}` is declared there (commit `00259a8`), and `firebase deploy --only auth` switched the provider on at 03:08 — the [route Firebase documents](https://firebase.google.com/docs/auth/configure-providers-cli), which worked on a project whose Authentication page had never been opened, where the admin REST calls had answered `CONFIGURATION_NOT_FOUND`. Every deploy switches a declared provider back on if it was turned off in the console; to take it away for good, delete the entry first.
- **The Gemini API free tier may be unavailable for a Google account — and is for the builder's.** Every call is refused with the HTTP 403 above; a second, throw-away project under the same account was refused identically. The remedy is the owner's: verify a device at `https://aistudio.google.com/verify?project=sitescribe-5998a` (free), or link billing at `https://aistudio.google.com/billing`.
- **`node scripts/live-readiness.mjs`** reports all of the above in one command — no browser, no key or token in its output — and exits 0 only when everything is green.
- **Left in the project by the smoke of 03:09–03:10:** a few anonymous test users, and one test project owned by a since-deleted browser profile — invisible to anyone else.

**Never observed:**

- **A cloud answer.** `Cloud · Gemini` and `Fell back to cloud · Gemini` have only ever been seen as the labelled demo simulation. With the free tier unavailable, no real cloud call has got past the refusal.
- **That AI Logic accepts the app's App Check attestation.** The debug token exchanges, but while Gemini refuses the call, it refuses it alike with a valid App Check token, with a garbage one and with none at all (raw calls, 2026-11-26). Nothing distinguishes an accepted attestation from a missing one until Gemini answers.
- **The hosted app's other features with a model behind them.** Q&A, the severity check and report drafting were first clicked on the hosted URL on 2026-11-27 (above); each ended in its rule-based or "no engine" state. None has produced a model answer there, and neither has capture: only the refused cloud path and the rule-based fallback have been exercised on the hosted URL.
- **Remote Config values that differ from the defaults.** The real fetch returned the defaults (`no-change`); the switched-off state of the feature switches was exercised through the demo-only URL flags, not through Remote Config.
- **That the first capture on a browser without the model is answered by the cloud.** Expected by design; in demo mode the rule-based fallback answers instead, and on the real project the cloud call is refused.

**Known limitations, left as they are** (2026-11-26):

- **Live mode without an on-device model on a network that hangs:** each call waits its full budget — 45 s, the budget F1 always had in live mode — before it falls back (§9). In demo and emulator mode that budget is 12 s.
- **F1 and F4 do not say "timed out".** A call that ran out of its budget and a call that failed get the same badge, "Rule-based fallback (no AI engine reachable)"; only F2 and F3 have a badge of their own for a timed-out call. (F2's failure badge used to say "offline, no device model" for any failure other than the cloud refusal of §6.1.1; since 2026-11-27 it says "offline" only when the device is offline.)
- **F3's other failures leave no badge and no engine-log row.** A report call that fails for any reason other than a timeout or the free-tier refusal — the HTTP 429 and 500 the real project answered on 2026-11-27 included — is shown as the red block "Report drafting failed: …" with the SDK's error text, and nothing else: no chip, no row in the engine log (§6.4's "every feature call leaves exactly one row" does not hold for this path).
- **Live mode, first launch with Google unreachable:** the page renders at once (since 2026-11-25), but projects and records need the anonymous user. Until the sign-in gets through, the Projects panel says "Signing in anonymously…" and ＋ New is refused.
- **Before the first cloud call of a session, the legend and the status chip still expect a cloud engine that answers** — "Not installed on this device — the cloud engine answers instead." and `☁ Cloud engine · on-device optional`. The app cannot know otherwise until a call fails; from the first answer on, every badge and log row names the cause (§6.1.1).
- **The sign-in failure path is in no e2e suite.** It is unit-tested (`tests/signin.test.ts`) and was seen against the real project while anonymous sign-in was still off. It has not been reachable there since 03:08, and the Auth emulator answers every project, so `e2e-emulator` cannot produce it.
- **A declared provider is switched back on by every deploy:** turning Anonymous off in the console alone does not hold; its entry must go from `firebase.json` too.
- **`scripts/live-readiness.mjs` cannot produce reCAPTCHA attestation:** with `VITE_RECAPTCHA_SITE_KEY` set and no debug token it reports (d) as not probed. Its comparison of the hosted page with `dist/index.html` means something only when `dist/` is freshly built.
- Records made under the demo simulation before commit `7c2731f` carry no stored flag: in a demo profile that still holds them they read `☁ cloud` without "(simulated)". Demo mode never writes to Firestore.
- An unhandled promise rejection inside the Remote Config SDK (`Promise.all([getId(), getToken()])` of Firebase Installations) is reported in the console on an offline reload when the first, online Installations registration had failed. It is inside the SDKs, appeared before 2026-11-25 as well, and does not reach the UI.
- The README's browser prerequisite ("Chrome 139+, enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`") was written on an earlier night and has not been re-checked.

**Read in the code only** — edge cases no test reaches:

- Remote Config values that differ from the defaults, arriving after the first render: the cloud model switch (`setCloudModel()`) and the in-place update of the feature controls (`applyFeatureGates()`) are not exercised by any test — every fetch so far failed, was held, or returned the defaults.
- The readiness check's `GENAI_CONFIG_NOT_FOUND`, `APP_CHECK` and `NETWORK` outcomes are covered by unit tests with constructed answers only: on 2026-11-26 the real project produced `FREE_TIER_UNAVAILABLE` alone.

## 14. Repository layout

```
sitescribe/
├── index.html                  ← shell; the app mounts into #app
├── src/
│   ├── main.ts                 ← both views, badge rendering, boot sequence
│   ├── ai.ts                   ← AI Logic wrapper: routing, budgets, engine log, demo simulation
│   ├── extract.ts              ← rule-based extractor and JSON repair (pure)
│   ├── engine.ts               ← pure decisions: engine attribution, the status-chip rule, call budgets and late replies, the honest fallback answers
│   ├── signin.ts               ← what a failed anonymous sign-in means for the UI: the deployment's, or the network's (pure)
│   ├── sim.ts                  ← the demo simulation's texts: what each simulated call answers (pure)
│   ├── flags.ts                ← Remote Config feature switches and default cloud model: the gate decision and the demo URL override (pure)
│   ├── firebase.ts             ← demo / emulator / live bootstrap (first render never waits for the network), Remote Config, App Check
│   ├── store.ts                ← localStorage / Firestore persistence, demo seeds
│   ├── format.ts               ← local-time formatting (pure)
│   ├── merge.ts                ← pending-queue logic (used); conflict merge (unit-tested, not wired into the UI)
│   ├── types.ts
│   └── styles.css
├── tests/                      ← unit tests (node --test)
├── scripts/                    ← e2e, screenshot, video and bootstrap scripts, the live-readiness check, on-device probes
├── docs/SPEC.md                ← this file
├── docs/screenshots/
├── firestore.rules · firestore.indexes.json · remoteconfig.template.json · firebase.json   ← firebase.json also declares the auth providers that each deploy switches on
├── vite.config.ts              ← build; generates the service-worker precache list
└── LICENSE                     ← Apache-2.0
```
