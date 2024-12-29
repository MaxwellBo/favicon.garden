/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

interface Env {
  FAVICON_GARDEN_BUCKET: R2Bucket;
}

type FaviconResponse = Response | null;

const CACHE_POLICY = 'public, max-age=604800, stale-while-revalidate=86400';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const domain = path.slice(1); // Remove leading slash
    const cache = caches.default;

    // Try cache
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

		const object = await env.FAVICON_GARDEN_BUCKET.get(`favicons/${domain}`);
		
		if (object) {
			const headers: HeadersInit = { 
				'Access-Control-Allow-Origin': '*',
				'Cache-Control': CACHE_POLICY
			};
			if (object.httpMetadata?.contentType) {
				headers['Content-Type'] = object.httpMetadata.contentType;
			}

			const response = new Response(object.body, { headers });
			await cache.put(request, response.clone());
			return response;
		}

		// Try origin
		const favicon = await this.fetchFavicon(domain);
		
		if (favicon) {
			await env.FAVICON_GARDEN_BUCKET.put(`favicons/${domain}`, favicon.body);

			const headers: HeadersInit = {
				'Cache-Control': CACHE_POLICY,
				'Access-Control-Allow-Origin': '*'
			}
			if (favicon.headers.get('Content-Type')) {
				headers['Content-Type'] = favicon.headers.get('Content-Type') as string;
			}

			const response = new Response(favicon.body, { headers });
			await cache.put(request, response.clone());
			return response;
		}

		return new Response('Favicon not found', { status: 404 });
  },

	async fetchFavicon(domain: string): Promise<FaviconResponse> {
		const response = await fetch(`https://${domain}`);
		const text = await response.text();

		// Try all favicon-related link tags
		const linkRegexes = [
			/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*>/i,
			/<link[^>]*rel=["']apple-touch-icon["'][^>]*>/i,
			/<link[^>]*rel=["']apple-touch-icon-precomposed["'][^>]*>/i,
			/<link[^>]*rel=["']fluid-icon["'][^>]*>/i,
			/<link[^>]*rel=["']mask-icon["'][^>]*>/i
		];

		for (const regex of linkRegexes) {
			const match = text.match(regex);
			if (match) {
				const hrefMatch = match[0].match(/href=["']([^"']+)["']/i);
				if (hrefMatch) {
					let faviconUrl = hrefMatch[1];
					
					// Normalize URL
					if (faviconUrl.startsWith('//')) {
						faviconUrl = 'https:' + faviconUrl;
					} else if (faviconUrl.startsWith('/')) {
						faviconUrl = `https://${domain}${faviconUrl}`;
					} else if (!faviconUrl.startsWith('http')) {
						faviconUrl = `https://${domain}/${faviconUrl}`;
					}

					// Try fetching this favicon
					try {
						const faviconResponse = await fetch(faviconUrl);
						if (faviconResponse.ok) {
							return faviconResponse;
						}
					} catch (e) {
						// Continue to next possibility
						continue;
					}
				}
			}
		}

		return null;
	}
}