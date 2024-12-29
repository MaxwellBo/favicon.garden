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

    // Handle documentation route
    if (path === '/') {
      return this.handleDocs(request);
    }

    return this.handleFaviconRequest(request, env, path);
  },

  async handleDocs(request: Request): Promise<Response> {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Favicon Garden - Simple Favicon API</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
          }
          .container { 
            margin: 2rem auto; 
          }
          pre {
            background: #f6f8fa;
            padding: 1rem;
            border-radius: 4px;
            overflow-x: auto;
          }
          code {
            font-family: Monaco, "Courier New", monospace;
            font-size: 0.9em;
          }
          .example {
            background: #fff;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 1rem;
            margin: 1rem 0;
          }
          .example img {
            vertical-align: middle;
            margin-right: 0.5rem;
          }
          h1, h2 { 
            border-bottom: 2px solid #eaecef;
            padding-bottom: 0.3em;
          }
          .header {
            text-align: center;
            margin-bottom: 2rem;
          }
          .logo {
            font-size: 2.5em;
            font-weight: bold;
            margin-bottom: 0.5rem;
          }
          .tagline {
            color: #666;
            font-size: 1.2em;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo">🌱 Favicon Garden</div>
          <div class="tagline">Simple, Fast, Free Favicon API</div>
        </div>

        <div class="container">
          <h2>Quick Start</h2>
          <p>Get a website's favicon with a simple GET request:</p>
          <pre><code>https://favicon.garden/www.google.com</code></pre>

          <h2>Live Examples</h2>
          <div class="example">
            <img src="/google.com" alt="Google Favicon" height="16" width="16">
            <code>favicon.garden/google.com</code>
          </div>
          <div class="example">
            <img src="/github.com" alt="GitHub Favicon" height="16" width="16">
            <code>favicon.garden/github.com</code>
          </div>

          <h2>Features</h2>
          <ul>
            <li>💸 Completely Free</li>
            <li>🚀 Fast global CDN delivery</li>
            <li>🔄 Automatic updates</li>
            <li>🌐 Cross-origin enabled</li>
            <li>🖼️ PNG/ICO support</li>
          </ul>

          <h2>Error Handling</h2>
          <p>If a favicon cannot be found, a 404 response will be returned.</p>
          <p>For other errors, appropriate HTTP status codes will be returned with error messages.</p>

          <h2>Support</h2>
          <p>For issues or feature requests, please email support@favicon.garden</p>
        </div>
      </body>
      </html>
    `;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  },

  async handleFaviconRequest(request: Request, env: Env, path: string): Promise<Response> {
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