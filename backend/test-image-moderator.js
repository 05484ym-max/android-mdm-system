'use strict';

const assert = require('assert');
const {
  evaluateVisionResponse,
  moderateImage,
} = require('./imageModerator');

function payload({ adult = 'VERY_UNLIKELY', racy = 'VERY_UNLIKELY', labels = [], faces = [] } = {}) {
  return {
    responses: [{
      safeSearchAnnotation: {
        adult,
        racy,
        violence: 'VERY_UNLIKELY',
        medical: 'VERY_UNLIKELY',
        spoof: 'VERY_UNLIKELY',
      },
      labelAnnotations: labels,
      faceAnnotations: faces,
    }],
  };
}

assert.strictEqual(
  evaluateVisionResponse(payload({
    labels: [{ description: 'Woman', score: 0.96 }],
  })).reason,
  'female_detected',
);

assert.strictEqual(
  evaluateVisionResponse(payload({
    labels: [
      { description: 'Person', score: 0.94 },
      { description: 'Man', score: 0.93 },
    ],
  })).allowed,
  true,
);

assert.strictEqual(
  evaluateVisionResponse(payload({
    labels: [{ description: 'Person', score: 0.94 }],
  })).reason,
  'ambiguous_person',
);

assert.strictEqual(
  evaluateVisionResponse(payload({
    faces: [{ detectionConfidence: 0.99 }],
  })).reason,
  'ambiguous_face',
);

assert.strictEqual(
  evaluateVisionResponse(payload({
    faces: [{ detectionConfidence: 0.99 }],
    labels: [{ description: 'Man', score: 0.95 }],
  })).allowed,
  true,
);

assert.strictEqual(
  evaluateVisionResponse(payload({ racy: 'POSSIBLE' })).reason,
  'racy_content',
);

assert.strictEqual(
  evaluateVisionResponse(payload({ adult: 'LIKELY' })).reason,
  'adult_content',
);

assert.strictEqual(
  evaluateVisionResponse(payload({
    labels: [{ description: 'Bikini', score: 0.91 }],
  })).reason,
  'revealing_clothing',
);

const previous = process.env.GOOGLE_VISION_API_KEY;
delete process.env.GOOGLE_VISION_API_KEY;

moderateImage(Buffer.from('fake-image')).then(result => {
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'vision_not_configured');

  process.env.GOOGLE_VISION_API_KEY = 'test-key';
  let requestBody = null;
  return moderateImage(Buffer.from('image-bytes'), async (url, options) => {
    assert.ok(String(url).includes('vision.googleapis.com/v1/images:annotate?key=test-key'));
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return payload({
          labels: [{ description: 'Woman', score: 0.99 }],
        });
      },
    };
  }).then(remote => {
    assert.strictEqual(remote.allowed, false);
    assert.strictEqual(remote.reason, 'female_detected');
    const types = requestBody.requests[0].features.map(x => x.type);
    assert.ok(types.includes('SAFE_SEARCH_DETECTION'));
    assert.ok(types.includes('LABEL_DETECTION'));
    assert.ok(types.includes('FACE_DETECTION'));
  });
}).finally(() => {
  if (previous === undefined) delete process.env.GOOGLE_VISION_API_KEY;
  else process.env.GOOGLE_VISION_API_KEY = previous;
}).then(() => {
  console.log('HAREDI_STRICT image moderation: all tests passed');
}).catch(err => {
  console.error(err);
  process.exit(1);
});
