'use strict';

const assert = require('assert');
const {
  POLICY_VERSION,
  SOURCE,
  moderateImage,
  sanitizeDetails,
  normalizeReason,
  localAiEndpoint,
} = require('./imageModerator');

(async () => {
  const oldUrl = process.env.LOCAL_AI_URL;
  const oldToken = process.env.LOCAL_AI_TOKEN;

  try {
    assert.strictEqual(POLICY_VERSION, 'HAREDI_STRICT_V3_PERMISSIVE');
    assert.strictEqual(SOURCE, 'local_apache_vision_stack');

    delete process.env.LOCAL_AI_URL;
    delete process.env.LOCAL_AI_TOKEN;

    let result = await moderateImage(Buffer.from('image'));
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
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        async json() {
          return {
            allowed: false,
            reason: 'female_detected',
            policyVersion: POLICY_VERSION,
            details: {
              maxFemaleFace: 0.97,
              nested: { must: 'be dropped' },
            },
          };
        },
      };
    });

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'female_detected');
    assert.strictEqual(result.source, SOURCE);
    assert.strictEqual(result.details.maxFemaleFace, 0.97);
    assert.strictEqual(result.details.nested, undefined);
    assert.strictEqual(captured.url, 'http://local-ai.internal:8080/moderate');
    assert.strictEqual(captured.options.headers['X-Local-AI-Token'], 'test-secret');
    assert.ok(Buffer.isBuffer(captured.options.body));

    result = await moderateImage(Buffer.from('image'), async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      async json() {
        return {
          allowed: false,
          reason: 'revealing_content',
          policyVersion: POLICY_VERSION,
          details: { siglipRevealing: 0.88 },
        };
      },
    }));
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'revealing_clothing');
    assert.strictEqual(normalizeReason('revealing_content'), 'revealing_clothing');

    result = await moderateImage(Buffer.from('image'), async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      async json() {
        return {
          allowed: true,
          reason: 'image_safe_haredi_strict',
          policyVersion: POLICY_VERSION,
          details: { maleFaceCount: 1 },
        };
      },
    }));
    assert.strictEqual(result.allowed, true);

    result = await moderateImage(Buffer.from('image'), async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      async json() {
        return {
          allowed: true,
          reason: 'image_safe_haredi_strict',
          policyVersion: 'OLD_POLICY',
          details: {},
        };
      },
    }));
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'local_ai_policy_mismatch');

    result = await moderateImage(Buffer.from('image'), async () => {
      throw new Error('offline');
    });
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, 'local_ai_unreachable');

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

    console.log('Local AI image moderator client: all tests passed');
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
