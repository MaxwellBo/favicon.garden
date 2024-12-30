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

const PATTERNS = [
  /<link[^>]*rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*href=["']([^"']+)["'][^>]*>/i,
  /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*>/i,
  /<link[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["'][^>]*>/i,
  /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:icon|shortcut icon)["'][^>]*>/i,
  /<link[^>]*rel=["'](?:fluid-icon|mask-icon)["'][^>]*href=["']([^"']+)["'][^>]*>/i,
  /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:fluid-icon|mask-icon)["'][^>]*>/i
];


function normalizeUrl(url: string): string {
  try {
    new URL(url);
    return url; // URL is already valid
  } catch {
    // If URL construction fails, try prepending https://
    try {
      return new URL(`https://${url}`).toString();
    } catch {
      throw new Error('Invalid URL even with https:// prefix');
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cache = caches.default;

    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    const url = new URL(request.url);
    const path = url.pathname;
    let target = normalizeUrl(path.slice(1)); // Remove leading slash

    const object = await env.FAVICON_GARDEN_BUCKET.get(`favicons/${target}`);

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
      favicon = await this.fetchFavicon(target);
    } catch (e: any) {
      return new Response('Favicon did not download: ' + e.message + "\n" + e.stack, { status: 500 });
    }

    // have to .text() out the body because we can't stream if we don't have content-length
    // https://community.cloudflare.com/t/storing-r2-object-throws-an-error-for-some-readable-streams/387487/2
    const body = await favicon.text();

    if (!body) {
      return new Response('Request to favicon had no body', { status: 500 });
    }

    await env.FAVICON_GARDEN_BUCKET.put(`favicons/${target}`, body, {
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

  async fetchFavicon(target: string): Promise<Response> {
    const faviconUrl = new URL('/favicon.ico', target).href;
    const faviconResponse = await fetch(faviconUrl);
    if (faviconResponse.ok) {
      return faviconResponse;
    } else {
      console.error(`Failed to fetch favicon.ico from ${target}: ${faviconResponse.status} ${faviconResponse.statusText}`);
    }

    const response = await fetch(target);
    if (!response.ok) {
      throw new Error(`Failed to fetch HTML page ${target}: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();

    // Define regex patterns for different link types in order of preference

    // Try each pattern
    for (const pattern of PATTERNS) {
      const match = text.match(pattern);
      if (match && match[1]) {
        let faviconUrl = match[1];

        // Normalize URL
        try {
          // figure out whether the the favicon URL is relative or absolute
          const url = new URL(faviconUrl);
          if (!url.host) {
            // If relative, construct full URL
            faviconUrl = new URL(faviconUrl, target).href;
          }

          const faviconResponse = await fetch(faviconUrl);
          if (faviconResponse.ok) {
            return faviconResponse;
          }
        } catch (e) {
          continue;
        }
      }
    }

    throw new Error('Exhausted all Regex patterns and common paths to find favicon');
  }
}