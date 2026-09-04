'use strict';

// The local AI service (ai-service/) is provider/inference-only: it returns
// raw, normalized ML signal scores and makes no ALLOW/BLOCK judgment. This
// module is the sole owner of the binding HAREDI_STRICT moderation policy -
// every threshold below is centralized here, not in the Python service.
//
// POLICY_VERSION identifies the *decision logic* (this file). It is part of
// the moderation cache key (see backend/index.js), so any change to the
// thresholds/logic below must bump it to invalidate cached decisions made
// under the old logic.
//
// SIGNAL_SCHEMA_VERSION identifies the *shape* of the raw signals the local
// AI service emits (ai-service/policy.py). It is validated independently of
// POLICY_VERSION: a schema mismatch means Node cannot safely interpret the
// response at all, regardless of which policy version Node itself is on.
const POLICY_VERSION = 'HAREDI_STRICT_V5_NODE_POLICY';
const SIGNAL_SCHEMA_VERSION = 'LOCAL_AI_SIGNALS_V1';
const SOURCE = 'local_apache_vision_stack';
const MAX_RESPONSE_BYTES = 256 * 1024;

// Must match ai-service/policy.py's SIGLIP_PROMPTS exactly - these are the
// zero-shot classification labels the local AI service is asked to score.
const SIGLIP_PROMPTS = [
  'a photograph of a woman',
  'a photograph of a girl',
  'a photograph of a man',
  'a photograph of a boy',
  'a photograph of a person wearing a swimsuit',
  'a photograph of revealing clothing',
  'a photograph with no person',
];

// Centralized HAREDI_STRICT thresholds. These were moved unchanged from the
// former Python-side policy.py::evaluate() (HAREDI_STRICT_V4_GROUP_SAFE).
const THRESHOLDS = Object.freeze({
  NSFW_BLOCK: 0.35,
  FACE_DETECTION_MIN: 0.60,
  FACE_FEMALE_MIN: 0.70,
  FACE_MALE_MIN: 0.82,
  SIGLIP_SWIMSUIT_BLOCK: 0.50,
  SIGLIP_REVEALING_BLOCK: 0.50,
  SIGLIP_WOMAN_BLOCK: 0.50,
  SIGLIP_WOMAN_AMBIGUOUS: 0.42,
  SIGLIP_PERSON_LIKE_AMBIGUOUS: 0.42,
  SIGLIP_MAN_CONFIDENT: 0.65,
  SIGLIP_NO_PERSON_CONFIDENT: 0.58,
});

const STATUS_BLOCK_REASON = Object.freeze({
  warming: 'local_ai_warming',
  unavailable: 'local_ai_unavailable',
  error: 'local_ai_error',
});

// Only these reason strings represent a stable fact about the image itself
// (a real HAREDI_STRICT decision). backend/index.js uses this same set to
// decide what may be written to the permanent moderation cache; every other
// reason this module can produce (schema mismatch, unreachable, warming,
// timeout, http error, invalid response, ...) describes a transient
// infrastructure condition and must never be cached as if it were a fact
// about the image.
const CACHEABLE_DECISION_REASONS = new Set([
  'image_safe_haredi_strict',
  'adult_content',
  'revealing_clothing',
  'female_detected',
  'ambiguous_face',
  'ambiguous_person',
  'ambiguous_image',
]);

function isFiniteScore(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function boundedScore(value, fallback = 0) {
  return isFiniteScore(value) ? value : fallback;
}

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
  return String(reason || 'local_ai_invalid_response').slice(0, 80);
}

function blocked(reason) {
  return {
    allowed: false,
    reason: normalizeReason(reason),
    details: {},
    source: SOURCE,
    policyVersion: POLICY_VERSION,
  };
}

/**
 * Validate and normalize the raw signal payload from the local AI service.
 * Returns null if the payload does not match the expected shape - a missing,
 * non-numeric, or out-of-range score is treated as an invalid response, not
 * as a policy decision. Absent SigLIP prompt keys are tolerated (they
 * default to 0 during evaluation), matching the previous Python behavior.
 */
function validateSignals(signals) {
  if (!signals || typeof signals !== 'object' || Array.isArray(signals)) return null;
  if (!isFiniteScore(signals.nsfwScore)) return null;
  if (!Array.isArray(signals.faces)) return null;

  const faces = [];
  for (const face of signals.faces) {
    if (!face || typeof face !== 'object') return null;
    if (!isFiniteScore(face.female) || !isFiniteScore(face.male) || !isFiniteScore(face.detection)) {
      return null;
    }
    faces.push({ female: face.female, male: face.male, detection: face.detection });
  }

  if (!signals.siglip || typeof signals.siglip !== 'object' || Array.isArray(signals.siglip)) return null;
  const siglip = {};
  for (const prompt of SIGLIP_PROMPTS) {
    const value = signals.siglip[prompt];
    if (value === undefined) continue;
    if (!isFiniteScore(value)) return null;
    siglip[prompt] = value;
  }

  return { nsfwScore: signals.nsfwScore, faces, siglip };
}

/**
 * The binding HAREDI_STRICT policy. Deliberately fail-closed: a lack of an
 * unsafe signal is not sufficient to allow an image; it needs affirmative
 * evidence that either no person is present or every detected face is
 * confidently male. Female whole-image evidence is evaluated independently
 * of male evidence, since an image may legitimately contain both men and
 * women (a strong man score must never cancel a meaningful woman/girl
 * score). Ported unchanged from the former Python policy.py::evaluate()
 * (HAREDI_STRICT_V4_GROUP_SAFE) other than the module boundary.
 */
