export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type PublishedSiteContent = {
  site_content_id: string;
  site_id: string;
  content: Json;
  published_at: string | null;
  updated_at: string;
};

export type FetchPublishedSiteContentResponse = PublishedSiteContent | null;

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type CacheEntry<T> = {
  value: T;
  fetchedAtMs: number;
  maxAgeMs: number;
  staleWhileRevalidateMs: number;
  etag?: string;
};

export type SiteContentClientOptions = {
  /**
   * Cacheable GET endpoint (e.g. your Edge Function URL).
   * Should accept `site_id` query param and return JSON (or 304 with ETag).
   */
  endpoint: string;
  siteId: string;

  /**
   * Optional version parameter appended to the URL as `v=...` for cache-busting.
   * Typical value: published_at/updated_at for the latest published content.
   */
  version?: string;

  /**
   * Default caching behavior.
   * maxAgeMs: how long a cached value is considered fresh.
   * staleWhileRevalidateMs: after maxAgeMs, keep serving stale while a refresh happens.
   */
  maxAgeMs?: number;
  staleWhileRevalidateMs?: number;

  /**
   * Storage for persistence (localStorage, sessionStorage, etc).
   * If omitted, defaults to localStorage when available, otherwise memory-only.
   */
  storage?: StorageLike | null;
  cacheKeyPrefix?: string;

  /**
   * Override fetch (useful for SSR environments).
   */
  fetch?: typeof fetch;
};

export type GetPublishedOptions = {
  /**
   * If true, bypasses cache and forces a network refresh.
   */
  forceRefresh?: boolean;
  signal?: AbortSignal;
};

export type GetPublishedResult = {
  data: FetchPublishedSiteContentResponse;
  source: "memory" | "storage" | "network" | "network-304";
  etag?: string;
};
