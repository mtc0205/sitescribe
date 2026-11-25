/**
 * SiteScribe UI — single-page, vanilla TypeScript.
 * Every AI output renders next to an EngineBadge driven by real SDK telemetry.
 */
import { initFirebase, runtime, remoteToggles, authReady, getAuthState, onRemoteTogglesChange } from "./firebase";
import { structureNote, askFieldQuestion, draftReport, crossCheckSeverity, warmDeviceModel, deviceAvailability, onEngineUpdate, deviceApiAvailable, initEngineSimulationFromUrl, engineSimulation, getEngineLog } from "./ai";
import { store, seedIfEmpty, onStoreChange } from "./store";
import { ruleBasedStructure } from "./extract";
import { recordEngine, recordEngineLabel } from "./engine";
import { featureGate, type FeatureGate, type GatedFeature } from "./flags";
import { formatRecordTime, formatLogTime, localDateTime, zoneLabelNow } from "./format";
import type { AiAnswer, DefectRecord, EngineBadgeInfo, Project } from "./types";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app")!;

let activeProject: Project | null = null;
let deviceWarmed = false;
/** Chrome's answer for the on-device model; "unknown" until the first probe resolves. */
type DeviceState = "unknown" | "available" | "downloadable" | "downloading" | "unavailable" | "no-api";
let deviceState: DeviceState = "unknown";
/** Most recent engine event of this session (null until one happens). Download
 *  progress ticks are kept apart: they must not drown out the badge of the last
 *  answer while the model is still being fetched in the background. */
let lastEngineBadge: EngineBadgeInfo | null = null;
let downloadBadge: EngineBadgeInfo | null = null;

/** A real cloud backend is configured (a Firebase project, not the emulators). */
function cloudConfigured(): boolean {
  return runtime.mode === "live" && !runtime.emulator;
}

function runtimeLabel(): string {
  return runtime.mode === "live" ? (runtime.emulator ? "emulator" : "firebase live") : "local demo";
}

/** The Remote Config kill-switch for feature `f` (SPEC §7): offered, or switched off
 *  with the reason. Demo mode has no Remote Config — there the only way a switch is
 *  off is the demo URL flag, and the explanation says so. */
function gate(feature: GatedFeature): FeatureGate {
  const toggles = remoteToggles();
  return featureGate(
    { reportDrafting: toggles.featureReportDrafting, severityCheck: toggles.featureSeverityCheck },
    feature,
    runtime.mode === "demo" ? "the demo URL flag" : "Remote Config",
  );
}

/* ---------- engine badge rendering (SPEC §6) ---------- */

const ENGINE_ICON: Record<EngineBadgeInfo["engine"], string> = { on_device: "⚡", in_cloud: "☁", unavailable: "⚙", pending: "⏳", download: "⏳" };

function iconFor(badge: EngineBadgeInfo): string {
  return /model ready/i.test(badge.label) ? "⚡" : ENGINE_ICON[badge.engine];
}

/** Chip colour for a badge. Rule-based / no-engine is neutral on purpose: it is an honest
 *  fallback, not an error — red stays for real failures and the offline indicator. */
function chipClassFor(badge: EngineBadgeInfo): string {
  if (badge.engine === "on_device") return "chip device";
  if (badge.engine === "in_cloud") return badge.fellBack ? "chip fallback" : "chip cloud";
  if (badge.engine === "unavailable") return "chip neutral";
  if (badge.engine === "download") return "chip pending";
  return /model ready/i.test(badge.label) ? "chip device" : "chip pending";
}

function badgeHtml(badge: EngineBadgeInfo): string {
  return `<span class="${chipClassFor(badge)}">${iconFor(badge)} ${escapeHtml(badge.label)}</span>`;
}

/** Status chip for the top bar. Before any engine event it states, neutrally and truthfully,
 *  which engine is on duty — never "…" and never an error-looking "unavailable". */
