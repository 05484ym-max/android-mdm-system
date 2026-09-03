'use strict';

function cleanConfiguredBase(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function publicBaseUrl(req) {
  const configured = cleanConfiguredBase(process.env.PUBLIC_BASE_URL);
  if (configured) return configured;

  // Render and other reverse proxies terminate TLS before forwarding the
  // request to Node. Express req.protocol can therefore be "http" unless
  // trust proxy was explicitly enabled. Respect only the standard first
  // forwarded protocol token and only the two schemes we support.
  const forwarded = String(req.get('x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const protocol = forwarded === 'https' || forwarded === 'http'
    ? forwarded
    : (req.protocol === 'https' ? 'https' : 'http');

  const host = String(req.get('host') || '').trim();
  if (!host || /[\s/\\]/.test(host)) {
    throw new Error('cannot construct public base URL: invalid Host header');
  }

  return protocol + '://' + host;
}

module.exports = { publicBaseUrl, cleanConfiguredBase };
