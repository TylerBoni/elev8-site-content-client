import type {
  CacheEntry,
  FetchPublishedSiteContentResponse,
  GetPublishedOptions,
  GetPublishedResult,
  SiteContentClientOptions,
} from "./types.js";
import { getDefaultStorage, safeJsonParse } from "./storage.js";

const DEFAULT_MAX_AGE_MS = 60_000; // 1 min in-app freshness
const DEFAULT_SWR_MS = 5 * 60_000; // 5 min stale-while-revalidate

function nowMs() {
  return Date.now();
}

function isFresh(entry: CacheEntry<unknown>) {
  return nowMs() < entry.fetchedAtMs + entry.maxAgeMs;
}

function isWithinStaleWindow(entry: CacheEntry<unknown>) {
  return nowMs() < entry.fetchedAtMs + entry.maxAgeMs + entry.staleWhileRevalidateMs;
}

function buildUrl(opts: SiteContentClientOptions) {
  const u = new URL(opts.endpoint);
  u.searchParams.set("site_id", opts.siteId);
  if (opts.version) u.searchParams.set("v", opts.version);
  return u.toString();
}

function cacheKey(opts: SiteContentClientOptions) {
  const prefix = opts.cacheKeyPrefix ?? "elevate_site_content";
  const u = new URL(opts.endpoint);
  const versionPart = opts.version ? `v:${opts.version}` : "v:0";
  return `${prefix}:${u.origin}${u.pathname}:${opts.siteId}:${versionPart}`;
}

export function createSiteContentClient(options: SiteContentClientOptions) {
  const fetchImpl = options.fetch ?? fetch;
  const storage = options.storage === undefined ? getDefaultStorage() : options.storage;
  const key = cacheKey(options);

  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const staleWhileRevalidateMs = options.staleWhileRevalidateMs ?? DEFAULT_SWR_MS;

  let memory: CacheEntry<FetchPublishedSiteContentResponse> | null = null;
  let inFlight: Promise<GetPublishedResult> | null = null;

  function loadFromStorage(): CacheEntry<FetchPublishedSiteContentResponse> | null {
    if (!storage) return null;
    return safeJsonParse<CacheEntry<FetchPublishedSiteContentResponse>>(storage.getItem(key));
  }

  function saveToStorage(entry: CacheEntry<FetchPublishedSiteContentResponse>) {
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(entry));
    } catch {
      // ignore quota / privacy mode
    }
  }

  async function fetchNetwork(
    opts?: { signal?: AbortSignal; ifNoneMatch?: string },
  ): Promise<
    | { kind: "not-modified"; etag?: string }
    | { kind: "ok"; data: FetchPublishedSiteContentResponse; etag?: string }
  > {
    const url = buildUrl(options);
    const headers: Record<string, string> = { accept: "application/json" };
    if (opts?.ifNoneMatch) headers["if-none-match"] = opts.ifNoneMatch;

    const res = await fetchImpl(url, { method: "GET", headers, signal: opts?.signal });

    if (res.status === 304) {
      const etag = res.headers.get("etag") ?? opts?.ifNoneMatch ?? undefined;
      return { kind: "not-modified" as const, etag };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`site-content fetch failed (${res.status}): ${text || res.statusText}`);
    }

    const etag = res.headers.get("etag") ?? undefined;
    const data = (await res.json()) as FetchPublishedSiteContentResponse;
    return { kind: "ok" as const, data, etag };
  }

  async function refresh(signal?: AbortSignal): Promise<GetPublishedResult> {
    const prior = memory ?? loadFromStorage();
    const ifNoneMatch = prior?.etag;

    const r = await fetchNetwork({ signal, ifNoneMatch });

    if (r.kind === "not-modified" && prior) {
      const next: CacheEntry<FetchPublishedSiteContentResponse> = {
        ...prior,
        fetchedAtMs: nowMs(),
        maxAgeMs,
        staleWhileRevalidateMs,
        etag: r.etag ?? prior.etag,
      };
      memory = next;
      saveToStorage(next);
      return { data: next.value, source: "network-304", etag: next.etag };
    } else {
      const ok = r as { kind: "ok"; data: FetchPublishedSiteContentResponse; etag?: string };
      const entry: CacheEntry<FetchPublishedSiteContentResponse> = {
        value: ok.data,
        fetchedAtMs: nowMs(),
        maxAgeMs,
        staleWhileRevalidateMs,
        etag: ok.etag,
      };
      memory = entry;
      saveToStorage(entry);
      return { data: entry.value, source: "network", etag: entry.etag };
    }
  }

  async function getPublished(opts: GetPublishedOptions = {}): Promise<GetPublishedResult> {
    const fromMemory = memory !== null;
    const cached = memory ?? loadFromStorage();
    if (cached && !opts.forceRefresh) {
      if (!fromMemory) memory = cached;
      if (isFresh(cached)) return { data: cached.value, source: fromMemory ? "memory" : "storage", etag: cached.etag };

      if (isWithinStaleWindow(cached)) {
        // Fire-and-forget refresh, but de-dupe concurrent refreshes
        if (!inFlight) {
          inFlight = refresh().finally(() => {
            inFlight = null;
          });
        }
        return { data: cached.value, source: fromMemory ? "memory" : "storage", etag: cached.etag };
      }
    }

    if (inFlight) return inFlight;
    inFlight = refresh(opts.signal).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function clearCache() {
    memory = null;
    if (storage) {
      try {
        storage.removeItem(key);
      } catch {
        // ignore
      }
    }
  }

  return { getPublished, clearCache };
}

