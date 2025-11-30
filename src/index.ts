/**
 * Cloudflare Worker with KV store, rate limiting, and caching
 *
 * Bindings used:
 * - env.KV_STORE: KV namespace for storing key-value pairs
 * - env.RATE_LIMITER: Rate limiting binding (configured in wrangler.jsonc)
 * - caches.default: Cloudflare Cache API for caching GET responses
 *
 * Environment variables:
 * - env.RATE_LIMIT_PER_MINUTE: Rate limit threshold (default: 10)
 */

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// GET / - List all KV values with caching
		if (request.method === 'GET' && path === '/') {
			/**
			 * Cache API Usage:
			 * Uses Cloudflare's Cache API (caches.default) to cache responses
			 * for 60 seconds. Adds X-Cache-Status header to indicate HIT/MISS.
			 */
			const cache = caches.default;
			let response = await cache.match(request);

			if (response) {
				// Add header to indicate cache hit
				const headers = new Headers(response.headers);
				headers.set('X-Cache-Status', 'HIT');
				return new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers,
				});
			}

			// Fetch all keys from KV
			const list = await env.KV_STORE.list();
			const kvData: Record<string, string> = {};

			for (const key of list.keys) {
				const value = await env.KV_STORE.get(key.name);
				if (value !== null) {
					kvData[key.name] = value;
				}
			}

			response = new Response(JSON.stringify(kvData, null, 2), {
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'public, max-age=60', // Cache for 60 seconds
					'X-Cache-Status': 'MISS',
				},
			});

			// Store in cache
			ctx.waitUntil(cache.put(request, response.clone()));

			return response;
		}

		// POST /set - Set KV value with rate limiting
		if (request.method === 'POST' && path === '/set') {
			/**
			 * Rate Limiting Usage:
			 * Uses Cloudflare's Rate Limiting API (env.RATE_LIMITER) to limit
			 * requests per IP address. Configuration in wrangler.jsonc sets
			 * limit to 10 requests per 60 seconds per unique IP.
			 */
			// Get client IP
			const ip = request.headers.get('CF-Connecting-IP') ||
			           request.headers.get('X-Forwarded-For') ||
			           'unknown';

			// Check rate limit using Cloudflare Rate Limiting API
			const rateLimitResult = await env.RATE_LIMITER.limit({ key: ip });

			if (!rateLimitResult.success) {
				return new Response(
					JSON.stringify({
						error: 'Rate limit exceeded',
						message: 'Too many requests. Please try again later.',
					}),
					{
						status: 429,
						headers: {
							'Content-Type': 'application/json',
							'Retry-After': '60',
						},
					}
				);
			}

			// Parse request body
			let body;
			try {
				body = await request.json();
			} catch (e) {
				return new Response(
					JSON.stringify({ error: 'Invalid JSON in request body' }),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}

			const { key, value } = body as { key?: string; value?: string };

			if (!key || !value) {
				return new Response(
					JSON.stringify({
						error: 'Missing required fields',
						message: 'Request must include "key" and "value" fields',
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}

			// Store in KV
			await env.KV_STORE.put(key, value);

			return new Response(
				JSON.stringify({
					success: true,
					key,
					value,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// 404 for other routes
		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
