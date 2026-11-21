/**
 * SiteScribe UI — single-page, vanilla TypeScript.
 * Every AI output renders next to an EngineBadge driven by real SDK telemetry.
 */
import { initFirebase, runtime } from "./firebase";
import { structureNote, askFieldQuestion, draftReport, crossCheckSeverity, warmDeviceModel, onEngineUpdate, deviceApiAvailable, initEngineSimulationFromUrl, engineSimulation, getEngineLog } from "./ai";
import { store, seedIfEmpty } from "./store";
import type { AiAnswer, DefectRecord, EngineBadgeInfo, Project } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;

let activeProject: Project | null = null;
let deviceWarmed = false;

/* ---------- engine badge rendering (SPEC §6) ---------- */

function badgeHtml(badge: EngineBadgeInfo): string {
  const cls =
    badge.engine === "on_device" ? "chip device" :
    badge.engine === "in_cloud" ? (badge.fellBack ? "chip fallback" : "chip cloud") :
    badge.engine === "unavailable" ? "chip unavailable" : "chip pending";
  const icon = badge.engine === "on_device" ? "⚡" : badge.engine === "in_cloud" ? "☁" : badge.engine === "unavailable" ? "⊘" : "⏳";
  return `<span class="${cls}">${icon} ${escapeHtml(badge.label)}</span>`;
}

function answerBlock(title: string, answer: AiAnswer, extra = ""): string {
  return `
    <div class="ai-block">
      <div class="ai-head"><strong>${escapeHtml(title)}</strong> ${badgeHtml(answer.badge)}</div>
      <div class="ai-body">${extra || escapeHtml(answer.text)}</div>
    </div>`;
}

/* ---------- app chrome ---------- */

function render(): void {
  if (!activeProject) renderHome();
  else renderSession();
}

