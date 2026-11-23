/**
 * Shared base-URL resolution for the local (dev-server) scripts.
 *
 * Order of precedence:  --url <base>  >  --port <n>  >  $SS_BASE_URL /
 * $SS_PORT  >  http://127.0.0.1:5173 (the port `npm run dev` uses).
 *
 * Why this exists: on 2026-11-24 port 5173 was already taken by an unrelated
 * project on this machine, so the harnesses must be able to point somewhere
 * else — and they must refuse to run against a server that is not SiteScribe
 * instead of reporting confusing assertion failures.
 */

const DEFAULT_PORT = 5173;

function opt(argv, name) {
  const i = argv.indexOf("--" + name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

/** Pure: resolve the base URL (no trailing slash) from argv + env. */
export function resolveBaseUrl(argv = process.argv.slice(2), env = process.env) {
  const url = opt(argv, "url") ?? opt(argv, "port") ?? env.SS_BASE_URL ?? env.SS_PORT;
  if (url == null) return `http://127.0.0.1:${DEFAULT_PORT}`;
  if (/^https?:\/\//i.test(String(url))) return String(url).replace(/\/+$/, "");
  return `http://127.0.0.1:${String(url)}`;
}

/**
 * Fetch `<base>/` and make sure it is the SiteScribe app.
 * Returns { ok, reason, title }. Never throws.
 */
export async function probeBaseUrl(base, { timeoutMs = 5000 } = {}) {
  let res;
  try {
    res = await fetch(base + "/", { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (e) {
    return { ok: false, reason: `nothing answered at ${base}/ (${String(e?.cause?.code ?? e?.name ?? e).slice(0, 60)})`, title: null };
  }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status} from ${base}/`, title: null };
  const html = await res.text().catch(() => "");
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  if (!/SiteScribe/i.test(title) && !/SiteScribe/i.test(html)) {
    return { ok: false, reason: `the server at ${base} is NOT SiteScribe (title: "${title || "(none)"}") — the port is taken by another project`, title };
  }
  return { ok: true, reason: "ok", title };
}

/** Exit (code 2) with an actionable message unless `base` serves SiteScribe. */
export async function ensureServesSiteScribe(base) {
  const p = await probeBaseUrl(base);
  if (!p.ok) {
    console.error(
      `\n[harness] ${p.reason}\n` +
        `          Start the app first and point the script at it, e.g.\n` +
        `            npm run dev -- --port ${DEFAULT_PORT}            # in the repo, then\n` +
        `            node scripts/<script>.mjs                        # default port ${DEFAULT_PORT}\n` +
        `          or, if ${DEFAULT_PORT} is busy:\n` +
        `            npm run dev -- --port 5187 --strictPort\n` +
        `            node scripts/<script>.mjs --port 5187          # or --url http://127.0.0.1:5187\n`,
    );
    process.exit(2);
  }
  return p;
}
