'use strict';

const { domainToASCII } = require('url');

// Strict allow-by-category. A site is never allowed merely because it was not
// found on a blocklist: at least one high-confidence IAB category must be
// present, and every high-confidence parent category returned for the site
// must be in this conservative allow set.
const SAFE_IAB_PARENTS = new Set([
  'IAB2',  // Automotive
  'IAB3',  // Business
  'IAB4',  // Careers
  'IAB5',  // Education
  'IAB8',  // Food & Drink
  'IAB10', // Home & Garden
  'IAB15', // Science
  'IAB19', // Technology & Computing
  'IAB20', // Travel
  'IAB21', // Real Estate
]);

const MIN_CONFIDENCE_SCORE = 0.80;
const ALLOW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BLOCK_TTL_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_TTL_MS = 10 * 60 * 1000;

function normalizeHost(raw) {
  if (typeof raw !== 'string') return null;
  const input = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!input || input.length > 253 || input.includes('/') || input.includes(':')) return null;

  const ascii = domainToASCII(input).toLowerCase();
  if (!ascii || ascii.length > 253) return null;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(ascii)) {
    return null;
  }
  // Never classify literal IPv4 addresses as "safe websites".
  const parts = ascii.split('.');
  if (parts.length === 4 && parts.every(p => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255)) {
    return null;
  }
  return ascii;
}

function evaluateCategoryPayload(payload) {
  const categories = payload && payload.data && payload.data[0] && payload.data[0].categories;
  if (!Array.isArray(categories)) {
    return {
      allowed: false,
      reason: 'classification_missing',
      categories: [],
      ttlMs: TRANSIENT_TTL_MS,
    };
  }

  const confident = categories
    .map(item => ({
      id: typeof item.id === 'string' ? item.id : '',
      parent: typeof item.parent === 'string' ? item.parent : '',
      label: typeof item.label === 'string' ? item.label : '',
      confident: item.confident === true,
      score: Number(item.score),
    }))
    .filter(item =>
      item.confident &&
      Number.isFinite(item.score) &&
      item.score >= MIN_CONFIDENCE_SCORE &&
      /^IAB\d+/.test(item.parent || item.id)
    );

  if (!confident.length) {
    return {
      allowed: false,
      reason: 'classification_not_confident',
      categories: categories.slice(0, 10),
      ttlMs: BLOCK_TTL_MS,
    };
  }

  const parents = [...new Set(confident.map(item => item.parent || item.id.split('-')[0]))];
  const allowed = parents.every(parent => SAFE_IAB_PARENTS.has(parent));

  return {
    allowed,
    reason: allowed ? 'safe_category' : 'category_not_allowed',
    categories: confident,
    ttlMs: allowed ? ALLOW_TTL_MS : BLOCK_TTL_MS,
  };
}

function credentialsConfigured() {
  return Boolean(process.env.WEBSHRINKER_ACCESS_KEY && process.env.WEBSHRINKER_SECRET_KEY);
}

async function classifyHost(rawHost, fetchImpl = fetch) {
  const host = normalizeHost(rawHost);
  if (!host) {
    return {
      host: null,
      allowed: false,
      reason: 'invalid_host',
      categories: [],
      ttlMs: BLOCK_TTL_MS,
      source: 'local_validation',
    };
  }

  if (!credentialsConfigured()) {
    return {
      host,
      allowed: false,
      reason: 'classifier_not_configured',
      categories: [],
      ttlMs: TRANSIENT_TTL_MS,
      source: 'webshrinker',
    };
  }

  const target = Buffer.from('https://' + host + '/', 'utf8').toString('base64url');
  const auth = Buffer.from(
    process.env.WEBSHRINKER_ACCESS_KEY + ':' + process.env.WEBSHRINKER_SECRET_KEY,
    'utf8',
  ).toString('base64');

  let response;
  try {
    response = await fetchImpl(
      'https://api.webshrinker.com/categories/v3/' + target + '?taxonomy=iabv1',
      {
        method: 'GET',
        headers: {
          Authorization: 'Basic ' + auth,
          Accept: 'application/json',
          'User-Agent': 'android-mdm-system-browser-filter',
        },
        signal: AbortSignal.timeout(8000),
      },
    );
  } catch (e) {
    return {
      host,
      allowed: false,
      reason: 'classifier_unreachable',
      categories: [],
      ttlMs: TRANSIENT_TTL_MS,
      source: 'webshrinker',
    };
  }

  if (response.status === 202 || response.status === 429 || response.status >= 500) {
    return {
      host,
      allowed: false,
      reason: 'classifier_pending_or_unavailable',
      categories: [],
      ttlMs: TRANSIENT_TTL_MS,
      source: 'webshrinker',
    };
  }

  if (!response.ok) {
    return {
      host,
      allowed: false,
      reason: 'classifier_error_' + response.status,
      categories: [],
      ttlMs: TRANSIENT_TTL_MS,
      source: 'webshrinker',
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return {
      host,
      allowed: false,
      reason: 'classifier_invalid_response',
      categories: [],
      ttlMs: TRANSIENT_TTL_MS,
      source: 'webshrinker',
    };
  }

  const evaluated = evaluateCategoryPayload(payload);
  return {
    host,
    ...evaluated,
    source: 'webshrinker',
  };
}

module.exports = {
  SAFE_IAB_PARENTS,
  MIN_CONFIDENCE_SCORE,
  ALLOW_TTL_MS,
  BLOCK_TTL_MS,
  TRANSIENT_TTL_MS,
  normalizeHost,
  evaluateCategoryPayload,
  credentialsConfigured,
  classifyHost,
};
