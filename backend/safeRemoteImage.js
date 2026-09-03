'use strict';

const dns = require('dns').promises;
const https = require('https');
const net = require('net');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;

function isPrivateIpv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return (
    p[0] === 0 ||
    p[0] === 10 ||
    p[0] === 127 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 192 && p[1] === 0 && p[2] === 0) ||
    (p[0] === 192 && p[1] === 0 && p[2] === 2) ||
    (p[0] === 198 && p[1] === 18) ||
    (p[0] === 198 && p[1] === 19) ||
    (p[0] === 198 && p[1] === 51 && p[2] === 100) ||
    (p[0] === 203 && p[1] === 0 && p[2] === 113) ||
    p[0] >= 224
  );
}

function isPrivateIpv6(ip) {
  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('2001:db8:') ||
    normalized.startsWith('ff') ||
    normalized.startsWith('::ffff:')
  );
}

function isPublicIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) return !isPrivateIpv4(ip);
  if (family === 6) return !isPrivateIpv6(ip);
  return false;
}

function validateImageUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('invalid_image_url');
  }
  if (url.protocol !== 'https:') throw new Error('image_https_required');
  if (!url.hostname || url.username || url.password) throw new Error('invalid_image_url');
  const hostForIpCheck = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (net.isIP(hostForIpCheck)) throw new Error('image_ip_literal_blocked');
  if (url.port && url.port !== '443') throw new Error('image_non_default_port');
  if (url.hash) url.hash = '';
  return url;
}

async function resolvePublicHost(hostname) {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!results.length) throw new Error('image_dns_no_results');
  const publicResults = results.filter(r => isPublicIp(r.address));
  if (!publicResults.length) throw new Error('image_private_address_blocked');
  if (publicResults.length !== results.length) {
    // Mixed public/private resolution is treated as suspicious rather than
    // silently selecting only the public answer.
    throw new Error('image_mixed_address_blocked');
  }
  return publicResults;
}

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return { mimeType: 'image/png', extension: 'png' };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) return { mimeType: 'image/webp', extension: 'webp' };
  return null;
}

async function requestOnce(url) {
  const addresses = await resolvePublicHost(url.hostname);
  const selected = addresses[0];

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.1',
        'User-Agent': 'YehudiKasherImageFilter/1',
      },
      lookup: (_hostname, _options, callback) => {
        callback(null, selected.address, selected.family);
      },
      servername: url.hostname,
    }, res => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: new URL(res.headers.location, url).toString() });
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(new Error('image_http_' + status));
      }

      const declaredLength = Number(res.headers['content-length'] || 0);
      if (declaredLength && declaredLength > MAX_IMAGE_BYTES) {
        res.resume();
        return reject(new Error('image_too_large'));
      }

      const chunks = [];
      let total = 0;
      res.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_IMAGE_BYTES) {
          req.destroy(new Error('image_too_large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const detected = detectImageType(buffer);
        if (!detected) return reject(new Error('unsupported_image_type'));
        resolve({
          buffer,
          mimeType: detected.mimeType,
          finalUrl: url.toString(),
        });
      });
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('image_fetch_timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function fetchSafeImage(rawUrl) {
  let current = validateImageUrl(rawUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const result = await requestOnce(current);
    if (!result.redirect) return result;
    if (redirectCount === MAX_REDIRECTS) throw new Error('image_too_many_redirects');
    current = validateImageUrl(result.redirect);
  }

  throw new Error('image_fetch_failed');
}

module.exports = {
  MAX_IMAGE_BYTES,
  MAX_REDIRECTS,
  REQUEST_TIMEOUT_MS,
  isPublicIp,
  validateImageUrl,
  detectImageType,
  fetchSafeImage,
};
