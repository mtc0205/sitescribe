/**
 * Persistence layer.
 *
 * Demo/local mode keeps everything in localStorage (the app must be useful
 * with zero Firebase project). Live mode mirrors the same API onto Firestore
 * with offline persistence: records written in dead zones sync automatically
 * once connectivity returns.
 */
import type { DefectRecord, Project } from "./types";
import { runtime } from "./firebase";
import { flushPending } from "./merge";

const LS_KEY = "sitescribe.v1";

interface LocalDb {
  projects: Project[];
  records: DefectRecord[];
}

function readLocal(): LocalDb {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "") as LocalDb;
  } catch {
    return { projects: [], records: [] };
  }
}

function writeLocal(db: LocalDb) {
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Change notification so the UI can re-render records when a Firestore
 *  write is acknowledged by the server (pending → synced flips). */
type StoreListener = () => void;
const storeListeners = new Set<StoreListener>();
export function onStoreChange(fn: StoreListener): () => void {
  storeListeners.add(fn);
  return () => storeListeners.delete(fn);
}
function notifyStoreChange(): void {
  storeListeners.forEach((fn) => fn());
}

export const store = {
  /** Live listings read from the LOCAL cache (incl. pending local writes) —
   *  offline-first: never block on the server. */
  async listProjects(): Promise<Project[]> {
    if (runtime.mode === "live" && runtime.app) {
      const { getFirestore, collection, getDocsFromCache, query, where, orderBy } = await import("firebase/firestore");
      const uidv = (await import("firebase/auth")).getAuth().currentUser?.uid;
      if (!uidv) return [];
      const snap = await getDocsFromCache(
        query(collection(getFirestore(runtime.app), "projects"), where("owner", "==", uidv), orderBy("createdAt", "desc")),
      ).catch((e) => (console.warn("[firestore] listProjects failed:", e), { forEach: () => undefined } as never));
      const out: Project[] = [];
      snap.forEach((d) => out.push({ ...(d.data() as Project), id: d.id }));
      return out;
    }
    return readLocal().projects;
  },

  async createProject(name: string, structureType: Project["structureType"]): Promise<Project> {
    if (runtime.mode === "live" && runtime.app) {
      const { getFirestore, collection, doc, setDoc } = await import("firebase/firestore");
      const uidv = (await import("firebase/auth")).getAuth(runtime.app).currentUser?.uid;
      if (!uidv) throw new Error("not signed in — projects require an owner (anonymous auth)");
      const ref = doc(collection(getFirestore(runtime.app), "projects"));
      // Use the Firestore doc id from the start so records' projectId matches
      // across sessions/reloads.
      const project: Project = { id: ref.id, name, structureType, createdAt: new Date().toISOString() };
      // Fire-and-forget: the local write applies immediately (latency
      // compensation); the promise resolves on server ack, which may be later.
      void setDoc(ref, { ...project, owner: uidv }).catch((e) => console.warn("[firestore] createProject write failed:", e));
      return project;
    }
    const project: Project = { id: uid(), name, structureType, createdAt: new Date().toISOString() };
    const db = readLocal();
    db.projects.unshift(project);
    writeLocal(db);
    return project;
  },

  async listRecords(projectId: string): Promise<DefectRecord[]> {
    if (runtime.mode === "live" && runtime.app) {
      const { getFirestore, collection, getDocsFromCache, query, where, orderBy } = await import("firebase/firestore");
      const snap = await getDocsFromCache(
        query(collection(getFirestore(runtime.app), "records"), where("projectId", "==", projectId), orderBy("createdAt", "desc")),
      ).catch((e) => (console.warn("[firestore] listRecords failed:", e), { forEach: () => undefined } as never));
      const out: DefectRecord[] = [];
      snap.forEach((d) => out.push({ ...(d.data() as DefectRecord), id: d.id }));
      return out;
    }
    return readLocal().records.filter((r) => r.projectId === projectId);
  },

  /** In live mode the record is stored as `pending` and flips to `synced`
   *  only when Firestore acknowledges the write server-side (honest badge).
   *  The write is issued fire-and-forget so the UI never blocks on the
   *  network: the local cache (incl. pending writes) serves the listing. */
  async addRecord(record: Omit<DefectRecord, "id">): Promise<DefectRecord> {
    const full: DefectRecord = { ...record, id: uid(), syncState: "pending" };
    if (runtime.mode === "live" && runtime.app) {
      const { getFirestore, collection, doc, setDoc, updateDoc, waitForPendingWrites } = await import("firebase/firestore");
      const uidv = (await import("firebase/auth")).getAuth(runtime.app).currentUser?.uid;
      if (!uidv) throw new Error("not signed in — records require an owner (anonymous auth)");
      const fs = getFirestore(runtime.app);
      const ref = doc(collection(fs, "records")); // id generated locally
      full.id = ref.id;
      void (async () => {
        try {
          await setDoc(ref, { ...full, syncState: "pending", owner: uidv }); // resolves on server ack
          await waitForPendingWrites(fs);
          await updateDoc(ref, { syncState: "synced" });
          full.syncState = "synced";
          notifyStoreChange();
        } catch (e) {
          console.warn("[firestore] sync ack failed:", e);
        }
      })();
    } else {
      const db = readLocal();
      db.records.unshift(full);
      writeLocal(db);
    }
    return full;
  },

  async markSynced(recordId: string): Promise<void> {
    const db = readLocal();
    const r = db.records.find((x) => x.id === recordId);
    if (r) {
      r.syncState = "synced";
      writeLocal(db);
    }
  },

  /** Demo-mode "back in range" simulation: flip pending records to synced. */
  async syncPending(projectId: string): Promise<number> {
    const db = readLocal();
    const { flipped, count } = flushPending(db.records, projectId);
    db.records = flipped;
    writeLocal(db);
    return count;
  },

  /** Live-mode "back in range": wait for the server to ack the offline write
   *  queue, then report how many of this project's records are synced. */
  async ackPending(projectId: string): Promise<number> {
    if (runtime.mode !== "live" || !runtime.app) return 0;
    const { getFirestore, waitForPendingWrites } = await import("firebase/firestore");
    try {
      await waitForPendingWrites(getFirestore(runtime.app));
    } catch (e) {
      console.warn("[firestore] waitForPendingWrites failed:", e);
    }
    await new Promise((r) => setTimeout(r, 300)); // let the post-ack updateDoc land
    const records = await this.listRecords(projectId);
    return records.filter((r) => r.syncState === "synced").length;
  },
};

/** Seed a demo project so first-run users land in a believable context and
 *  can see the whole loop in ~2 minutes. Demo/emulator mode only — never in
 *  a real user's production account (sample records would claim an engine
 *  that never ran). */
export async function seedIfEmpty(): Promise<void> {
  if (runtime.mode === "live" && !runtime.emulator) return;
  if ((await store.listProjects()).length > 0) return;
  const p = await store.createProject("Girder Bridge No.3 — Qiantang tributary", "bridge");
  const SAMPLE = "Sample record (demo seed)";
  await store.addRecord({
    projectId: p.id,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    rawNote: "Hairline transverse crack near support S2-1, barely visible, no seepage.",
    component: "deck slab near support S2-1",
    defectType: "transverse crack",
    quantity: "hairline, single",
    severity: "minor",
    notes: `${SAMPLE}. Monitor at next visit; no measurement taken today.`,
    extractedBy: "rule_based",
    syncState: "synced",
  });
  await store.addRecord({
    projectId: p.id,
    createdAt: new Date(Date.now() - 82800000).toISOString(),
    rawNote: "Spalling with exposed rebar on pier P1, roughly 30 cm patch, active seepage.",
    component: "pier P1",
    defectType: "spalling with exposed rebar",
    quantity: "~30 cm patch",
    severity: "severe",
    notes: `${SAMPLE}. Exposed reinforcement — reference card says severe; specialist review pending.`,
    extractedBy: "rule_based",
    syncState: "synced",
  });
  await store.addRecord({
    projectId: p.id,
    createdAt: new Date(Date.now() - 79200000).toISOString(),
    rawNote: "White efflorescence with damp patch on web of girder G2.",
    component: "web of girder G2",
    defectType: "efflorescence with seepage",
    quantity: "isolated, ~0.5 m²",
    severity: "moderate",
    notes: `${SAMPLE}. Active seepage with deposits — monitor drainage above.`,
    extractedBy: "rule_based",
    syncState: "synced",
  });
}
