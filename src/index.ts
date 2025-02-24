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
    let target = path.slice(1); // Remove leading slash
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
      // Normalize the target URL
      const normalizedTarget = normalizeUrl(target);
      favicon = await this.fetchFavicon(normalizedTarget);
    } catch (e: any) {
      return new Response('Favicon did not download: ' + e.message + "\n" + e.stack, { status: 500 });
    }

    if (!favicon.body) {
      return new Response('Request to favicon had no body', { status: 500 });
    }

    if (!favicon.headers.get('Content-Type')) {
      return new Response('Request to favicon had no Content-Type header', { status: 500 });
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
    // First try to fetch the page at the exact URL to get its favicon
    try {
      const response = await fetch(target, {
        headers: {
          'User-Agent': BROWSER_USER_AGENT
        },
        redirect: 'follow' // Follow redirects to get the final URL
      });

      if (response.ok) {
        const text = await response.text();
        // Try to find favicon in the HTML first
        for (const pattern of PATTERNS) {
          const match = text.match(pattern);
          if (match && match[1]) {
            let faviconUrl = match[1];
            try {
              // Important: Use response.url instead of target to get the final URL after redirects
              // This ensures relative paths are resolved against the correct base URL
              const baseUrl = new URL(response.url);
              const resolvedUrl = new URL(faviconUrl, baseUrl.href);
              
              console.log('Resolving favicon URL:', {
                original: faviconUrl,
                baseUrl: baseUrl.href,
                resolved: resolvedUrl.href
              });

              const faviconResponse = await fetch(resolvedUrl.href, {
                headers: {
                  'User-Agent': BROWSER_USER_AGENT
                }
              });

              if (faviconResponse.ok && isIcon(faviconResponse)) {
                // Clone the response before consuming it
                const clonedResponse = faviconResponse.clone();
                console.log('Found favicon:', {
                  url: resolvedUrl.href,
                  contentType: clonedResponse.headers.get('Content-Type')
                });
                return faviconResponse;
              }
            } catch (e: any) {
              console.log('Failed to fetch favicon from ' + faviconUrl + ': ' + e.message);
              continue;
            }
          }
        }
      }
    } catch (e: any) {
      console.log('Failed to fetch page at ' + target + ': ' + e.message);
    }

    // If we couldn't get a favicon from the exact URL, try the domain's favicon.ico
    try {
      const url = new URL(target);
      const faviconUrl = new URL('/favicon.ico', url.origin).href;
      console.log('Trying fallback favicon.ico:', faviconUrl);
      
      const faviconResponse = await fetch(faviconUrl, {
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
        }
      });
      
      if (faviconResponse.ok && isIcon(faviconResponse)) {
        return faviconResponse;
      }
    } catch (e: any) {
      console.log('Failed to fetch favicon.ico: ' + e.message);
    }

    throw new Error('Could not find favicon for ' + target);
  }
}