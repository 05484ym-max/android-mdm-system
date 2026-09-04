'use strict';

const assert = require('assert');
const {
  POLICY_VERSION,
  SIGNAL_SCHEMA_VERSION,
  SOURCE,
  CACHEABLE_DECISION_REASONS,
  moderateImage,
  sanitizeDetails,
  normalizeReason,
  localAiEndpoint,
  validateSignals,
  evaluateHarediStrictPolicy,
} = require('./imageModerator');

function jsonResponse(body, { status = 200, contentLength } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-length' ? contentLength ?? null : null) },
    async json() {
      return body;
    },
  };
}

function okSignals(signals) {
  return jsonResponse({
    status: 'ok',
    signalSchemaVersion: SIGNAL_SCHEMA_VERSION,
    source: SOURCE,
    signals,
  });
}

(async () => {
  const oldUrl = process.env.LOCAL_AI_URL;
  const oldToken = process.env.LOCAL_AI_TOKEN;

  try {
    assert.strictEqual(POLICY_VERSION, 'HAREDI_STRICT_V5_NODE_POLICY');
    assert.strictEqual(SIGNAL_SCHEMA_VERSION, 'LOCAL_AI_SIGNALS_V1');
    assert.strictEqual(SOURCE, 'local_apache_vision_stack');

    // ---- direct evaluateHarediStrictPolicy() threshold tests ----
    // Ported 1:1 from the former ai-service/test_policy.py cases: the
    // decision logic moved, the behavior must not have changed.

    let result = evaluateHarediStrictPolicy(0.91, [], { 'a photograph with no person': 0.9 });
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'adult_content');

    result = evaluateHarediStrictPolicy(
      0.02,
      [{ female: 0.93, male: 0.07, detection: 0.96 }],
      { 'a photograph of a man': 0.7 },
    );
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'female_detected');

    result = evaluateHarediStrictPolicy(
      0.02,
      [
        { female: 0.03, male: 0.97, detection: 0.98 },
        { female: 0.96, male: 0.04, detection: 0.97 },
      ],
      {
        'a photograph of a woman': 0.61,
        'a photograph of a man': 0.74,
        'a photograph with no person': 0.02,
      },
    );
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'female_detected');
    assert.strictEqual(result.details.femaleFaceCount, 1);

    result = evaluateHarediStrictPolicy(
      0.02,
      [{ female: 0.02, male: 0.98, detection: 0.98 }],
      {
        'a photograph of a woman': 0.57,
        'a photograph of a man': 0.91,
        'a photograph with no person': 0.01,
      },
    );
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'female_detected', 'a visible male face must not cancel SigLIP woman signal');

    result = evaluateHarediStrictPolicy(
      0.02,
      [],
      {
        'a photograph of a woman': 0.46,
        'a photograph of a man': 0.88,
        'a photograph with no person': 0.04,
      },
    );
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'ambiguous_person', 'high male score must not cancel ambiguous female signal');

    result = evaluateHarediStrictPolicy(
      0.02,
      [{ female: 0.51, male: 0.49, detection: 0.96 }],
      { 'a photograph of a man': 0.8 },
    );
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'ambiguous_face');

    result = evaluateHarediStrictPolicy(
      0.02,
      [],
      {
        'a photograph of a woman': 0.88,
        'a photograph of a man': 0.05,
        'a photograph with no person': 0.08,
      },
    );
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'female_detected');

    result = evaluateHarediStrictPolicy(
      0.02,
      [{ female: 0.03, male: 0.97, detection: 0.96 }],
      {
        'a photograph of a woman': 0.06,
        'a photograph of a man': 0.86,
        'a photograph with no person': 0.03,
      },
    );
    assert.strictEqual(result.allowed, true, 'confident male face must pass when female signal is low');

    result = evaluateHarediStrictPolicy(
      0.02,
      [],
      {
        'a photograph of a woman': 0.48,
        'a photograph of a man': 0.42,
        'a photograph with no person': 0.10,
      },
    );
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'ambiguous_person');

    result = evaluateHarediStrictPolicy(
      0.02,
      [],
      {
        'a photograph of a woman': 0.10,
        'a photograph of a man': 0.12,
        'a photograph with no person': 0.30,
      },
    );
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'ambiguous_image');

    result = evaluateHarediStrictPolicy(
      0.02,
      [],
      {
        'a photograph of a woman': 0.04,
        'a photograph of a man': 0.03,
        'a photograph with no person': 0.84,
      },
    );
    assert.strictEqual(result.allowed, true, 'confident no-person evidence must pass');

    result = evaluateHarediStrictPolicy(
      0.02,
      [],
      {
        'a photograph of a person wearing a swimsuit': 0.82,
        'a photograph of a man': 0.12,
      },
    );
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'revealing_clothing');

    // A detected face that YuNet found but the gender model could not
    // classify at all (not present in the faces array despite gender_faces
    // input length being smaller) must fail closed via the caller's own
    // faces-array length, not silently pass.
    result = evaluateHarediStrictPolicy(0.02, [], {});
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'ambiguous_image', 'a totally empty signal set must fail closed');

    // Every cacheable/blocking reason evaluateHarediStrictPolicy can produce
    // must be in the cache allow-list backend/index.js relies on.
    for (const reason of ['adult_content', 'female_detected', 'ambiguous_face', 'revealing_clothing', 'ambiguous_person', 'ambiguous_image', 'image_safe_haredi_strict']) {
      assert.ok(CACHEABLE_DECISION_REASONS.has(reason), `${reason} must be cacheable`);
    }
    for (const reason of ['local_ai_warming', 'local_ai_unavailable', 'local_ai_error', 'local_ai_schema_mismatch', 'local_ai_invalid_response', 'local_ai_unreachable', 'local_ai_not_configured', 'local_ai_http_500']) {
      assert.ok(!CACHEABLE_DECISION_REASONS.has(reason), `${reason} must never be cacheable`);
    }

    // ---- validateSignals() ----
    assert.strictEqual(validateSignals(null), null);
    assert.strictEqual(validateSignals({ nsfwScore: 'not-a-number', faces: [], siglip: {} }), null);
    assert.strictEqual(validateSignals({ nsfwScore: 1.5, faces: [], siglip: {} }), null, 'out-of-range score must be rejected');
    assert.strictEqual(validateSignals({ nsfwScore: 0.1, faces: 'nope', siglip: {} }), null);
    assert.strictEqual(
      validateSignals({ nsfwScore: 0.1, faces: [{ female: 0.1, male: 2, detection: 0.9 }], siglip: {} }),
      null,
      'out-of-range face score must be rejected',
    );
    assert.strictEqual(validateSignals({ nsfwScore: 0.1, faces: [], siglip: 'nope' }), null);
    const partial = validateSignals({ nsfwScore: 0.1, faces: [], siglip: { 'a photograph of a woman': 0.2 } });
    assert.ok(partial, 'missing SigLIP keys must be tolerated');
    assert.strictEqual(partial.siglip['a photograph of a woman'], 0.2);
    assert.strictEqual(partial.siglip['a photograph of a man'], undefined);

    // ---- moderateImage() config/transport tests (unchanged mechanics) ----
    delete process.env.LOCAL_AI_URL;
    delete process.env.LOCAL_AI_TOKEN;

    result = await moderateImage(Buffer.from('image'));
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'local_ai_not_configured');

    process.env.LOCAL_AI_URL = 'file:///tmp/not-allowed';
    process.env.LOCAL_AI_TOKEN = 'test-secret';
    assert.strictEqual(localAiEndpoint(), null);
    result = await moderateImage(Buffer.from('image'));
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'local_ai_not_configured');

    process.env.LOCAL_AI_URL = 'http://local-ai.internal:8080';
    process.env.LOCAL_AI_TOKEN = 'test-secret';

    let captured = null;
    result = await moderateImage(Buffer.from('image-bytes'), async (url, options) => {
      captured = { url, options };
      return okSignals({
        nsfwScore: 0.02,
        faces: [{ female: 0.93, male: 0.07, detection: 0.96 }],
        siglip: { 'a photograph of a man': 0.7 },
      });
    });
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'female_detected');
    assert.strictEqual(result.source, SOURCE);
    assert.strictEqual(result.policyVersion, POLICY_VERSION);
    assert.strictEqual(captured.url, 'http://local-ai.internal:8080/moderate');
    assert.strictEqual(captured.options.headers['X-Local-AI-Token'], 'test-secret');
    assert.ok(Buffer.isBuffer(captured.options.body));

    result = await moderateImage(Buffer.from('image'), async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      async json() { return {}; },
    }));
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'local_ai_http_500');

    result = await moderateImage(Buffer.from('image'), async () => jsonResponse({}, { contentLength: String(1024 * 1024) }));
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'local_ai_response_too_large');

    result = await moderateImage(Buffer.from('image'), async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      async json() { throw new Error('bad json'); },
    }));
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'local_ai_invalid_response');

    result = await moderateImage(Buffer.from('image'), async () => {
      throw new Error('offline');
    });
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'local_ai_unreachable');

    // ---- moderateImage() protocol-version and status handling ----

    result = await moderateImage(Buffer.from('image'), async () => jsonResponse({
      status: 'ok',
      signalSchemaVersion: 'SOME_OLD_SCHEMA',
      signals: { nsfwScore: 0.01, faces: [], siglip: {} },
    }));
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'local_ai_schema_mismatch');

    result = await moderateImage(Buffer.from('image'), async () => jsonResponse({
      status: 'warming',
      signalSchemaVersion: SIGNAL_SCHEMA_VERSION,
    }));
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'local_ai_warming');

    result = await moderateImage(Buffer.from('image'), async () => jsonResponse({
      status: 'unavailable',
      signalSchemaVersion: SIGNAL_SCHEMA_VERSION,
    }));
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'local_ai_unavailable');

    result = await moderateImage(Buffer.from('image'), async () => jsonResponse({
      status: 'error',
      signalSchemaVersion: SIGNAL_SCHEMA_VERSION,
      errorType: 'RuntimeError',
    }));
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'local_ai_error');

    result = await moderateImage(Buffer.from('image'), async () => jsonResponse({
      status: 'something_unexpected',
      signalSchemaVersion: SIGNAL_SCHEMA_VERSION,
    }));
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'local_ai_invalid_response');

    // status "ok" but the signals object itself is malformed - must fail
    // closed as an invalid response, not silently allow.
    result = await moderateImage(Buffer.from('image'), async () => okSignals({ faces: [], siglip: {} }));
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'local_ai_invalid_response', 'missing nsfwScore must fail closed');

    result = await moderateImage(Buffer.from('image'), async () => okSignals({
      nsfwScore: 0.1,
      faces: [{ female: 1.4, male: 0.1, detection: 0.9 }],
      siglip: {},
    }));
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'local_ai_invalid_response', 'out-of-range face score must fail closed');

    // ---- moderateImage() full pipeline: allow path ----
    result = await moderateImage(Buffer.from('image'), async () => okSignals({
      nsfwScore: 0.01,
      faces: [{ female: 0.03, male: 0.97, detection: 0.96 }],
      siglip: {
        'a photograph of a woman': 0.05,
        'a photograph of a man': 0.9,
        'a photograph with no person': 0.02,
      },
    }));
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.reason, 'image_safe_haredi_strict');
    assert.strictEqual(result.policyVersion, POLICY_VERSION);

    // ---- sanitizeDetails() (unchanged) ----
    const clean = sanitizeDetails({
      okNumber: 0.8,
      okBool: true,
      okString: 'value',
      nested: { nope: true },
      array: [1, 2],
      'bad key': 1,
    });
    assert.deepStrictEqual(clean, {
      okNumber: 0.8,
      okBool: true,
      okString: 'value',
    });

    assert.strictEqual(normalizeReason(''), 'local_ai_invalid_response');
    assert.strictEqual(normalizeReason('x'.repeat(200)).length, 80);

    console.log('Node-owned HAREDI_STRICT image policy: all tests passed');
  } finally {
    if (oldUrl === undefined) delete process.env.LOCAL_AI_URL;
    else process.env.LOCAL_AI_URL = oldUrl;
    if (oldToken === undefined) delete process.env.LOCAL_AI_TOKEN;
    else process.env.LOCAL_AI_TOKEN = oldToken;
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
