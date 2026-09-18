'use strict';

const { URL } = require('url');
const browserClassifier = require('./browserClassifier');

const SEARCH_TIMEOUT_MS = 8000;
const MAX_RESULTS = 5;
const MAX_QUERY_LENGTH = 120;

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeResultHref(rawHref) {
  const href = decodeHtml(rawHref).trim();
  if (!href) return null;

  let candidate = href;
  try {
    if (candidate.startsWith('//')) candidate = 'https:' + candidate;
    const parsed = new URL(candidate);
    if (parsed.hostname === 'duckduckgo.com' || parsed.hostname.endsWith('.duckduckgo.com')) {
      const redirected = parsed.searchParams.get('uddg');
      if (!redirected) return null;
      candidate = redirected;
    }
  } catch {
    return null;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== '443') return null;

    const host = browserClassifier.normalizeHost(url.hostname);
    if (!host) return null;

    return {
      host,
      url: 'https://' + host + '/',
    };
  } catch {
    return null;
  }
}

function parseDuckDuckGoHtml(html) {
  const results = [];
  const seen = new Set();
  const anchorRe = /<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(String(html || ''))) && results.length < MAX_RESULTS) {
    const normalized = normalizeResultHref(match[1]);
    if (!normalized || seen.has(normalized.host)) continue;
    const title = stripTags(match[2]) || normalized.host;
    seen.add(normalized.host);
    results.push({ title: title.slice(0, 200), ...normalized });
  }
  return results;
}

async function searchSites(rawQuery, fetchImpl = fetch) {
  const query = String(rawQuery || '').trim().replace(/\s+/g, ' ');
  if (!query || query.length > MAX_QUERY_LENGTH) {
    const error = new Error('invalid_query');
    error.status = 400;
    throw error;
  }

  let response;
  try {
    response = await fetchImpl('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
      method: 'GET',
      headers: {
        Accept: 'text/html',
        'User-Agent': 'Mozilla/5.0 (compatible; YehudiKasherAdmin/1.0)',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
  } catch {
    const error = new Error('site_search_unavailable');
    error.status = 503;
    throw error;
  }

  if (!response.ok) {
    const error = new Error('site_search_http_' + response.status);
    error.status = 503;
    throw error;
  }

  const html = await response.text();
  return parseDuckDuckGoHtml(html);
}

module.exports = {
  MAX_QUERY_LENGTH,
  parseDuckDuckGoHtml,
  normalizeResultHref,
  searchSites,
};
