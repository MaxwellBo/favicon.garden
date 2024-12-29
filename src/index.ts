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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const domain = path.slice(1); // Remove leading slash
    const cacheKey = new Request(request.url);
    const cache = caches.default;

    // Try cache first
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Try R2
    try {
      const object = await env.FAVICON_GARDEN_BUCKET.get(`favicons/${domain}`);
      
      if (object) {
        const response = new Response(object.body, {
          headers: {
            'Content-Type': 'image/x-icon',
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*'
          }
        });
        
        await cache.put(cacheKey, response.clone());
        return response;
      }

      // Favicon not in R2, fetch from origin
      const favicon = await this.fetchFavicon(domain);
      
      if (favicon) {
        // Store in R2
        await env.FAVICON_GARDEN_BUCKET.put(`favicons/${domain}`, favicon.body);
        
        const response = new Response(favicon.body, {
          headers: {
            'Content-Type': 'image/x-icon',
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*'
          }
        });
        
        await cache.put(cacheKey, response.clone());
        return response;
      }

      return new Response('Favicon not found', { status: 404 });
    } catch (error) {
      return new Response('Error fetching favicon', { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  },

  async fetchFavicon(domain: string): Promise<FaviconResponse> {
    try {
      const response = await fetch(`https://${domain}`);
      if (!response.ok) return null;

      const text = await response.text();
      const match = text.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*>/i);
      if (!match) return null;

      const hrefMatch = match[0].match(/href=["']([^"']+)["']/i);
      if (!hrefMatch) return null;

      let faviconUrl = hrefMatch[1];
      if (faviconUrl.startsWith('//')) {
        faviconUrl = 'https:' + faviconUrl;
      } else if (faviconUrl.startsWith('/')) {
        faviconUrl = `https://${domain}${faviconUrl}`;
      } else if (!faviconUrl.startsWith('http')) {
        faviconUrl = `https://${domain}/${faviconUrl}`;
      }

      const faviconResponse = await fetch(faviconUrl);
      if (faviconResponse.ok) {
        return faviconResponse;
      }
    } catch (e) {
      return null;
    }

    return null;
  }
};