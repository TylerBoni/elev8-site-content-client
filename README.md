# elevate-site-content-client

Client library to fetch **published** site content via a **cacheable GET endpoint**, with:

- memory cache
- optional persistent storage cache (defaults to `localStorage` when available)
- ETag / `If-None-Match` support
- stale-while-revalidate behavior

## What you need on the backend (Supabase)

This package expects a GET endpoint that returns JSON and supports ETag.

If you’re using the setup in this repo:

- **DB RPC**: `public.get_published_site_content(_site_id uuid)` (security definer, returns latest published content)
- **Edge Function**: `published-site-content` at `/functions/v1/published-site-content?site_id=<uuid>`
  - includes `Cache-Control`, `ETag`, and CORS headers

Deploy the Edge Function:

```bash
supabase functions deploy published-site-content
```

## Install

```bash
npm i elevate-site-content-client
```

## Usage (browser)

```ts
import { createSiteContentClient } from "elevate-site-content-client";

const client = createSiteContentClient({
  endpoint: "https://YOUR-PROJECT.supabase.co/functions/v1/published-site-content",
  siteId: "00000000-0000-0000-0000-000000000000",
  maxAgeMs: 60_000,
  staleWhileRevalidateMs: 300_000,
});

const { data } = await client.getPublished();
// data?.content
```

## Usage (Next.js / server)

Server-side usage works (Node 18+ has `fetch`). For Next.js you usually want to pass `fetch` explicitly to control caching:

```ts
import { createSiteContentClient } from "elevate-site-content-client";

const client = createSiteContentClient({
  endpoint: process.env.NEXT_PUBLIC_SITE_CONTENT_ENDPOINT!,
  siteId,
  fetch: (url, init) =>
    fetch(url, {
      ...init,
      // Next.js fetch caching (optional)
      next: { revalidate: 60 },
    }),
});

const { data } = await client.getPublished();
```

## Usage (Next.js SSR + client hook)

This is the recommended pattern for SSR: fetch once on the server, then hydrate the client hook with `initialData`.

Server component:

```ts
import { createSiteContentClient } from "elevate-site-content-client";
import ClientContent from "./ClientContent";

export default async function Page() {
  const client = createSiteContentClient({
    endpoint: process.env.NEXT_PUBLIC_SITE_CONTENT_ENDPOINT!,
    siteId: process.env.SITE_ID!,
    fetch,
  });

  const { data, etag } = await client.getPublished({ forceRefresh: true });

  return <ClientContent initialData={data} initialEtag={etag} />;
}
```

Client component:

```ts
"use client";
import { usePublishedSiteContent } from "elevate-site-content-client/react";

export default function ClientContent(props: { initialData: any; initialEtag?: string }) {
  const { data, isLoading } = usePublishedSiteContent({
    endpoint: process.env.NEXT_PUBLIC_SITE_CONTENT_ENDPOINT!,
    siteId: process.env.NEXT_PUBLIC_SITE_ID!,
    initialData: props.initialData,
    initialEtag: props.initialEtag,
  });

  if (isLoading) return null;
  return <pre>{JSON.stringify(data?.content, null, 2)}</pre>;
}
```

## Cache busting with version

If you have a publish “version” (e.g. `updated_at` of the latest published row), pass it so a new publish automatically changes the cache key:

```ts
const client = createSiteContentClient({
  endpoint: "https://YOUR-PROJECT.supabase.co/functions/v1/published-site-content",
  siteId,
  version: publishedVersion, // appended as `?v=...`
});
```

## Troubleshooting

- **CORS error in browser**: your GET endpoint must return `Access-Control-Allow-Origin` (and handle `OPTIONS`). The Edge Function in this repo includes CORS + exposes `ETag`.
- **No edge caching**: don’t call `supabase.rpc(...)` from the browser. Use a cacheable GET endpoint that returns `Cache-Control` + `ETag`.
- **304 not happening**: ensure the endpoint returns `ETag`, and allows/reads the `If-None-Match` header.

## Notes

- The React hook (`elevate-site-content-client/react`) is **client-only**; use SSR as shown above.