function engineChipHtml(): string {
  const current = lastEngineBadge ?? downloadBadge;
  const sim = engineSimulation();
  let cls: string;
  let text: string;
  if (current) {
    cls = chipClassFor(current);
    text = `${iconFor(current)} ${current.short ?? current.label}`;
  } else if (sim !== "off") {
    // Simulation on (demo mode): every answer will be badged with this label,
    // so the chip says it before the first one too — never "rule-based".
    cls = sim === "cloud" ? "chip cloud" : "chip fallback";
    text = sim === "cloud" ? "☁ Cloud · Gemini (simulated)" : "↘ Fell back to cloud · Gemini (simulated)";
  } else if (deviceState === "available") {
    cls = "chip device";
    text = "⚡ On-device ready";
  } else if (cloudConfigured()) {
    cls = "chip cloud";
    text = "☁ Cloud engine · on-device optional";
  } else {
    cls = "chip neutral";
    text = "⚙ Rule-based structuring";
  }
  const title = current
    ? `Last engine event: ${current.label}. Every answer and record carries its own badge.`
    : "Which engine is on duty. Every answer and record carries its own badge.";
  return `<span id="engine-chip" class="engine-chip ${cls}" data-testid="engine-chip" title="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
}

/** (Re)place the top-bar engine chip with the current state. */
function updateEngineChip(): void {
  const chip = document.querySelector<HTMLElement>("#engine-chip");
  if (!chip) return;
  const tmp = document.createElement("template");
  tmp.innerHTML = engineChipHtml();
  chip.replaceWith(tmp.content.firstElementChild!);
}

function connChipHtml(): string {
  return navigator.onLine
    ? `<span class="chip online conn" data-testid="conn-chip">⇅ online</span>`
    : `<span class="chip offline conn" data-testid="conn-chip">✕ offline</span>`;
}

/**
 * Connectivity changed → update the status chip only. The whole view used to be
 * re-rendered here, which wiped a half-typed note or a pending answer the moment
 * the signal dropped under a deck — the exact moment this app exists for.
 */
function updateConnChip(): void {
  document.querySelectorAll<HTMLElement>(".chip.conn").forEach((el) => {
    el.className = `chip ${navigator.onLine ? "online" : "offline"} conn`;
    el.textContent = navigator.onLine ? "⇅ online" : "✕ offline";
  });
}

function answerBlock(title: string, answer: AiAnswer, extra = ""): string {
  return `<div class="ai-block"><div class="ai-head"><strong>${escapeHtml(title)}</strong>${badgeHtml(answer.badge)}</div><div class="ai-body">${extra || escapeHtml(answer.text)}</div></div>`;
}

/* ---------- app chrome ---------- */

function render(): void {
  if (!activeProject) renderHome();
  else renderSession();
  window.scrollTo(0, 0);
}

function topbarHtml(left: string, opts: { narrow?: boolean } = {}): string {
  return `<header class="topbar"><div class="topbar-in${opts.narrow ? " session-bar" : ""}">${left}<div class="status">${connChipHtml()}${engineChipHtml()}<span class="chip runtime">${escapeHtml(runtimeLabel())}</span></div></div></header>`;
}

/** The cloud-state simulation banner (SPEC §6.5) — on BOTH views, so no screen can carry
 *  a simulated badge without saying so. Rendered only while the simulation is in effect. */
function simBannerHtml(): string {
  if (engineSimulation() === "off") return "";
  return `<div class="sim-banner" role="status" data-testid="sim-banner"><strong>Simulation is on.</strong> Cloud badge states on this page are simulated to demonstrate the UI — no cloud model is running, and every simulated badge says “(simulated)”. <a href="?engine=off">Turn simulation off</a></div>`;
}

/* ---------- home ---------- */

/** The canonical example note — structured at render time by the real rule-based
 *  extractor, so what the home screen shows is what the fallback really produces. */
const EXAMPLE_NOTE = "Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long.";

function renderHome(): void {
  const example = ruleBasedStructure(EXAMPLE_NOTE);
  // The legend explains the four real states. While the simulation is on, its two
  // cloud chips carry the label as well, so no chip on the page names a cloud engine
  // without saying "(simulated)".
  const simTag = engineSimulation() === "off" ? "" : " (simulated)";
  app.innerHTML = `
    ${topbarHtml(`<div class="brand"><span class="logo">S</span> SiteScribe</div>`)}
    <main class="home">
      ${simBannerHtml()}
      <div class="home-grid">
        <div class="home-col">
          <section class="hero">
            <h1>Field inspections in dead zones,<br/><em>still structured.</em></h1>
            <p>Capture defects under the deck, inside the tunnel, up the valley. Gemini Nano runs <strong>on your device</strong> — no signal needed, nothing leaves it. Cloud Gemini drafts the report when you're back in range.</p>
            <div class="hero-cta"><button id="cta-open" class="primary">Open today's inspection →</button></div>
          </section>
          <section class="panel" id="projects">
            <div class="panel-head"><h2>Projects</h2><button id="new-project">＋ New</button></div>
            <div id="project-list" class="list"></div>
          </section>
        </div>
        <section class="panel flow" id="capture-flow" aria-labelledby="flow-title">
          <div class="panel-head"><h2 id="flow-title">From field note to structured record</h2><span class="hint">works offline</span></div>
          <ol class="steps">
            <li class="step">
              <span class="step-n" aria-hidden="true">1</span>
              <h3>Say it like you'd talk</h3>
              <blockquote class="note-bubble">“${escapeHtml(EXAMPLE_NOTE)}”</blockquote>
            </li>
            <li class="step">
              <span class="step-n" aria-hidden="true">2</span>
              <h3>Structured where you stand</h3>
              ${recordCardHtml({ ...example, severity: asSeverity(example.severity), notes: "", extractedBy: "rule_based" }, "", false, false)}
              <p class="step-note">Example structured by the built-in rule-based fallback. With Gemini Nano on-device or cloud Gemini the model fills the same fields — the chip on each record names the engine that ran.</p>
            </li>
            <li class="step">
              <span class="step-n" aria-hidden="true">3</span>
              <h3>Syncs when you're back in range</h3>
              <div class="sync-demo"><span class="chip pending">⏳ pending sync</span><span class="sync-arrow" aria-hidden="true">→</span><span class="chip online">✓ synced</span></div>
            </li>
          </ol>
        </section>
      </div>
      <section class="panel legend" id="badge-legend" aria-labelledby="legend-title">
        <h2 id="legend-title" class="legend-title">Every answer is badged with the engine that produced it</h2>
        <div class="badge-gallery">
          <div class="badge-cell"><span class="chip device">⚡ On-device · Gemini Nano</span><span class="badge-note" id="note-device">Gemini Nano on this device — works offline, nothing leaves it</span></div>
          <div class="badge-cell"><span class="chip cloud">☁ Cloud · Gemini${simTag}</span><span class="badge-note">report drafting, and capture where the on-device model isn't installed</span></div>
          <div class="badge-cell"><span class="chip fallback">↘ Fell back to cloud${simTag}</span><span class="badge-note">on-device was preferred but could not serve the request</span></div>
          <div class="badge-cell"><span class="chip neutral">⚙ Rule-based</span><span class="badge-note">no engine reachable — transparent keyword rules keep capture working</span></div>
        </div>
      </section>
      <details class="panel diagnostics" id="engine-panel">
        <summary><span class="diag-title">Engine &amp; diagnostics</span><span class="diag-summary" id="engine-summary">live telemetry</span></summary>
        <div class="diag-body">
          <div id="engine-facts" class="engine-facts"><span class="muted">probing…</span></div>
          <div class="sim-row">
            <span class="muted">Cloud-state simulation (UI demo only, always labelled):</span>
            <a class="sim-btn" href="?engine=off">off</a>
            <a class="sim-btn" href="?engine=sim_cloud">cloud</a>
            <a class="sim-btn" href="?engine=sim_fallback">fallback</a>
          </div>
          <div class="engine-log" id="engine-log" hidden>
            <div class="log-head">Engine log · <span id="log-count">0</span> event(s) · local time <span id="log-zone"></span></div>
            <div id="engine-log-list"></div>
          </div>
        </div>
      </details>
      <footer class="site-footer">
        <span>SiteScribe · built for Firebase #BuildHybridAI 2026 · Apache-2.0</span>
        <span class="muted">every engine badge is live SDK telemetry — never faked</span>
      </footer>
    </main>`;
  void refreshProjects();
  // The engine log is this session's event history: it lives in the ai module,
  // not in the DOM, so rebuild it whenever the home view is re-created.
  refreshEngineLog();
  void probeDevice();
  document.querySelector("#new-project")!.addEventListener("click", onNewProject);
  document.querySelector("#cta-open")?.addEventListener("click", () => {
    const first = document.querySelector<HTMLElement>("#project-list .card");
    if (first) first.click();
    else void onNewProject();
  });
}

/** Ask Chrome about the on-device model and reflect the answer everywhere it is shown. */
async function probeDevice(): Promise<void> {
  const availability = await deviceAvailability(); // null when the API is absent or throws
  deviceState =
    availability === "available" || availability === "downloadable" || availability === "downloading" || availability === "unavailable"
      ? availability
      : deviceApiAvailable()
        ? "unavailable"
        : "no-api";

  // Engine chip (only while no engine event has happened yet).
  if (!lastEngineBadge && !downloadBadge) updateEngineChip();
  updateDeviceUi();

  // Raw telemetry facts (kept verbatim — this is the diagnostics view).
  const facts = document.querySelector("#engine-facts");
  if (facts) {
    const sim = engineSimulation();
    const parts: string[] = [`runtime: <strong>${escapeHtml(runtimeLabel())}</strong>`];
    if (deviceState === "no-api") parts.push(`Prompt API: <strong>not exposed</strong>`);
    else {
      parts.push(`Prompt API: <strong>exposed</strong>`);
      parts.push(`on-device model: <strong>${escapeHtml(availability ?? "probe failed")}</strong>`);
    }
    parts.push(`simulation: <strong>${escapeHtml(sim)}</strong>`);
    if (sim !== "off") parts.push(`<span class="chip fallback">simulation: ${escapeHtml(sim)} · labels say “(simulated)”</span>`);
    facts.innerHTML = parts.map((p) => `<span class="fact">${p}</span>`).join("");
  }
}

/** The one-line summary shown on the collapsed diagnostics header. */
function renderDiagSummary(): void {
  const summary = document.querySelector("#engine-summary");
  if (!summary) return;
  const sim = engineSimulation();
  const n = getEngineLog().length;
  summary.textContent = `${diagSummary()}${sim !== "off" ? ` · simulation: ${sim} — badges say “(simulated)”` : ""}${n ? ` · ${n} engine event${n === 1 ? "" : "s"}` : ""}`;
}

/** The two places that describe the on-device model in words: the legend note on
 *  the home screen and the collapsed diagnostics summary. */
function updateDeviceUi(): void {
  const note = document.querySelector("#note-device");
  if (note) note.textContent = deviceNote();
  renderDiagSummary();
}

function downloadPct(): string {
  const p = downloadBadge?.downloadProgress;
  return p == null ? "…" : `${Math.round(p * 100)}%`;
}

function deviceNote(): string {
  switch (deviceState) {
    case "available":
      return "Installed — capture, Q&A and severity checks run on this device, offline.";
    case "downloadable":
      return "Optional — Chrome downloads the model on first use.";
    case "downloading":
      return `Downloading the on-device model · ${downloadPct()} — ${cloudConfigured() ? "the cloud engine answers until it is ready" : "notes are structured by the rule-based fallback until it is ready"}.`;
    case "no-api":
      return cloudConfigured() ? "Not supported in this browser — the cloud engine answers instead." : "Not supported in this browser — notes are structured by the rule-based fallback.";
    default:
      return cloudConfigured() ? "Not installed on this device — the cloud engine answers instead." : "Not installed on this device — notes are structured by the rule-based fallback.";
  }
}

function diagSummary(): string {
  switch (deviceState) {
    case "available":
      return "on-device model ready";
    case "downloadable":
      return "on-device model optional (downloads on first use)";
    case "downloading":
      return `on-device model downloading · ${downloadPct()}`;
    case "no-api":
      return "on-device model not supported in this browser";
    default:
      return "on-device model not installed";
  }
}

/** The engine log only exists once there is something to log. */
function refreshEngineLog(): void {
  const log = document.querySelector<HTMLElement>("#engine-log");
  if (!log) return;
  const entries = getEngineLog();
  log.hidden = entries.length === 0;
  const count = document.querySelector("#log-count");
  const zone = document.querySelector("#log-zone");
  const list = document.querySelector("#engine-log-list");
  if (count) count.textContent = String(entries.length);
  if (zone) zone.textContent = zoneLabelNow();
  if (list) {
    list.innerHTML = entries
      .map((e) => `<div class="log-row"><span class="log-time">${escapeHtml(formatLogTime(e.ts))}</span><code>${escapeHtml(e.feature)}</code>${badgeHtml(e.badge)}</div>`)
      .join("");
  }
  renderDiagSummary();
}

/** The Projects panel. In live and emulator mode it needs the anonymous user — who may still
 *  be signing in, because the first render never waits for the network (firebase.ts) — so
 *  it says that instead of pretending there are no projects. */
async function refreshProjects(): Promise<void> {
  const list = document.querySelector("#project-list");
  if (!list) return;
  const auth = getAuthState();
  if (auth.state === "pending") {
    list.innerHTML = `<div class="empty" data-testid="auth-state">Signing in anonymously…</div>`;
    return;
  }
  if (auth.state === "failed") {
    list.innerHTML = `<div class="empty" data-testid="auth-state">Could not sign in (${escapeHtml(auth.error.slice(0, 160))}) — projects and records need the anonymous sign-in. Check the connection and reload the page.</div>`;
    return;
  }
  const projects = await store.listProjects();
  if (!projects.length) {
    list.innerHTML = `<div class="empty">No projects yet — tap <strong>＋ New</strong> to inspect your first structure.</div>`;
    return;
  }
  const counts = await Promise.all(projects.map((p) => store.listRecords(p.id).then((r) => r.length)));
  list.innerHTML = projects.map((p, i) => {
    const since = localDateTime(p.createdAt).dateNum; // local calendar date, not the UTC slice
    return `<button class="card" data-id="${p.id}"><span class="card-title">${escapeHtml(p.name)} <span class="card-go" aria-hidden="true">→</span></span><span class="card-sub">${structureLabel(p.structureType)} · ${counts[i]} record${counts[i] === 1 ? "" : "s"} · since ${escapeHtml(since)}</span></button>`;
  }).join("");
  list.querySelectorAll(".card").forEach((el) =>
    el.addEventListener("click", () => {
      activeProject = projects.find((p) => p.id === (el as HTMLElement).dataset.id) ?? null;
      render();
    }));
}

function structureLabel(t: Project["structureType"]): string {
  return { bridge: "Bridge", tunnel: "Tunnel", hydraulic: "Hydraulic structure", other: "Structure" }[t];
}

async function onNewProject(): Promise<void> {
  // A project needs an owner. The sign-in is not awaited for the first render, so it may
  // still be under way — or have failed on an unreachable network.
  const auth = getAuthState();
  if (auth.state === "pending" || auth.state === "failed") {
    alert(auth.state === "pending" ? "Still signing in — try again in a moment." : "Not signed in: projects cannot be saved without the anonymous sign-in. Check the connection and reload the page.");
    return;
  }
  const name = prompt("Project name (e.g. Girder Bridge No.3):");
  if (!name) return;
  const type = (prompt("Structure type: bridge / tunnel / hydraulic / other:", "bridge") ?? "bridge").toLowerCase();
  const st = (["bridge", "tunnel", "hydraulic", "other"].includes(type) ? type : "other") as Project["structureType"];
  await store.createProject(name, st);
  await refreshProjects();
}

/* ---------- inspection session ---------- */

function renderSession(): void {
  const p = activeProject!;
  const report = gate("reportDrafting");
  const severity = gate("severityCheck");
  app.innerHTML = `
    ${topbarHtml(`<button id="back" class="ghost">← Projects</button>`, { narrow: true })}
    <main class="session">
      ${simBannerHtml()}
      <h1 class="session-title">${escapeHtml(p.name)} <span class="muted">· ${structureLabel(p.structureType)}</span></h1>

      <section class="panel" id="capture">
        <div class="panel-head"><h2>Capture defect</h2><span class="hint">on-device first · works offline</span></div>
        <textarea id="note" rows="3" placeholder="Type it like you'd talk: “Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long, seepage with white efflorescence nearby.”"></textarea>
        <div class="row">
          <button id="capture-btn" class="primary">⚡ Capture</button>
          <span id="capture-state" class="muted" aria-live="polite"></span>
        </div>
        <div id="capture-result"></div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>Records <span id="record-count" class="muted"></span></h2>
          <div class="row">
            <button id="sync-btn" class="ghost" title="Simulate returning to coverage (demo mode flips pending → synced)">↻ Back in range</button>
            <button id="report-btn" class="ghost"${report.offered ? "" : ` disabled title="${escapeHtml(report.detail)}"`}>☁ Draft report</button>
          </div>
        </div>
        ${report.offered ? "" : `<p class="muted flag-off" id="report-flag-off" data-testid="flag-off-report">${escapeHtml(report.explanation)}</p>`}
        ${severity.offered ? "" : `<p class="muted flag-off" id="severity-flag-off" data-testid="flag-off-severity">${escapeHtml(severity.explanation)}</p>`}
        <div id="record-list" class="list"></div>
        <div id="report-out"></div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Ask SiteScribe</h2><span class="hint">on-device first · single-turn</span></div>
        <div class="row">
          <input id="qa-input" placeholder="What does efflorescence usually indicate?" />
          <button id="qa-btn" class="primary">Ask</button>
        </div>
        <div id="qa-out"></div>
      </section>
    </main>`;

  document.querySelector("#back")!.addEventListener("click", () => { activeProject = null; render(); });

  // The FIRST user gesture warms/downloads the on-device model (Chrome
  // requires user activation before LanguageModel.create()).
  document.querySelector("#capture-btn")!.addEventListener("click", onCapture);
  document.querySelector("#qa-btn")!.addEventListener("click", onAsk);
  document.querySelector("#qa-input")!.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") onAsk(); });
  document.querySelector("#sync-btn")!.addEventListener("click", onBackInRange);
  document.querySelector("#report-btn")!.addEventListener("click", onDraftReport);

  void refreshRecords();
}

/** Bring Remote Config switches that arrived AFTER the session view was built (the fetch
 *  is not awaited for the first render, see firebase.ts) to that existing view. The
 *  templates apply the switches at build time; this does it in place — never by
 *  re-rendering, a half-typed note must survive. */
function applyFeatureGates(): void {
  if (!activeProject) return;
  const report = gate("reportDrafting");
  const severity = gate("severityCheck");
  const reportBtn = document.querySelector<HTMLButtonElement>("#report-btn");
  if (reportBtn) {
    reportBtn.disabled = !report.offered;
    reportBtn.title = report.offered ? "" : report.detail;
  }
  document.querySelectorAll<HTMLButtonElement>(".check-btn").forEach((b) => {
    b.disabled = !severity.offered;
    b.title = severity.offered ? "" : severity.detail;
  });
  setSwitchLine("report-flag-off", report);
  setSwitchLine("severity-flag-off", severity);
}

/** The one-line explanation under the Records header for a switched-off feature — or
 *  nothing when the feature is offered. */
function setSwitchLine(testId: "report-flag-off" | "severity-flag-off", g: FeatureGate): void {
  let el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (g.offered) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("p");
    el.className = "muted flag-off";
    el.id = testId;
    el.setAttribute("data-testid", testId);
    document.querySelector("#record-list")?.before(el);
  }
  el.textContent = g.explanation;
}

onRemoteTogglesChange(() => applyFeatureGates());

async function ensureWarm(): Promise<void> {
  if (deviceWarmed) return;
  deviceWarmed = true; // only try once per session
  let availability: string | null = null;
  try {
    availability = await deviceAvailability();
  } catch {
    availability = null;
  }
  if (availability === "available") {
    // Installed: load the weights now so this very capture is served on-device.
    try {
      await warmDeviceModel();
    } catch (e) {
      console.warn("[ai] device model warm-up failed:", e);
    }
  } else {
    // Not installed: start Chrome's download under this user gesture, but do
    // NOT hold the capture hostage to it. Until 2026-11-24 the first capture
    // waited for the whole multi-GB download with nothing on screen but a
    // progress chip (measured: 25 s and 33 % on a fast line, no record yet).
    // The SDK uses the cloud (or the labelled fallback) until the model is
    // ready, and the badge on each answer keeps saying which one ran.
    void warmDeviceModel().catch((e: unknown) => console.warn("[ai] device model warm-up failed:", e));
  }
  // Ask Chrome again rather than assume the warm-up installed anything.
  void probeDevice();
}

function asSeverity(s: string): DefectRecord["severity"] {
  return (["unknown", "minor", "moderate", "severe"].includes(s) ? s : "unknown") as DefectRecord["severity"];
}

async function onCapture(): Promise<void> {
  await ensureWarm();
  const noteEl = document.querySelector<HTMLTextAreaElement>("#note")!;
  const note = noteEl.value.trim();
  const stateEl = document.querySelector<HTMLSpanElement>("#capture-state")!;
  const out = document.querySelector<HTMLDivElement>("#capture-result")!;
  if (!note) return;
  stateEl.textContent = "structuring…";
  out.innerHTML = "";
  try {
    const { record, answer } = await structureNote(note);
    stateEl.textContent = "";
    // Which engine produced the fields — taken from the badge, i.e. from what
    // the SDK said: that engine, "unknown" when it did not say, "rule_based"
    // when the rules structured the note (engine.ts).
    const engineOf = recordEngine(answer.badge);
    // A record made under the demo simulation (SPEC §6.5) outlives it: the engine in
    // `engineOf` never ran, so from here on the record keeps its "(simulated)" label.
    const simulated = engineSimulation() !== "off";
    const fields = { component: record.component || "(unspecified)", defectType: record.defectType || "(unspecified)", quantity: record.quantity || "(unspecified)", severity: asSeverity(record.severity), notes: record.notes };
    out.innerHTML = answerBlock("Structured record", answer, recordCardHtml({ ...fields, extractedBy: engineOf, simulated }, note, false, true));
    // Save it (pending sync when offline — the honest state).
    const saved = await store.addRecord({
      projectId: activeProject!.id,
      createdAt: new Date().toISOString(),
      rawNote: note,
      ...fields,
      extractedBy: engineOf,
      ...(simulated ? { simulated: true } : {}),
      syncState: navigator.onLine ? "synced" : "pending",
    });
    noteEl.value = "";
    // Swap the preview card for the saved one (now with sync state).
    out.querySelector(".ai-body")!.innerHTML = recordCardHtml(saved, note, false, true);
    void refreshRecords();
  } catch (e) {
    stateEl.textContent = "";
    out.innerHTML = `<div class="ai-block error">Capture failed: ${escapeHtml(String(e))}</div>`;
  }
}

interface RecordCardData {
  component: string;
  defectType: string;
  quantity: string;
  severity: DefectRecord["severity"];
  notes: string;
  createdAt?: string;
  extractedBy?: DefectRecord["extractedBy"];
  simulated?: boolean;
  syncState?: DefectRecord["syncState"];
}

/** The engine chip of a record card. `simulated` records (made under the demo simulation)
 *  carry "(simulated)" in the label itself, for as long as the record exists. */
function engineTagHtml(r: Pick<RecordCardData, "extractedBy" | "simulated">): string {
  if (!r.extractedBy) return "";
  const cls = r.extractedBy === "on_device" ? "device" : r.extractedBy === "in_cloud" ? "cloud" : r.extractedBy === "unknown" ? "unknown" : "neutral";
  return `<span class="chip ${cls}" data-testid="record-engine">${escapeHtml(recordEngineLabel(r.extractedBy, r.simulated))}</span>`;
}

/** The severity cross-check control of a record card. Switched off by Remote Config →
 *  the button is disabled, its tooltip carries the line and the switch's key; the
 *  visible one-line explanation sits under the Records header (SPEC §7). */
function recordActionsHtml(): string {
  const g = gate("severityCheck");
  return `<div class="row record-actions"><button class="ghost check-btn"${g.offered ? "" : ` disabled title="${escapeHtml(g.detail)}"`}>Check severity vs reference</button><span class="check-out" aria-live="polite"></span></div>`;
}

/** One structured record. Built from joined lines (no stray whitespace) and the CSS resets
 *  `white-space`, so a card inside the pre-wrap answer block has no phantom blank rows. */
function recordCardHtml(r: RecordCardData, _rawNote: string, showSync = true, withActions = false): string {
  const sev = { unknown: "not assessed", minor: "minor", moderate: "moderate", severe: "severe" }[r.severity];
  const title = r.defectType ? r.defectType.charAt(0).toUpperCase() + r.defectType.slice(1) : "(unspecified)";
  const sync = showSync ? (r.syncState === "pending" ? `<span class="chip pending">⏳ pending sync</span>` : `<span class="chip online">✓ synced</span>`) : "";
  const time = r.createdAt
    ? `<span class="record-time" data-testid="record-time" title="Captured ${escapeHtml(r.createdAt)} — shown in your local time zone">${escapeHtml(formatRecordTime(r.createdAt))}</span>`
    : "";
  return [
    `<div class="record sev-${r.severity}">`,
    `<div class="record-head"><span class="sev-dot" aria-hidden="true"></span><strong>${escapeHtml(title)}</strong><span class="record-component">${escapeHtml(r.component)}</span><span class="record-chips">${engineTagHtml(r)}${sync}</span></div>`,
    `<div class="record-meta"><span>${escapeHtml(r.quantity)}</span><span>severity: ${sev}</span>${time}</div>`,
    r.notes ? `<div class="record-notes">${escapeHtml(r.notes)}</div>` : "",
    withActions ? recordActionsHtml() : "",
    `</div>`,
  ].join("");
}

async function refreshRecords(): Promise<void> {
  if (!activeProject) return;
  const records = await store.listRecords(activeProject.id);
  const list = document.querySelector("#record-list");
  if (!list) return;
  document.querySelector("#record-count")!.textContent = `(${records.length})`;
  list.innerHTML = records.length
    ? records.map((r) => recordCardHtml(r, r.rawNote, true, true)).join("")
    : `<div class="empty">No records yet — type a field note above and hit <strong>⚡ Capture</strong>. It works offline; records sync when you're back in range.</div>`;

  // Wire severity cross-check buttons (F4, on-device).
  list.querySelectorAll(".record").forEach((el, i) => {
    const btn = el.querySelector(".check-btn") as HTMLButtonElement | null;
    if (!btn) return;
    const rec = records[i];
    btn.addEventListener("click", async () => {
      // Switched off by Remote Config: the button is disabled anyway — and no request leaves.
      if (!gate("severityCheck").offered) return;
      const out = el.querySelector(".check-out") as HTMLElement;
      out.textContent = "checking…";
      try {
        const answer = await crossCheckSeverity(rec);
        out.innerHTML = badgeHtml(answer.badge) + `<div class="check-text">${escapeHtml(answer.text)}</div>`;
      } catch (e) {
        out.textContent = `failed: ${String(e)}`;
      }
    });
  });
}

