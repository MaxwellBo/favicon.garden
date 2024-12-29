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
		let favicon: Response;

		try {
			favicon = await this.fetchFavicon(domain);
		} catch (e) {
			return new Response('Favicon not found', { status: 500 });
		}

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
	},

	async fetchFavicon(domain: string): Promise<Response> {
		const response = await fetch(`https://${domain}`);
		if (!response.ok) {
			throw new Error('Failed to fetch domain');
		}

		const text = await response.text();

		// Create a DOM parser and parse the HTML
		const parser = new DOMParser();
		const doc = parser.parseFromString(text, 'text/html');

		// Define the rel attributes we want to look for, in order of preference
		const relSelectors = [
			'link[rel="icon"]',
			'link[rel="shortcut icon"]',
			'link[rel="apple-touch-icon"]',
			'link[rel="apple-touch-icon-precomposed"]',
			'link[rel="fluid-icon"]',
			'link[rel="mask-icon"]'
		];

		// Try each selector
		for (const selector of relSelectors) {
			const linkElement = doc.querySelector(selector);
			if (linkElement && linkElement.getAttribute('href')) {
				let faviconUrl = linkElement.getAttribute('href')!;

				// Normalize URL
				try {
					// Try to construct a full URL using the base domain
					if (faviconUrl.startsWith('//')) {
						faviconUrl = 'https:' + faviconUrl;
					} else if (faviconUrl.startsWith('/')) {
						faviconUrl = `https://${domain}${faviconUrl}`;
					} else if (!faviconUrl.startsWith('http')) {
						faviconUrl = `https://${domain}/${faviconUrl}`;
					}

					// Try fetching this favicon
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

		// If we've tried all options including the default /favicon.ico and nothing worked
		throw new Error('No favicon found');
	}
}