function evaluateHarediStrictPolicy(nsfwScore, faces, siglip) {
  const nsfw = boundedScore(nsfwScore);
  if (nsfw >= THRESHOLDS.NSFW_BLOCK) {
    return { allowed: false, reason: 'adult_content', details: { nsfwScore: nsfw } };
  }

  const femaleFaces = [];
  const uncertainFaces = [];
  const maleFaces = [];
  for (const face of faces || []) {
    const female = boundedScore(face.female);
    const male = boundedScore(face.male);
    const detection = boundedScore(face.detection, 1);
    if (detection < THRESHOLDS.FACE_DETECTION_MIN) continue;
    if (female >= THRESHOLDS.FACE_FEMALE_MIN && female >= male) {
      femaleFaces.push(female);
    } else if (male >= THRESHOLDS.FACE_MALE_MIN && male > female) {
      maleFaces.push(male);
    } else {
      uncertainFaces.push(Math.max(female, male));
    }
  }

  if (femaleFaces.length) {
    return {
      allowed: false,
      reason: 'female_detected',
      details: { femaleFaceCount: femaleFaces.length, maxFemaleFace: Math.max(...femaleFaces) },
    };
  }

  if (uncertainFaces.length) {
    return {
      allowed: false,
      reason: 'ambiguous_face',
      details: { ambiguousFaceCount: uncertainFaces.length, maxFaceConfidence: Math.max(...uncertainFaces) },
    };
  }

  const woman = Math.max(
    boundedScore(siglip['a photograph of a woman']),
    boundedScore(siglip['a photograph of a girl']),
  );
  const man = Math.max(
    boundedScore(siglip['a photograph of a man']),
    boundedScore(siglip['a photograph of a boy']),
  );
  const swimsuit = boundedScore(siglip['a photograph of a person wearing a swimsuit']);
  const revealing = boundedScore(siglip['a photograph of revealing clothing']);
  const noPerson = boundedScore(siglip['a photograph with no person']);

  if (swimsuit >= THRESHOLDS.SIGLIP_SWIMSUIT_BLOCK || revealing >= THRESHOLDS.SIGLIP_REVEALING_BLOCK) {
    return {
      allowed: false,
      reason: 'revealing_clothing',
      details: { siglipSwimsuit: swimsuit, siglipRevealing: revealing },
    };
  }

  // Never compare the female score against the male score as a gate: group
  // photos can legitimately score highly for both.
  if (woman >= THRESHOLDS.SIGLIP_WOMAN_BLOCK) {
    return {
      allowed: false,
      reason: 'female_detected',
      details: { siglipFemale: woman, siglipMale: man },
    };
  }

  if (woman >= THRESHOLDS.SIGLIP_WOMAN_AMBIGUOUS) {
    return {
      allowed: false,
      reason: 'ambiguous_person',
      details: { siglipFemale: woman, siglipMale: man },
    };
  }

  // A detected face must be affirmatively male. If YuNet saw faces but the
  // gender model did not produce a usable result for all of them, fail closed.
  const usableFaceCount = femaleFaces.length + uncertainFaces.length + maleFaces.length;
  if ((faces || []).length && usableFaceCount < faces.length) {
    return {
      allowed: false,
      reason: 'ambiguous_face',
      details: { detectedFaceCount: faces.length, classifiedFaceCount: usableFaceCount },
    };
  }

  if (maleFaces.length) {
    return {
      allowed: true,
      reason: 'image_safe_haredi_strict',
      details: {
        maleFaceCount: maleFaces.length,
        minMaleFace: Math.min(...maleFaces),
        siglipFemale: woman,
        nsfwScore: nsfw,
      },
    };
  }

  const personLike = Math.max(woman, man, swimsuit, revealing);
  if (personLike >= THRESHOLDS.SIGLIP_PERSON_LIKE_AMBIGUOUS && man < THRESHOLDS.SIGLIP_MAN_CONFIDENT) {
    return {
      allowed: false,
      reason: 'ambiguous_person',
      details: { siglipFemale: woman, siglipMale: man, siglipNoPerson: noPerson },
    };
  }

  if (noPerson < THRESHOLDS.SIGLIP_NO_PERSON_CONFIDENT && man < THRESHOLDS.SIGLIP_MAN_CONFIDENT) {
    return {
      allowed: false,
      reason: 'ambiguous_image',
      details: { siglipFemale: woman, siglipMale: man, siglipNoPerson: noPerson, nsfwScore: nsfw },
    };
  }

  return {
    allowed: true,
    reason: 'image_safe_haredi_strict',
    details: { siglipFemale: woman, siglipMale: man, siglipNoPerson: noPerson, nsfwScore: nsfw },
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

  if (payload?.signalSchemaVersion !== SIGNAL_SCHEMA_VERSION) {
    return blocked('local_ai_schema_mismatch');
  }

  const status = typeof payload?.status === 'string' ? payload.status : null;
  if (status !== 'ok') {
    return blocked((status && STATUS_BLOCK_REASON[status]) || 'local_ai_invalid_response');
  }

  const signals = validateSignals(payload.signals);
  if (!signals) {
    return blocked('local_ai_invalid_response');
  }

  const decision = evaluateHarediStrictPolicy(signals.nsfwScore, signals.faces, signals.siglip);
  return {
    allowed: decision.allowed === true,
    reason: normalizeReason(decision.reason),
    details: sanitizeDetails(decision.details),
    source: SOURCE,
    policyVersion: POLICY_VERSION,
  };
}

module.exports = {
  POLICY_VERSION,
  SIGNAL_SCHEMA_VERSION,
  SOURCE,
  THRESHOLDS,
  SIGLIP_PROMPTS,
  CACHEABLE_DECISION_REASONS,
  localAiEndpoint,
  configured,
  sanitizeDetails,
  normalizeReason,
  validateSignals,
  evaluateHarediStrictPolicy,
  moderateImage,
};