async function onAsk(): Promise<void> {
  await ensureWarm();
  const input = document.querySelector<HTMLInputElement>("#qa-input")!;
  const out = document.querySelector<HTMLDivElement>("#qa-out")!;
  const q = input.value.trim();
  if (!q) return;
  out.innerHTML = `<div class="muted">thinking…</div>`;
  try {
    const answer = await askFieldQuestion(q);
    out.innerHTML = answerBlock("Answer", answer);
    input.value = "";
  } catch (e) {
    out.innerHTML = `<div class="ai-block error">Failed: ${escapeHtml(String(e))}</div>`;
  }
}

async function onBackInRange(): Promise<void> {
  if (!activeProject) return;
  const btn = document.querySelector("#sync-btn")!;
  if (runtime.mode === "live") {
    btn.textContent = "↻ Back in range…";
    const n = await store.ackPending(activeProject.id);
    btn.textContent = `↻ Back in range (${n} synced)`;
    setTimeout(() => (btn.textContent = "↻ Back in range"), 2500);
    void refreshRecords();
    return;
  }
  const n = await store.syncPending(activeProject.id);
  btn.textContent = `↻ Back in range (${n} synced)`;
  setTimeout(() => (btn.textContent = "↻ Back in range"), 2500);
  void refreshRecords();
}

