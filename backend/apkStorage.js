// S3-compatible object storage for uploaded APKs (designed for Cloudflare
// R2, but any S3-compatible endpoint works - see docs/apk-storage.md).
// Render's local disk is never used: index.js's upload route reads the
// whole file into memory (multer memoryStorage) and this module streams
// it straight to the bucket, so an APK never touches this process's
// filesystem at any point.
'use strict';

const crypto = require('crypto');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';

/**
 * Fails closed: a missing/misconfigured env var throws rather than falling
 * back to some default bucket/endpoint, so a misconfigured deployment can
 * never silently upload (or claim to have uploaded) a real APK anywhere -
 * it just refuses to proceed. The caller (index.js's upload-apk route)
 * lets this propagate to the global error handler, same fail-closed
 * pattern already used by policySigning.loadSigningConfig for the browser
 * policy signing key. Never logs any of these values.
 */
function loadStorageConfig() {
  const endpoint = process.env.APK_STORAGE_ENDPOINT;
  const region = process.env.APK_STORAGE_REGION || 'auto';
  const bucket = process.env.APK_STORAGE_BUCKET;
  const accessKeyId = process.env.APK_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.APK_STORAGE_SECRET_ACCESS_KEY;
  const publicBaseUrl = process.env.APK_STORAGE_PUBLIC_BASE_URL;

  const missing = [];
  if (!endpoint) missing.push('APK_STORAGE_ENDPOINT');
  if (!bucket) missing.push('APK_STORAGE_BUCKET');
  if (!accessKeyId) missing.push('APK_STORAGE_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('APK_STORAGE_SECRET_ACCESS_KEY');
  if (!publicBaseUrl) missing.push('APK_STORAGE_PUBLIC_BASE_URL');
  if (missing.length) {
    throw new Error(`APK storage is not configured - missing env var(s): ${missing.join(', ')}`);
  }
  return { endpoint, region, bucket, accessKeyId, secretAccessKey, publicBaseUrl };
}

function buildClient(config) {
  // forcePathStyle is required for R2 and most non-AWS S3-compatible
  // endpoints (bucket-in-path rather than bucket-as-subdomain).
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

/**
 * Randomly generated, never derived from the admin-supplied original
 * filename - see index.js's upload-apk route, which never passes
 * req.file.originalname in here. A hostile or merely accidental filename
 * (path traversal segments, unicode lookalikes, collisions with another
 * app's key) must never be able to influence where an object is stored.
 */
function generateApkStorageKey() {
  return `apps/${crypto.randomUUID()}.apk`;
}

function publicUrlForKey(config, key) {
  return `${config.publicBaseUrl.replace(/\/+$/, '')}/${key}`;
}

/** Throws (fail-closed) on any storage error. The caller must not create a
 * catalog row when this rejects - see index.js's upload-apk route, which
 * calls this before touching the database at all. */
async function uploadApk(config, key, buffer) {
  const client = buildClient(config);
  try {
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: APK_CONTENT_TYPE,
      ContentLength: buffer.length,
    }));
  } finally {
    client.destroy();
  }
}

/**
 * Best-effort cleanup for the "storage upload succeeded but the catalog
 * write failed" case (see index.js's upload-apk route). Deliberately never
 * throws - a cleanup failure must not mask the original database error the
 * caller is already propagating, and there is nothing more the request
 * handler could do about it besides logging: no catalog row was created
 * either way, so nothing usable points at the orphaned object even if this
 * cleanup itself fails.
 */
async function deleteApk(config, key) {
  const client = buildClient(config);
  try {
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    return true;
  } catch (e) {
    console.error(`[apkStorage] failed to clean up orphaned object ${key}:`, e.message);
    return false;
  } finally {
    client.destroy();
  }
}

module.exports = {
  APK_CONTENT_TYPE,
  loadStorageConfig,
  generateApkStorageKey,
  publicUrlForKey,
  uploadApk,
  deleteApk,
};
