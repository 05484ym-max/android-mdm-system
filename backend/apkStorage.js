'use strict';

const crypto = require('crypto');

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
  return { token, repository, releaseTag };
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
  const base = `https://api.github.com/repos/${config.repository}`;
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

async function uploadApk(config, key, buffer) {
  const release = await ensureRelease(config);
  const url =
    `https://uploads.github.com/repos/${config.repository}/releases/${release.id}/assets` +
    `?name=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers(config),
      'Content-Type': APK_CONTENT_TYPE,
      'Content-Length': String(buffer.length),
    },
    body: buffer,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok || !body || !body.id) {
    const message = body && body.message ? body.message : `HTTP ${response.status}`;
    throw new Error(`GitHub release upload failed: ${message}`);
  }
  return {
    assetId: String(body.id),
    browserDownloadUrl: body.browser_download_url,
    name: body.name,
  };
}

async function deleteApk(config, assetId) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${config.repository}/releases/assets/${encodeURIComponent(assetId)}`,
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
    `https://api.github.com/repos/${config.repository}/releases/assets/${encodeURIComponent(assetId)}`,
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
  uploadApk,
  deleteApk,
  downloadApk,
};
