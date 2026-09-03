const https = require('https');
const googlePlayScraper = require('google-play-scraper').default;
const { categoryFromPlayGenreId } = require('./appCategories');

const PLAY_HOST = 'play.google.com';
const MAX_SEARCH_BYTES = 2 * 1024 * 1024;
const MAX_DETAILS_BYTES = 2 * 1024 * 1024;
const MAX_RESULTS = 8;
const PACKAGE_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

function decodeHtml(value) {
  if (!value) return value;
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function validatePlayUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('invalid Google Play URL');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== PLAY_HOST) {
    throw new Error('unexpected Google Play redirect');
  }
  return parsed;
}

function fetchPlayHtml(rawUrl, maxBytes, redirectsLeft = 3) {
  const url = validatePlayUrl(rawUrl);
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      timeout: 10000,
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('too many Google Play redirects'));
        const next = new URL(res.headers.location, url).toString();
        try { validatePlayUrl(next); } catch (e) { return reject(e); }
        return fetchPlayHtml(next, maxBytes, redirectsLeft - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Google Play HTTP ${res.statusCode}`));
      }
      let total = 0;
      const chunks = [];
      res.on('data', chunk => {
        total += chunk.length;
        if (total > maxBytes) {
          req.destroy(new Error('Google Play response too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Google Play request timed out')));
    req.on('error', reject);
  });
}

function extractPackages(html) {
  const packages = [];
  const seen = new Set();
  const patterns = [
    /details\?id=([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)/g,
    /\/store\/apps\/details(?:\/[^?"'<>]*)?\?[^"'<>]*?\bid=([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)/g,
    /\/store\/apps\/details%3F[^"'<>]*?id%3D([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)/g,
    /id\\u003d([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) && packages.length < MAX_RESULTS) {
      const packageName = match[1];
      if (PACKAGE_NAME_REGEX.test(packageName) && !seen.has(packageName)) {
        seen.add(packageName);
        packages.push(packageName);
      }
    }
    if (packages.length >= MAX_RESULTS) break;
  }
  return packages;
}

function metaContent(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const a = new RegExp(`<meta[^>]*\\bproperty=["']${escaped}["'][^>]*\\bcontent=["']([^"']+)["']`, 'i');
  const b = new RegExp(`<meta[^>]*\\bcontent=["']([^"']+)["'][^>]*\\bproperty=["']${escaped}["']`, 'i');
  const match = html.match(a) || html.match(b);
  return match ? decodeHtml(match[1]) : null;
}

function cleanPlayTitle(title, packageName) {
  if (!title) return packageName;
  return title
    .replace(/\s*[-–]\s*(?:Apps on Google Play|אפליקציות ב-Google Play).*$/i, '')
    .trim() || packageName;
}

async function getPlayStoreApp(packageName) {
  if (!PACKAGE_NAME_REGEX.test(packageName)) throw new Error('invalid packageName');
  const url = `https://${PLAY_HOST}/store/apps/details?id=${encodeURIComponent(packageName)}&hl=he&gl=IL`;
  const html = await fetchPlayHtml(url, MAX_DETAILS_BYTES);
  const title = cleanPlayTitle(metaContent(html, 'og:title'), packageName);
  const iconUrl = metaContent(html, 'og:image');

  let playMetadata = null;
  try {
    playMetadata = await googlePlayScraper.app({
      appId: packageName,
      lang: 'he',
      country: 'il'
    });
  } catch (e) {
    console.warn(`[play-metadata] ${packageName}: ${e.message}`);
  }

  return {
    packageName,
    name: title.slice(0, 100),
    iconUrl: iconUrl || null,
    version: playMetadata?.version || null,
    updated: Number.isFinite(playMetadata?.updated) ? playMetadata.updated : null,
    // Best-effort initial category suggestion from Play's own genreId - null
    // when playMetadata itself failed to load (see the try/catch above) or
    // when its genre has no confident mapping (see appCategories.js). The
    // caller (db.addAppToCatalog) treats null as "no suggestion" and falls
    // back to the default category, never invents one here.
    category: categoryFromPlayGenreId(playMetadata?.genreId),
    playUrl: `https://${PLAY_HOST}/store/apps/details?id=${encodeURIComponent(packageName)}`,
  };
}

async function searchPlayStore(query) {
  const q = String(query || '').trim();
  if (q.length < 2 || q.length > 80) throw new Error('query must be 2-80 characters');
  const url = `https://${PLAY_HOST}/store/search?q=${encodeURIComponent(q)}&c=apps&hl=he&gl=IL`;
  const html = await fetchPlayHtml(url, MAX_SEARCH_BYTES);
  const packages = extractPackages(html);
  if (!packages.length) return [];

  const settled = await Promise.allSettled(packages.map(getPlayStoreApp));
  return settled
    .filter(item => item.status === 'fulfilled')
    .map(item => item.value)
    .slice(0, MAX_RESULTS);
}

module.exports = { searchPlayStore, getPlayStoreApp };
