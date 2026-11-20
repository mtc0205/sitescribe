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

export const store = {
  async listProjects(): Promise<Project[]> {
    if (runtime.mode === "live" && runtime.app) {
      const { getFirestore, collection, getDocs, query, where, orderBy } = await import("firebase/firestore");
      const uidv = (await import("firebase/auth")).getAuth().currentUser?.uid;
      if (!uidv) return [];
      const snap = await getDocs(
        query(collection(getFirestore(runtime.app), "projects"), where("owner", "==", uidv), orderBy("createdAt", "desc")),
      ).catch((e) => (console.warn("[firestore] listProjects failed:", e), { forEach: () => undefined } as never));
      const out: Project[] = [];
      snap.forEach((d) => out.push({ ...(d.data() as Project), id: d.id }));
      return out;
    }
    return readLocal().projects;
  },

  async createProject(name: string, structureType: Project["structureType"]): Promise<Project> {
    const project: Project = { id: uid(), name, structureType, createdAt: new Date().toISOString() };
    if (runtime.mode === "live" && runtime.app) {
      const { getFirestore, collection, addDoc } = await import("firebase/firestore");
      const uidv = (await import("firebase/auth")).getAuth().currentUser?.uid;
      await addDoc(collection(getFirestore(runtime.app), "projects"), { ...project, owner: uidv ?? "anon" });
    } else {
      const db = readLocal();
      db.projects.unshift(project);
      writeLocal(db);
    }
    return project;
  },

  async listRecords(projectId: string): Promise<DefectRecord[]> {
    if (runtime.mode === "live" && runtime.app) {
      const { getFirestore, collection, getDocs, query, where, orderBy } = await import("firebase/firestore");
      const snap = await getDocs(
        query(collection(getFirestore(runtime.app), "records"), where("projectId", "==", projectId), orderBy("createdAt", "desc")),
      ).catch((e) => (console.warn("[firestore] listRecords failed:", e), { forEach: () => undefined } as never));
      const out: DefectRecord[] = [];
      snap.forEach((d) => out.push({ ...(d.data() as DefectRecord), id: d.id }));
      return out;
    }
    return readLocal().records.filter((r) => r.projectId === projectId);
  },

  /** In demo mode a "sync" flush is a no-op marker; Firestore mode relies on
   *  its built-in offline queue, so we just read the pending state. */
  async addRecord(record: Omit<DefectRecord, "id">): Promise<DefectRecord> {
    const full: DefectRecord = { ...record, id: uid() };
    if (runtime.mode === "live" && runtime.app) {
      const { getFirestore, collection, addDoc } = await import("firebase/firestore");
      // Firestore's local persistence makes this succeed offline; sync happens later.
      await addDoc(collection(getFirestore(runtime.app), "records"), full);
      full.syncState = navigator.onLine ? "synced" : "pending";
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
    let n = 0;
    for (const r of db.records) {
      if (r.projectId === projectId && r.syncState === "pending") {
        r.syncState = "synced";
        n++;
      }
    }
    writeLocal(db);
    return n;
  },
};

/** Seed a demo project so first-run judges land in a believable context. */
export async function seedIfEmpty(): Promise<void> {
  if ((await store.listProjects()).length > 0) return;
  const p = await store.createProject("Girder Bridge No.3 — Qiantang tributary", "bridge");
  await store.addRecord({
    projectId: p.id,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    rawNote: "Hairline transverse crack near support S2-1, barely visible, no seepage.",
    component: "deck slab near support S2-1",
    defectType: "transverse crack",
    quantity: "hairline, single",
    severity: "minor",
    notes: "Monitor at next visit; no measurement taken today.",
    extractedBy: "on_device",
    syncState: "synced",
  });
}
