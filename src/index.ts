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

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36';

const CACHE_POLICY = 'public, max-age=604800, stale-while-revalidate=86400';

const PATTERNS = [
  /<link[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["'][^>]*>/i,
  /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:icon|shortcut icon)["'][^>]*>/i,
  /<link[^>]*rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*href=["']([^"']+)["'][^>]*>/i,
  /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*>/i,
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

function isIcon(response: Response): boolean {
  const contentType = response.headers.get('Content-Type');
  return contentType !== null && (contentType.includes('image') || contentType.includes('icon'));
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
    const bucketPath = encodeURIComponent(target);

    const object = await env.FAVICON_GARDEN_BUCKET.get(bucketPath);

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

    if (!favicon.body) {
      return new Response('Request to favicon had no body', { status: 500 });
    }

    const [body1, body2] = favicon.body.tee();

    try {
      await env.FAVICON_GARDEN_BUCKET.put(bucketPath, body1, {
        httpMetadata: {
          contentType: favicon.headers.get('Content-Type') as string
        }
      });
    } catch (e: any) {
      console.error('Failed to store favicon in bucket: ' + e.message + "\n" + e.stack);
    }

    const headers: HeadersInit = {
      'Cache-Control': CACHE_POLICY,
      'Access-Control-Allow-Origin': '*'
    }
    if (favicon.headers.get('Content-Type')) {
      headers['Content-Type'] = favicon.headers.get('Content-Type') as string;
    }

    const response = new Response(body2, { headers });
    await cache.put(request, response.clone());
    return response;
  },

  async fetchFavicon(target: string): Promise<Response> {
    const faviconUrl = new URL('/favicon.ico', target).href;
    const faviconResponse = await fetch(faviconUrl, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
      }
    });
    if (faviconResponse.ok) {
      if (isIcon(faviconResponse)) {
        return faviconResponse;
      } else {
        console.error(`Favicon.ico from ${target} is not an icon`);
      }
    } else {
      console.error(`Failed to fetch favicon.ico from ${target}: ${faviconResponse.status} ${faviconResponse.statusText}`);
    }

    const response = await fetch(target, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT
      }
    });
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
          // First try to construct the full URL assuming it's relative
          try {
            faviconUrl = new URL(faviconUrl, target).href;
          } catch {
            // If that fails, try parsing it as an absolute URL
            faviconUrl = new URL(faviconUrl).href;
          }
    
          const faviconResponse = await fetch(faviconUrl, {
            headers: {
              'User-Agent': BROWSER_USER_AGENT
            }
          });

          if (faviconResponse.ok) {
            if (isIcon(faviconResponse)) {
              return faviconResponse;
            } else {
              throw new Error(`Favicon from ${faviconUrl} is not an icon`);
            }
          }
        } catch (e: any) {
          console.log('Failed to fetch favicon from ' + faviconUrl + ': ' + e.message);
          continue;
        }
      }
    }

    throw new Error('Exhausted all Regex patterns and common paths to find favicon');
  }
}