function renderHome(): void {
  app.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="logo">S</span> SiteScribe</div>
      <div class="status">
        <span class="chip ${navigator.onLine ? "online" : "offline"}">${navigator.onLine ? "⇅ online" : "✕ offline"}</span>
        <span id="engine-chip" class="chip pending">…</span>
        <span class="chip">${runtime.mode === "live" ? (runtime.emulator ? "emulator" : "firebase live") : "local demo"}</span>
      </div>
    </header>
    <main>
      <section class="hero">
        <h1>Field inspections in dead zones,<br/><em>still structured.</em></h1>
        <p>Dictate defects under the deck, inside the tunnel, up the valley. Gemini Nano runs <strong>on your device</strong> — no signal needed, nothing leaves it. Heavy report drafting happens in the cloud when you're back in range.</p>
        ${deviceApiAvailable() ? "" : `<p class="warn">This browser does not expose the Chrome on-device model API — engine badge will report cloud/fallback honestly.</p>`}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Projects</h2><button id="new-project">＋ New</button></div>
        <div id="project-list" class="list"></div>
      </section>
      <section class="panel" id="engine-panel">
        <div class="panel-head"><h2>Engine &amp; routing</h2><span class="hint">honest telemetry · never faked</span></div>
        <div id="engine-facts" class="engine-facts"><span class="muted">probing…</span></div>
        <div class="badge-gallery">
          <div class="badge-cell"><span class="chip device">⚡ On-device · Gemini Nano</span><span class="badge-note" id="note-device">Chrome built-in model</span></div>
          <div class="badge-cell"><span class="chip cloud">☁ Cloud · Gemini</span><span class="badge-note" id="note-cloud">cloud task / routing</span></div>
          <div class="badge-cell"><span class="chip fallback">↘ Fell back to cloud</span><span class="badge-note" id="note-fallback">device model unavailable</span></div>
          <div class="badge-cell"><span class="chip unavailable">⊘ Rule-based</span><span class="badge-note" id="note-unavailable">no engine reachable (offline)</span></div>
        </div>
        <div class="sim-row">
          <span class="muted">Cloud-state simulation (UI demo only, always labelled):</span>
          <a href="?engine=off">off</a> · <a href="?engine=sim_cloud">cloud</a> · <a href="?engine=sim_fallback">fallback</a>
        </div>
        <details class="engine-log">
          <summary>Engine log (<span id="log-count">0</span>)</summary>
          <div id="engine-log-list"></div>
        </details>
      </section>
    </main>`;
  void refreshProjects();
  void refreshEnginePanel();
  document.querySelector("#new-project")!.addEventListener("click", onNewProject);
}

/** Fill the Engine & routing panel with live facts (never invented). */
async function refreshEnginePanel(): Promise<void> {
  const facts = document.querySelector("#engine-facts");
  if (!facts) return;
  const sim = engineSimulation();
  const parts: string[] = [];
  parts.push(`runtime: <strong>${runtime.mode === "live" ? (runtime.emulator ? "emulator" : "firebase live") : "local demo"}</strong>`);
  if ("LanguageModel" in self) {
    parts.push(`Prompt API: <strong>exposed</strong>`);
    try {
      const av = await (self as unknown as { LanguageModel: { availability(): Promise<string> } }).LanguageModel.availability();
      parts.push(`on-device model: <strong>${escapeHtml(av)}</strong>`);
      const nd = document.querySelector("#note-device");
      if (nd) nd.textContent = av === "available" ? "READY — will serve F1/F2/F4" : av === "downloadable" ? "downloadable (first capture warms it)" : `${av} on this machine`;
    } catch (e) {
      parts.push(`on-device model: <strong>probe failed</strong>`);
    }
  } else {
    parts.push(`Prompt API: <strong>not exposed</strong> (badge reports cloud/fallback honestly)`);
  }
  if (sim !== "off") parts.push(`<span class="chip fallback">simulation: ${sim} · labels say “(simulated)”</span>`);
  else parts.push(`simulation: off`);
  facts.innerHTML = parts.map((p) => `<span class="fact">${p}</span>`).join(" ");
  refreshEngineLog();
}

function refreshEngineLog(): void {
  const list = document.querySelector("#engine-log-list");
  const count = document.querySelector("#log-count");
  if (!list) return;
  const entries = getEngineLog();
  if (count) count.textContent = String(entries.length);
  list.innerHTML = entries.length
    ? entries.map((e) => `<div class="log-row"><span class="muted">${escapeHtml(e.ts.slice(11, 19))}</span> <code>${escapeHtml(e.feature)}</code> ${badgeHtml(e.badge)}</div>`).join("")
    : `<div class="empty">No engine events yet — capture a defect or ask a question.</div>`;
}

async function refreshProjects(): Promise<void> {
  const projects = await store.listProjects();
  const list = document.querySelector("#project-list")!;
  list.innerHTML = projects.length
    ? projects.map((p) => `
        <button class="card" data-id="${p.id}">
          <div class="card-title">${escapeHtml(p.name)}</div>
          <div class="card-sub">${structureLabel(p.structureType)}</div>
        </button>`).join("")
    : `<div class="empty">No projects yet — create one or reload to seed the demo.</div>`;
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
  const name = prompt("Project name (e.g. Girder Bridge No.3):");
  if (!name) return;
  const type = (prompt("Structure type: bridge / tunnel / hydraulic / other:", "bridge") ?? "bridge").toLowerCase();
  const st = (["bridge", "tunnel", "hydraulic", "other"].includes(type) ? type : "other") as Project["structureType"];
  await store.createProject(name, st as Project["structureType"]);
  await refreshProjects();
}

/* ---------- inspection session ---------- */

function renderSession(): void {
  const p = activeProject!;
  app.innerHTML = `
    <header class="topbar">
      <button id="back" class="ghost">← Projects</button>
      <div class="status">
        <span class="chip ${navigator.onLine ? "online" : "offline"}">${navigator.onLine ? "⇅ online" : "✕ offline"}</span>
        <span id="engine-chip" class="chip pending">…</span>
      </div>
    </header>
    <main>
      <h1 class="session-title">${escapeHtml(p.name)} <span class="muted">· ${structureLabel(p.structureType)}</span></h1>

      <section class="panel" id="capture">
        <div class="panel-head"><h2>Capture defect</h2><span class="hint">on-device first · works offline</span></div>
        <textarea id="note" rows="3" placeholder="Speak or type like you'd talk: “Longitudinal crack on web of girder G2, about 2 mm wide, 3 m long, seepage with white efflorescence nearby.”"></textarea>
        <div class="row">
          <button id="capture-btn" class="primary">⚡ Capture</button>
          <span id="capture-state" class="muted"></span>
        </div>
        <div id="capture-result"></div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>Records <span id="record-count" class="muted"></span></h2>
          <div class="row">
            <button id="sync-btn" class="ghost" title="Simulate returning to coverage (demo mode flips pending → synced)">↻ Back in range</button>
            <button id="report-btn" class="ghost">☁ Draft report</button>
          </div>
        </div>
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

async function ensureWarm(): Promise<void> {
  if (deviceWarmed) return;
  deviceWarmed = true; // only try once per session; badge shows download progress
  try {
    await warmDeviceModel();
  } catch (e) {
    console.warn("[ai] device model warm-up failed:", e);
  }
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
    out.innerHTML = answerBlock("Structured record", answer, recordCardHtml({
      ...record,
      severity: (["unknown", "minor", "moderate", "severe"].includes(record.severity) ? record.severity : "unknown") as DefectRecord["severity"],
    }, note, false, true));
    // Save it (pending sync when offline — the honest state).
    const engineOf: DefectRecord["extractedBy"] =
      answer.badge.engine === "on_device" ? "on_device" :
      answer.badge.engine === "in_cloud" ? "in_cloud" : "rule_based";
    const saved = await store.addRecord({
      projectId: activeProject!.id,
      createdAt: new Date().toISOString(),
      rawNote: note,
      component: record.component || "(unspecified)",
      defectType: record.defectType || "(unspecified)",
      quantity: record.quantity || "(unspecified)",
      severity: (["unknown", "minor", "moderate", "severe"].includes(record.severity) ? record.severity : "unknown") as DefectRecord["severity"],
      notes: record.notes,
      extractedBy: engineOf,
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
  extractedBy?: DefectRecord["extractedBy"];
  syncState?: DefectRecord["syncState"];
}

function recordCardHtml(r: RecordCardData, _rawNote: string, showSync = true, withActions = false): string {
  const sev = { unknown: "·", minor: "minor", moderate: "moderate", severe: "severe" }[r.severity];
  return `
    <div class="record sev-${r.severity}">
      <div class="record-head">
        <span class="sev-dot"></span>
        <strong>${escapeHtml(r.defectType)}</strong>
        <span class="muted">${escapeHtml(r.component)}</span>
        ${showSync ? (r.syncState === "pending" ? `<span class="chip pending">⏳ pending sync</span>` : `<span class="chip online">✓ synced</span>`) : ""}
      </div>
      <div class="record-meta">${escapeHtml(r.quantity)} · severity: ${sev}${r.extractedBy === "on_device" ? ` · <span class="chip device">⚡ on-device</span>` : r.extractedBy === "rule_based" ? ` · <span class="chip unavailable">⚙ rule-based</span>` : ` · <span class="chip cloud">☁ cloud</span>`}</div>
      ${r.notes ? `<div class="record-notes">${escapeHtml(r.notes)}</div>` : ""}
      ${withActions ? `<div class="row"><button class="ghost check-btn">Check severity vs reference</button><span class="check-out"></span></div>` : ""}
    </div>`;
}

async function refreshRecords(): Promise<void> {
  if (!activeProject) return;
  const records = await store.listRecords(activeProject.id);
  const list = document.querySelector("#record-list");
  if (!list) return;
  document.querySelector("#record-count")!.textContent = `(${records.length})`;
  list.innerHTML = records.length
    ? records.map((r) => recordCardHtml(r, r.rawNote, true, true)).join("")
    : `<div class="empty">No records yet. Capture your first defect above — try it with DevTools offline.</div>`;

  // Wire severity cross-check buttons (F4, on-device).
  list.querySelectorAll(".record").forEach((el, i) => {
    const btn = el.querySelector(".check-btn") as HTMLButtonElement | null;
    if (!btn) return;
    const rec = records[i];
    btn.addEventListener("click", async () => {
      const out = el.querySelector(".check-out") as HTMLElement;
      out.textContent = " checking…";
      try {
        const answer = await crossCheckSeverity(rec);
        out.innerHTML = badgeHtml(answer.badge) + `<div class="check-text">${escapeHtml(answer.text)}</div>`;
      } catch (e) {
        out.textContent = ` failed: ${String(e)}`;
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
  const n = await store.syncPending(activeProject.id);
  const btn = document.querySelector("#sync-btn")!;
  btn.textContent = `↻ Back in range (${n} synced)`;
  setTimeout(() => (btn.textContent = "↻ Back in range"), 2500);
  void refreshRecords();
}

async function onDraftReport(): Promise<void> {
  if (!activeProject) return;
  const out = document.querySelector("#report-out")!;
  const records = await store.listRecords(activeProject.id);
  if (!records.length) {
    out.innerHTML = `<div class="empty">Capture some records first.</div>`;
    return;
  }
  out.innerHTML = `<div class="muted">drafting in cloud…</div>`;
  try {
    const answer = await draftReport(records);
    out.innerHTML = answer.text
      ? answerBlock("Inspection report draft", answer, `<pre class="report">${escapeHtml(answer.text)}</pre>`)
      : answerBlock("Inspection report draft", answer);
  } catch (e) {
    out.innerHTML = `<div class="ai-block error">Report drafting failed: ${escapeHtml(String(e))}</div>`;
  }
}

/* ---------- global engine chip ---------- */

onEngineUpdate((badge) => {
  const chip = document.querySelector("#engine-chip");
  if (chip) {
    chip.className = `chip ${badge.engine === "on_device" ? "device" : badge.engine === "in_cloud" ? (badge.fellBack ? "fallback" : "cloud") : "pending"}`;
    chip.textContent = badge.label;
  }
  refreshEngineLog();
});

window.addEventListener("online", render);
window.addEventListener("offline", render);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/* ---------- boot ---------- */

(async () => {
  initEngineSimulationFromUrl();
  await initFirebase();
  await seedIfEmpty();
  render();
})();