async function onDraftReport(): Promise<void> {
  // Switched off by Remote Config: the button is disabled anyway — and no request leaves.
  if (!activeProject || !gate("reportDrafting").offered) return;
  const out = document.querySelector("#report-out")!;
  const records = await store.listRecords(activeProject.id);
  if (!records.length) {
    out.innerHTML = `<div class="empty">Capture some records first.</div>`;
    return;
  }
  out.innerHTML = `<div class="muted">drafting in cloud…</div>`;
  try {
    const answer = await draftReport(records);
    if (!answer.text) {
      out.innerHTML = answerBlock("Inspection report draft", answer);
      return;
    }
    out.innerHTML =
      answerBlock("Inspection report draft", answer, `<pre class="report">${escapeHtml(answer.text)}</pre>`) +
      `<div class="row report-actions">
         <button id="copy-md" class="ghost">Copy Markdown</button>
         <button id="print-md" class="ghost">Print / PDF</button>
         <span id="copy-state" class="muted"></span>
       </div>`;
    out.querySelector("#copy-md")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(answer.text);
        const st = out.querySelector("#copy-state")!;
        st.textContent = "copied ✓";
        setTimeout(() => (st.textContent = ""), 2000);
      } catch (e) {
        out.querySelector("#copy-state")!.textContent = `copy failed: ${String(e)}`;
      }
    });
    out.querySelector("#print-md")?.addEventListener("click", () => window.print());
  } catch (e) {
    out.innerHTML = `<div class="ai-block error">Report drafting failed: ${escapeHtml(String(e))}</div>`;
  }
}

