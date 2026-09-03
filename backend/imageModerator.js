'use strict';

const FEMALE_LABELS = [
  'woman', 'women', 'girl', 'girls', 'female', 'lady', 'ladies', 'bride',
  'bikini', 'swimwear', 'swimsuit', 'lingerie', 'underwear', 'bra',
];

const MALE_LABELS = [
  'man', 'men', 'boy', 'boys', 'male', 'gentleman',
];

const PERSON_LABELS = [
  'person', 'people', 'human', 'crowd', 'portrait', 'face',
];

const RISKY_CLOTHING_LABELS = [
  'bikini', 'swimwear', 'swimsuit', 'lingerie', 'underwear', 'bra',
];

const LIKELIHOOD_RANK = {
  UNKNOWN: 0,
  VERY_UNLIKELY: 1,
  UNLIKELY: 2,
  POSSIBLE: 3,
  LIKELY: 4,
  VERY_LIKELY: 5,
};

const FEMALE_SCORE_THRESHOLD = 0.60;
const PERSON_SCORE_THRESHOLD = 0.70;
const MALE_SCORE_THRESHOLD = 0.80;

function labelScore(labels, terms) {
  let best = 0;
  for (const label of labels || []) {
    const description = String(label.description || '').trim().toLowerCase();
    const score = Number(label.score || 0);
    if (!Number.isFinite(score)) continue;
    if (terms.some(term => description === term || description.includes(term))) {
      best = Math.max(best, score);
    }
  }
  return best;
}

function evaluateVisionResponse(payload) {
  const response = payload && Array.isArray(payload.responses) ? payload.responses[0] : null;
  if (!response) {
    return { allowed: false, reason: 'vision_missing_response', details: {} };
  }
  if (response.error) {
    return { allowed: false, reason: 'vision_error', details: { error: response.error.message || 'unknown' } };
  }

  const safe = response.safeSearchAnnotation || {};
  const labels = Array.isArray(response.labelAnnotations) ? response.labelAnnotations : [];

  const adultRank = LIKELIHOOD_RANK[safe.adult] || 0;
  const racyRank = LIKELIHOOD_RANK[safe.racy] || 0;
  if (adultRank >= LIKELIHOOD_RANK.POSSIBLE) {
    return { allowed: false, reason: 'adult_content', details: { safe } };
  }
  if (racyRank >= LIKELIHOOD_RANK.POSSIBLE) {
    return { allowed: false, reason: 'racy_content', details: { safe } };
  }

  const riskyClothing = labelScore(labels, RISKY_CLOTHING_LABELS);
  if (riskyClothing >= FEMALE_SCORE_THRESHOLD) {
    return { allowed: false, reason: 'revealing_clothing', details: { riskyClothing } };
  }

  const femaleScore = labelScore(labels, FEMALE_LABELS);
  if (femaleScore >= FEMALE_SCORE_THRESHOLD) {
    return { allowed: false, reason: 'female_detected', details: { femaleScore } };
  }

  const personScore = labelScore(labels, PERSON_LABELS);
  const maleScore = labelScore(labels, MALE_LABELS);

  // HAREDI_STRICT: a person-like image that is not confidently identified as
  // male is blocked. This deliberately prefers false positives to exposing a
  // potentially unsuitable person image.
  if (personScore >= PERSON_SCORE_THRESHOLD && maleScore < MALE_SCORE_THRESHOLD) {
    return {
      allowed: false,
      reason: 'ambiguous_person',
      details: { personScore, maleScore },
    };
  }

  return {
    allowed: true,
    reason: 'image_safe_haredi_strict',
    details: {
      femaleScore,
      personScore,
      maleScore,
      safe,
    },
  };
}

function configured() {
  return Boolean(process.env.GOOGLE_VISION_API_KEY);
}

async function moderateImage(buffer, fetchImpl = fetch) {
  if (!configured()) {
    return {
      allowed: false,
      reason: 'vision_not_configured',
      details: {},
      source: 'google_vision',
    };
  }

  const body = {
    requests: [{
      image: { content: buffer.toString('base64') },
      features: [
        { type: 'SAFE_SEARCH_DETECTION' },
        { type: 'LABEL_DETECTION', maxResults: 30 },
      ],
    }],
  };

  let response;
  try {
    response = await fetchImpl(
      'https://vision.googleapis.com/v1/images:annotate?key=' +
        encodeURIComponent(process.env.GOOGLE_VISION_API_KEY),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      },
    );
  } catch {
    return {
      allowed: false,
      reason: 'vision_unreachable',
      details: {},
      source: 'google_vision',
    };
  }

  if (!response.ok) {
    return {
      allowed: false,
      reason: 'vision_http_' + response.status,
      details: {},
      source: 'google_vision',
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return {
      allowed: false,
      reason: 'vision_invalid_response',
      details: {},
      source: 'google_vision',
    };
  }

  return {
    ...evaluateVisionResponse(payload),
    source: 'google_vision',
  };
}

module.exports = {
  LIKELIHOOD_RANK,
  FEMALE_SCORE_THRESHOLD,
  PERSON_SCORE_THRESHOLD,
  MALE_SCORE_THRESHOLD,
  evaluateVisionResponse,
  configured,
  moderateImage,
};
