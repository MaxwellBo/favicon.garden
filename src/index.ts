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
    } catch (e: any) {
      return new Response('Favicon did not download: ' + e.message, { status: 500 });
    }


    // https://community.cloudflare.com/t/storing-r2-object-throws-an-error-for-some-readable-streams/387487/2
    let body: ReadableStream | string | null;
    if (favicon.headers.get('content-length') == null) {
        body = await favicon.text()
    } else {
        body = favicon.body
    }

    if (!body) {
      return new Response('no favicon body', { status: 500 });
    }

    await env.FAVICON_GARDEN_BUCKET.put(`favicons/${domain}`, favicon.body, {
      httpMetadata: {
        contentType: favicon.headers.get('Content-Type') as string
      }
    });

    const headers: HeadersInit = {
      'Cache-Control': CACHE_POLICY,
      'Access-Control-Allow-Origin': '*'
    }
    if (favicon.headers.get('Content-Type')) {
      headers['Content-Type'] = favicon.headers.get('Content-Type') as string;
    }

    const response = new Response(body, { headers });
    await cache.put(request, response.clone());
    return response;
  },

  async fetchFavicon(domain: string): Promise<Response> {
    const response = await fetch(`https://${domain}`);
    if (!response.ok) {
      throw new Error('Failed to fetch domain');
    }

    const text = await response.text();

    // Define regex patterns for different link types in order of preference
    const patterns = [
      /<link[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["'][^>]*>/i,
      /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:icon|shortcut icon)["'][^>]*>/i,
      /<link[^>]*rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*href=["']([^"']+)["'][^>]*>/i,
      /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*>/i,
      /<link[^>]*rel=["'](?:fluid-icon|mask-icon)["'][^>]*href=["']([^"']+)["'][^>]*>/i,
      /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:fluid-icon|mask-icon)["'][^>]*>/i
    ];

    // Try each pattern
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        let faviconUrl = match[1];

        // Normalize URL
        try {
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

    // Try the default favicon.ico as a last resort
    try {
      const defaultFaviconResponse = await fetch(`https://${domain}/favicon.ico`);
      if (defaultFaviconResponse.ok) {
        return defaultFaviconResponse;
      }
    } catch (e) {
      // Ignore error and continue to throw
    }

    throw new Error('Exhausted');
  }
}