/* ---------- global engine chip ---------- */

// When Firestore acks an offline write (pending → synced), refresh the list.
onStoreChange(() => {
  if (activeProject) void refreshRecords();
});

onEngineUpdate((badge) => {
  if (badge.engine === "download") {
    // Background download: remember the latest tick, never replace the badge of
    // the last answer with it, and never fill the status bar with progress.
    downloadBadge = badge;
    deviceState = "downloading";
  } else {
    lastEngineBadge = badge;
    downloadBadge = null;
  }
  updateEngineChip();
  updateDeviceUi();
  refreshEngineLog();
});

window.addEventListener("online", updateConnChip);
window.addEventListener("offline", updateConnChip);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/* ---------- boot ---------- */

(async () => {
  initEngineSimulationFromUrl();
  // Never waits for the network: the anonymous sign-in and the Remote Config fetch
  // run on in the background (firebase.ts).
  await initFirebase();
  if (runtime.mode === "demo") await seedIfEmpty(); // localStorage: instant
  render(); // the home view, on the default switches
  // Live and emulator mode: the demo seeds and the owner's projects need the
  // anonymous user. They follow as soon as that user exists — typically within
  // a moment, and whatever the network does.
  if (runtime.mode !== "demo") {
    void authReady.then(async () => {
      await seedIfEmpty();
      if (!activeProject) await refreshProjects();
      // A sign-in failure is stated in the Projects panel (refreshProjects).
    }, () => {});
  }
  // Preload an already-installed on-device model so the first capture does not
  // wait for the weights to load. This never starts a download — that still
  // needs the user's click (see ensureWarm).
  if ((await deviceAvailability()) === "available") void ensureWarm();
  // PWA shell: register the service worker (production builds only — the SW
  // precaches the app shell so a cold start still renders offline; it never
  // caches cross-origin Firebase/Gemini API traffic).
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    const reg = () => navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("[sw] registration failed:", e));
    // The load event may already have fired while Firebase was initializing.
    if (document.readyState === "complete") void reg();
    else window.addEventListener("load", () => void reg());
  }
})();
