import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Minimal hand-written PWA shell — no plugin dependency.
 *
 * At build time we know the hashed asset filenames, so this plugin writes
 * `dist/sw.js` with a versioned precache list. The service worker:
 *   - precaches the app shell (index.html + all build assets) on install
 *   - serves precached assets cache-first (same-origin GET only)
 *   - serves navigations network-first with the cached shell as fallback
 *     → cold start offline still renders the app
 *   - NEVER touches cross-origin requests (Firebase / Gemini API calls)
 */
function swPrecache(): Plugin {
  return {
    name: "sitescribe-sw-precache",
    apply: "build",
    enforce: "post",
    closeBundle() {
      const dist = path.resolve(process.cwd(), "dist");
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          if (f.name === "sw.js" || f.name.endsWith(".map")) continue;
          const p = path.join(dir, f.name);
          if (f.isDirectory()) walk(p);
          else files.push("/" + path.relative(dist, p).split(path.sep).join("/"));
        }
      };
      walk(dist);
      const version = crypto.createHash("sha256").update(files.join(",")).digest("hex").slice(0, 12);
      const sw = `/* SiteScribe service worker — GENERATED at build time, do not edit.
 * Precache manifest v${version}. Fetch policy: app shell only;
 * cross-origin requests (Firebase / Gemini APIs) are always passed through. */
const VERSION = "${version}";
const CACHE = "sitescribe-shell-" + VERSION;
const PRECACHE = ${JSON.stringify(["/", ...files])};
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // never cache Firebase/Gemini API traffic
  if (req.mode === "navigate") {
    // Network-first for navigations so updates land; cached shell offline.
    e.respondWith(fetch(req).catch(() => caches.match("/index.html").then((r) => r || caches.match("/"))));
    return;
  }
  if (PRECACHE.includes(url.pathname)) {
    e.respondWith(caches.match(url.pathname).then((r) => r || fetch(req)));
  }
});
`;
      fs.writeFileSync(path.join(dist, "sw.js"), sw);
      console.log(`[sw-precache] wrote dist/sw.js (v${version}, ${files.length + 1} precached URLs)`);
    },
  };
}

export default defineConfig({
  server: { port: 5173, host: "127.0.0.1" },
  build: { target: "es2022", sourcemap: true },
  plugins: [swPrecache()],
});
