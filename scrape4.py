# /// script
# dependencies = [
#     "aiohttp",
#     "tldextract",
#     "uvloop",
#     "beautifulsoup4",
# ]
# ///

import asyncio
import uvloop
import aiohttp
import os
import tldextract
import json
import urllib.parse
from bs4 import BeautifulSoup
from collections import deque

# Use uvloop for higher performance
asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())

FAVICON_DIR = 'favicons'
VISITED_URLS_FILE = 'visited_urls.txt'
URL_QUEUE_FILE = 'url_queue.txt'

# Ensure the favicon directory exists
os.makedirs(FAVICON_DIR, exist_ok=True)

def load_state():
    """
    Load the visited domains set and the queue of URLs from disk.
    Returns (visited_domains, queue_of_urls).
    """
    # Load visited domains
    if os.path.exists(VISITED_URLS_FILE):
        with open(VISITED_URLS_FILE, 'r') as f:
            visited_domains = set(json.load(f))
    else:
        visited_domains = set()

    # Load URL queue
    if os.path.exists(URL_QUEUE_FILE):
        with open(URL_QUEUE_FILE, 'r') as f:
            queue_list = json.load(f)
            url_queue = deque(queue_list)
    else:
        # Some seed URLs to kick off the crawling
        url_queue = deque([
            'http://example.com',
            'http://google.com',
            'http://github.com',
            'http://facebook.com',
            'http://twitter.com',
            'http://reddit.com',
            'http://stackoverflow.com',
            'http://wikipedia.org',
            'http://linkedin.com',
            'http://amazon.com',
        ])
        visited_domains = set()

    return visited_domains, url_queue

def save_state(visited_domains, url_queue):
    """
    Save visited domains set and the queue of URLs to disk.
    """
    with open(VISITED_URLS_FILE, 'w') as f:
        json.dump(list(visited_domains), f)
    with open(URL_QUEUE_FILE, 'w') as f:
        json.dump(list(url_queue), f)

def get_domain(url: str) -> str:
    """
    Returns the domain (e.g., 'example.com') from a given URL.
    """
    extract = tldextract.extract(url)
    domain = f"{extract.domain}.{extract.suffix}" if extract.suffix else extract.domain
    return domain.lower()

async def download_favicon(session, domain):
    """
    Attempt to download the favicon from http://<domain>/favicon.ico and save it to disk.
    """
    favicon_url = f"http://{domain}/favicon.ico"
    try:
        async with session.get(favicon_url) as response:
            if response.status == 200:
                content_type = response.headers.get('content-type', '')
                if 'image' in content_type:
                    filepath = os.path.join(FAVICON_DIR, f"{domain}.ico")
                    with open(filepath, 'wb') as f:
                        f.write(await response.read())
                    print(f"[+] Downloaded favicon for {domain}")
    except Exception as e:
        print(f"[-] Error downloading favicon from {domain}: {e}")

async def process_url(session, url, visited_domains, url_queue):
    """
    Given a URL:
      1) Extract its domain.
      2) If the domain is not visited, download its favicon.
      3) Request the page, parse all hyperlinks, and enqueue them.
    """
    domain = get_domain(url)
    # If we've already visited this domain, skip further processing
    if domain in visited_domains:
        return

    # Mark domain as visited
    visited_domains.add(domain)

    # Download the favicon (http://domain/favicon.ico)
    await download_favicon(session, domain)

    # Attempt to retrieve the HTML to discover more links
    try:
        async with session.get(url, timeout=10) as response:
            if response.status == 200:
                html = await response.text()
                # Parse links
                soup = BeautifulSoup(html, 'html.parser')
                for link_tag in soup.find_all('a', href=True):
                    link = link_tag['href']
                    # Basic normalizing: skip mailto, javascript, etc.
                    if link.startswith(('mailto:', 'javascript:', '#')):
                        continue
                    # Convert relative links to absolute URLs
                    absolute_link = urllib.parse.urljoin(str(response.url), link)
                    # Enqueue newly found link
                    url_queue.append(absolute_link)
    except Exception as e:
        # Many sites block crawlers or have various errors
        print(f"[-] Error fetching page {url}: {e}")

async def main():
    visited_domains, url_queue = load_state()

    async with aiohttp.ClientSession() as session:
        while True:
            if not url_queue:
                print("[!] URL queue is empty. Sleeping for 60 seconds.")
                save_state(visited_domains, url_queue)
                await asyncio.sleep(60)
                continue

            # Dequeue an URL
            current_url = url_queue.popleft()

            # Process the current URL
            await process_url(session, current_url, visited_domains, url_queue)

            # Periodically save state
            if len(visited_domains) % 10 == 0:
                save_state(visited_domains, url_queue)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[!] Crawler interrupted by user.")
        sys.exit(0)
