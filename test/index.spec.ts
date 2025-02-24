// test/index.spec.ts
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

describe('favicon.garden service', () => {
	describe('HTML pages', () => {
		it('serves the main page', async () => {
			const response = await SELF.fetch('https://favicon.garden/');
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toContain('text/html');
			const text = await response.text();
			expect(text).toContain('favicon.garden');
			expect(text).toContain('is a favicon API and cache');
		});

		it('serves the test page', async () => {
			const response = await SELF.fetch('https://favicon.garden/test.html');
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toContain('text/html');
			const text = await response.text();
			expect(text).toContain('Social Media');
			expect(text).toContain('Tech Companies');
		});
	});

	describe('Favicon fetching', () => {
		it('fetches favicon with bare domain', async () => {
			const response = await SELF.fetch('https://favicon.garden/google.com');
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toMatch(/^image\//);
			expect(response.headers.get('cache-control')).toBeTruthy();
		});

		it('fetches favicon with www prefix', async () => {
			const response = await SELF.fetch('https://favicon.garden/www.google.com');
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toMatch(/^image\//);
		});

		it('fetches favicon with explicit https protocol', async () => {
			const response = await SELF.fetch('https://favicon.garden/https://google.com');
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toMatch(/^image\//);
		});

		it('handles non-existent domains', async () => {
			const response = await SELF.fetch('https://favicon.garden/this-domain-definitely-does-not-exist.com');
			expect(response.status).toBe(500);
		});

		it('handles invalid URLs', async () => {
			const response = await SELF.fetch('https://favicon.garden/not@valid@url');
			expect(response.status).toBe(500);
		});
	});

	describe('Path-based favicon fetching', () => {
		it('fetches favicon for subdirectory paths', async () => {
			const response = await SELF.fetch('https://favicon.garden/maxbo.me/html-in-hyde');
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toMatch(/^image\//);
			
			const baseDomainResponse = await SELF.fetch('https://favicon.garden/maxbo.me');
			expect(baseDomainResponse.status).toBe(200);
			expect(baseDomainResponse.headers.get('content-type')).toMatch(/^image\//);
			
			const pathFavicon = await response.arrayBuffer();
			const baseFavicon = await baseDomainResponse.arrayBuffer();
			
			expect(Buffer.from(pathFavicon).toString('base64'))
				.not.toBe(Buffer.from(baseFavicon).toString('base64'));
		});

		it('fetches favicon for subdirectory paths with www prefix', async () => {
			const response = await SELF.fetch('https://favicon.garden/www.maxbo.me/html-in-hyde');
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toMatch(/^image\//);
			
			const baseDomainResponse = await SELF.fetch('https://favicon.garden/www.maxbo.me');
			const pathFavicon = await response.arrayBuffer();
			const baseFavicon = await baseDomainResponse.arrayBuffer();
			
			expect(Buffer.from(pathFavicon).toString('base64'))
				.not.toBe(Buffer.from(baseFavicon).toString('base64'));
		});

		it('fetches favicon for subdirectory paths with https protocol', async () => {
			const response = await SELF.fetch('https://favicon.garden/https://maxbo.me/html-in-hyde');
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toMatch(/^image\//);
			
			const baseDomainResponse = await SELF.fetch('https://favicon.garden/https://maxbo.me');
			const pathFavicon = await response.arrayBuffer();
			const baseFavicon = await baseDomainResponse.arrayBuffer();
			
			expect(Buffer.from(pathFavicon).toString('base64'))
				.not.toBe(Buffer.from(baseFavicon).toString('base64'));
		});

		it('handles multiple path segments', async () => {
			const response = await SELF.fetch('https://favicon.garden/github.com/MaxwellBo/favicon.garden');
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toMatch(/^image\//);
			
			const baseDomainResponse = await SELF.fetch('https://favicon.garden/github.com');
			const pathFavicon = await response.arrayBuffer();
			const baseFavicon = await baseDomainResponse.arrayBuffer();
			
			expect(Buffer.from(pathFavicon).toString('base64'))
				.not.toBe(Buffer.from(baseFavicon).toString('base64'));
		});
	});

	describe('Integration style tests', () => {
		it('fetches popular website favicons', async () => {
			const popularSites = [
				'github.com',
				'facebook.com',
				'twitter.com',
				'linkedin.com'
			];

			for (const site of popularSites) {
				const response = await SELF.fetch(`https://favicon.garden/${site}`);
				expect(response.status).toBe(200);
				expect(response.headers.get('content-type')).toMatch(/^image\//);
			}
		});

		it('handles redirects properly', async () => {
			const response = await SELF.fetch('https://favicon.garden/www.github.com');
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toMatch(/^image\//);
		});
	});

	describe('Headers and caching', () => {
		it('sets appropriate cache headers', async () => {
			const response = await SELF.fetch('https://favicon.garden/google.com');
			expect(response.headers.get('cache-control')).toBeTruthy();
		});

		it('respects conditional requests', async () => {
			const firstResponse = await SELF.fetch('https://favicon.garden/google.com');
			const etag = firstResponse.headers.get('etag');

			if (!etag) {
				return;
			}

			const secondResponse = await SELF.fetch('https://favicon.garden/google.com', {
				headers: { 'If-None-Match': etag }
			});
			
			expect(secondResponse.status).toBe(200);
		});
	});
});
