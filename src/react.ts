import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSiteContentClient } from "./client.js";
import type {
  FetchPublishedSiteContentResponse,
  GetPublishedResult,
  SiteContentClientOptions,
} from "./types.js";

export type UsePublishedSiteContentOptions = Omit<SiteContentClientOptions, "fetch"> & {
  /**
   * Provide SSR data to avoid a loading state on first paint.
   * (In Next.js, pass from a server component / route handler.)
   */
  initialData?: FetchPublishedSiteContentResponse;
  initialEtag?: string;

  /**
   * Disable fetching (still returns initialData if provided).
   */
  enabled?: boolean;

  /**
   * Force refresh on mount (bypasses client cache). Default false.
   */
  forceRefreshOnMount?: boolean;

  /**
   * Optional polling. If set, will refresh in the background.
   */
  pollIntervalMs?: number;
};

export type UsePublishedSiteContentResult = {
  data: FetchPublishedSiteContentResponse;
  error: unknown;
  isLoading: boolean;
  source?: GetPublishedResult["source"];
  etag?: string;
  refresh: (opts?: { forceRefresh?: boolean }) => Promise<GetPublishedResult | null>;
  clearCache: () => void;
};

export function usePublishedSiteContent(opts: UsePublishedSiteContentOptions): UsePublishedSiteContentResult {
  const {
    initialData,
    initialEtag,
    enabled = true,
    forceRefreshOnMount = false,
    pollIntervalMs,
    ...clientOpts
  } = opts;

  // Create a stable client when primitives change.
  const client = useMemo(() => createSiteContentClient(clientOpts), [
    clientOpts.endpoint,
    clientOpts.siteId,
    clientOpts.version,
    clientOpts.maxAgeMs,
    clientOpts.staleWhileRevalidateMs,
    clientOpts.cacheKeyPrefix,
    clientOpts.storage,
  ]);

  const [data, setData] = useState<FetchPublishedSiteContentResponse>(initialData ?? null);
  const [etag, setEtag] = useState<string | undefined>(initialEtag);
  const [source, setSource] = useState<GetPublishedResult["source"] | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState<boolean>(initialData ? false : enabled);

  // Prevent setState after unmount
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useCallback(
    async (r?: { forceRefresh?: boolean }) => {
      if (!enabled) return null;
      try {
        setIsLoading((prev: boolean) => prev || !data);
        const res = await client.getPublished({ forceRefresh: r?.forceRefresh });
        if (!aliveRef.current) return res;
        setData(res.data);
        setEtag(res.etag);
        setSource(res.source);
        setError(null);
        setIsLoading(false);
        return res;
      } catch (e) {
        if (!aliveRef.current) return null;
        setError(e);
        setIsLoading(false);
        return null;
      }
    },
    [client, enabled, data],
  );

  const clearCache = useCallback(() => {
    client.clearCache();
  }, [client]);

  useEffect(() => {
    if (!enabled) return;
    void refresh({ forceRefresh: forceRefreshOnMount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, forceRefreshOnMount, client]);

  useEffect(() => {
    if (!enabled) return;
    if (!pollIntervalMs || pollIntervalMs <= 0) return;
    const id = setInterval(() => {
      void refresh();
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [enabled, pollIntervalMs, refresh]);

  return { data, error, isLoading, source, etag, refresh, clearCache };
}

