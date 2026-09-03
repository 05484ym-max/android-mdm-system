'use strict';

const POLICY_VERSION = 'HAREDI_STRICT_V3_PERMISSIVE';
const SOURCE = 'local_apache_vision_stack';
const MAX_RESPONSE_BYTES = 256 * 1024;

function localAiEndpoint() {
  if (!process.env.LOCAL_AI_URL) return null;
  try {
    const url = new URL(String(process.env.LOCAL_AI_URL).trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    url.pathname = url.pathname.replace(/\/$/, '') + '/moderate';
    return url.toString();
  } catch {
    return null;
  }
}

function configured() {
  return Boolean(localAiEndpoint() && process.env.LOCAL_AI_TOKEN);
}

function sanitizeDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value).slice(0, 30)) {
    if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(key)) continue;
    if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw;
    else if (typeof raw === 'boolean') out[key] = raw;
    else if (typeof raw === 'string') out[key] = raw.slice(0, 200);
  }
  return out;
}

function normalizeReason(reason) {
  if (reason === 'revealing_content') return 'revealing_clothing';
  return String(reason || 'local_ai_invalid_response').slice(0, 80);
}

function blocked(reason) {
  return {
    allowed: false,
    reason,
    details: {},
    source: SOURCE,
    policyVersion: POLICY_VERSION,
  };
}

async function moderateImage(buffer, fetchImpl = fetch) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return blocked('local_ai_invalid_image');
  }

  if (!configured()) {
    return blocked('local_ai_not_configured');
  }

  const endpoint = localAiEndpoint();
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Local-AI-Token': process.env.LOCAL_AI_TOKEN,
        Accept: 'application/json',
      },
      body: buffer,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return blocked('local_ai_unreachable');
  }

  if (!response.ok) {
    return blocked('local_ai_http_' + response.status);
  }

  const declaredLength = Number(response.headers?.get?.('content-length') || 0);
  if (declaredLength && declaredLength > MAX_RESPONSE_BYTES) {
    return blocked('local_ai_response_too_large');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return blocked('local_ai_invalid_response');
  }

  if (
    payload?.policyVersion !== POLICY_VERSION ||
    typeof payload?.allowed !== 'boolean' ||
    typeof payload?.reason !== 'string'
  ) {
    return blocked(
      payload?.policyVersion !== POLICY_VERSION
        ? 'local_ai_policy_mismatch'
        : 'local_ai_invalid_response',
    );
  }

  return {
    allowed: payload.allowed === true,
    reason: normalizeReason(payload.reason),
    details: sanitizeDetails(payload.details),
    source: SOURCE,
    policyVersion: POLICY_VERSION,
  };
}

module.exports = {
  POLICY_VERSION,
  SOURCE,
  localAiEndpoint,
  configured,
  sanitizeDetails,
  normalizeReason,
  moderateImage,
};
