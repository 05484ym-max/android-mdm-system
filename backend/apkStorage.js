'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');

const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';
const DEFAULT_RELEASE_TAG = 'app-store-assets';

function loadStorageConfig() {
  const token = process.env.GITHUB_APK_TOKEN;
  const repository = process.env.GITHUB_APK_REPOSITORY || '05484ym-max/android-mdm-system';
  const releaseTag = process.env.GITHUB_APK_RELEASE_TAG || DEFAULT_RELEASE_TAG;
  if (!token) throw new Error('APK storage is not configured - missing GITHUB_APK_TOKEN');
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error('GITHUB_APK_REPOSITORY must be owner/repo');
  }

  // Test-only local transport override. Production can never redirect APK
  // storage away from GitHub: the override is accepted only under
  // NODE_ENV=test and only for loopback HTTP.
  let apiBase = 'https://api.github.com';
  let uploadBase = 'https://uploads.github.com';
  const testBase = process.env.NODE_ENV === 'test'
    ? process.env.APK_STORAGE_TEST_BASE_URL
    : null;
  if (testBase) {
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(testBase)) {
      throw new Error('APK_STORAGE_TEST_BASE_URL must be loopback HTTP in test mode');
    }
    apiBase = `${testBase}/api`;
    uploadBase = `${testBase}/uploads`;
  }

  return { token, repository, releaseTag, apiBase, uploadBase };
}

function headers(config, accept = 'application/vnd.github+json') {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'android-mdm-system',
  };
}

async function githubJson(config, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers(config), ...(options.headers || {}) },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body && body.message ? body.message : `HTTP ${response.status}`;
    const error = new Error(`GitHub API: ${message}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function ensureRelease(config) {
  const base = `${config.apiBase}/repos/${config.repository}`;
  try {
    return await githubJson(
      config,
      `${base}/releases/tags/${encodeURIComponent(config.releaseTag)}`
    );
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  return githubJson(config, `${base}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: config.releaseTag,
      target_commitish: 'main',
      name: 'Kosher App Store APKs',
      body: 'Persistent APK assets used by the managed app store.',
      draft: false,
      prerelease: false,
    }),
  });
}

function generateApkStorageKey() {
  return `${crypto.randomUUID()}.apk`;
}

function generateIconStorageKey(extension = 'png') {
  const safe = ['png', 'webp', 'jpg'].includes(extension) ? extension : 'png';
  return `${crypto.randomUUID()}.${safe}`;
}

/**
 * Storage key for a customer-update attachment (image/video/any other
 * file - see backend/index.js's POST /api/customer-updates/:id/attachments).
 * Unlike generateIconStorageKey, the extension isn't restricted to a small
 * allowlist - customer-update attachments are deliberately "any file type",
 * so this only strips anything that isn't a safe filename character and
 * caps its length, rather than validating it against a fixed set.
 */
function generateAttachmentStorageKey(extension) {
  const safe = String(extension || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  return safe ? `${crypto.randomUUID()}.${safe}` : crypto.randomUUID();
}

async function uploadAsset(config, key, buffer, contentType) {
  const release = await ensureRelease(config);
  const uploadUrl = new URL(
    `${config.uploadBase}/repos/${config.repository}/releases/${release.id}/assets?name=${encodeURIComponent(key)}`
  );

  const body = await new Promise((resolve, reject) => {
    const transport = uploadUrl.protocol === 'http:' ? http : https;
    const req = transport.request(uploadUrl, {
      method: 'POST',
      headers: {
        ...headers(config),
        'Content-Type': contentType,
        'Content-Length': buffer.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          return reject(new Error(`GitHub release upload returned invalid JSON (HTTP ${res.statusCode})`));
        }
        if (res.statusCode < 200 || res.statusCode >= 300 || !parsed || !parsed.id) {
          const message = parsed && parsed.message ? parsed.message : `HTTP ${res.statusCode}`;
          return reject(new Error(`GitHub release upload failed: ${message}`));
        }
        resolve(parsed);
      });
    });
    req.setTimeout(120000, () => req.destroy(new Error('GitHub release upload timed out')));
    req.on('error', reject);
    req.end(buffer);
  });

  return {
    assetId: String(body.id),
    browserDownloadUrl: body.browser_download_url,
    name: body.name,
  };
}

async function uploadApk(config, key, buffer) {
  return uploadAsset(config, key, buffer, APK_CONTENT_TYPE);
}

async function uploadIcon(config, key, buffer, contentType) {
  if (!/^image\/(png|webp|jpeg)$/.test(contentType)) throw new Error('unsupported icon content type');
  return uploadAsset(config, key, buffer, contentType);
}

/**
 * Uploads a customer-update attachment - deliberately no content-type
 * restriction (unlike uploadIcon): images, videos, and any other file type
 * are all valid attachments here. uploadAsset itself is already fully
 * generic; this is a thin, intention-revealing wrapper, same relationship
 * uploadApk/uploadIcon already have to it.
 */
async function uploadAttachment(config, key, buffer, contentType) {
  return uploadAsset(config, key, buffer, contentType || 'application/octet-stream');
}

async function deleteApk(config, assetId) {
  try {
    const response = await fetch(
      `${config.apiBase}/repos/${config.repository}/releases/assets/${encodeURIComponent(assetId)}`,
      { method: 'DELETE', headers: headers(config) }
    );
    if (response.status === 204 || response.status === 404) return true;
    console.error(`[apkStorage] failed to delete GitHub release asset ${assetId}: HTTP ${response.status}`);
    return false;
  } catch (e) {
    console.error(`[apkStorage] failed to delete GitHub release asset ${assetId}:`, e.message);
    return false;
  }
}

async function downloadApk(config, assetId) {
  const response = await fetch(
    `${config.apiBase}/repos/${config.repository}/releases/assets/${encodeURIComponent(assetId)}`,
    {
      headers: headers(config, 'application/octet-stream'),
      redirect: 'follow',
    }
  );
  if (!response.ok) {
    throw new Error(`GitHub APK download failed: HTTP ${response.status}`);
  }
  return response;
}

module.exports = {
  APK_CONTENT_TYPE,
  loadStorageConfig,
  generateApkStorageKey,
  generateIconStorageKey,
  generateAttachmentStorageKey,
  uploadApk,
  uploadIcon,
  uploadAttachment,
  deleteApk,
  downloadApk,
};
