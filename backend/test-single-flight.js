'use strict';

const assert = require('assert');
const { SingleFlight } = require('./singleFlight');

(async () => {
  const sf = new SingleFlight();
  let calls = 0;

  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      sf.run('same-image', async () => {
        calls += 1;
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'decision';
      })
    )
  );

  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(results, Array(10).fill('decision'));
  assert.strictEqual(sf.size(), 0);

  let failedCalls = 0;
  await assert.rejects(
    sf.run('retry-image', async () => {
      failedCalls += 1;
      throw new Error('temporary');
    }),
    /temporary/,
  );
  assert.strictEqual(sf.size(), 0);

  const retry = await sf.run('retry-image', async () => {
    failedCalls += 1;
    return 'ok';
  });
  assert.strictEqual(retry, 'ok');
  assert.strictEqual(failedCalls, 2);

  console.log('SingleFlight: all tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
