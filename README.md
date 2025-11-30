# Cloudflare KV Rate Limited API

A Cloudflare Worker demonstrating KV storage with IP-based rate limiting and response caching.

## Overview

This worker provides a simple key-value storage API with two endpoints:

**GET /** - Retrieves all stored values, cached for 60 seconds
**POST /set** - Stores a key-value pair, rate limited by IP address

## Configuration

The worker uses three Cloudflare bindings configured in `wrangler.jsonc`:

```jsonc
"kv_namespaces": [{
  "binding": "KV_STORE",
  "id": "preview_id",
  "preview_id": "preview_id"
}],
"ratelimits": [{
  "binding": "RATE_LIMITER",
  "simple": {
    "limit": 10,
    "period": 60
  }
}],
"vars": {
  "RATE_LIMIT_PER_MINUTE": "10"
}
```

## Rate Limiting

The `/set` endpoint uses Cloudflare's Rate Limiting API to restrict requests by IP address:

```typescript
const ip = request.headers.get('CF-Connecting-IP') ||
           request.headers.get('X-Forwarded-For') ||
           'unknown';

const rateLimitResult = await env.RATE_LIMITER.limit({ key: ip });

if (!rateLimitResult.success) {
  return new Response(JSON.stringify({
    error: 'Rate limit exceeded'
  }), { status: 429 });
}
```

Requests exceeding 10 per minute per IP receive a 429 response.

**Note:** IP-based rate limiting can be problematic for users behind CGNAT or shared networks, as multiple users may share the same IP address. For production applications, consider using a user identifier (session token, API key) or a combination fingerprint (IP + User-Agent + other headers) as the rate limit key instead.

## Caching

The GET endpoint uses Cloudflare's Cache API to cache responses:

```typescript
const cache = caches.default;
let response = await cache.match(request);

if (response) {
  const headers = new Headers(response.headers);
  headers.set('X-Cache-Status', 'HIT');
  return new Response(response.body, { status: response.status, headers });
}
```

The `X-Cache-Status` header indicates whether the response was served from cache (`HIT`) or generated fresh (`MISS`).

## Usage

Set a value:
```bash
curl -X POST http://localhost:8787/set \
  -H "Content-Type: application/json" \
  -d '{"key": "example", "value": "data"}'
```

Retrieve all values:
```bash
curl http://localhost:8787/
```

## Development

```bash
npm run dev      # Start local development server
npm run deploy   # Deploy to Cloudflare
npm run cf-typegen  # Regenerate TypeScript types
```
