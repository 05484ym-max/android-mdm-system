// REAL PostgreSQL integration suite for the "חדשות ועדכונים" (customer
// updates / news) feature (branch customer-news-updates). Real local
// Postgres, a real running backend/index.js over real HTTP - nothing here
// is mocked.
//
// ---------------------------------------------------------------------
// One-time local setup:
//
//   service postgresql start
//   sudo -u postgres psql \
//     -c "DROP DATABASE IF EXISTS newsupdates_test;" \
//     -c "DROP ROLE IF EXISTS newsupdates_test_user;" \
//     -c "CREATE ROLE newsupdates_test_user LOGIN PASSWORD 'newsupdates_test_pw';" \
//     -c "CREATE DATABASE newsupdates_test OWNER newsupdates_test_user;"
//
// From backend/, in one shell:
//
//   (
//     export DATABASE_URL="postgresql://newsupdates_test_user:newsupdates_test_pw@127.0.0.1:5432/newsupdates_test"
//     export DATABASE_SSL=disable
//     export ADMIN_USERNAME=itest_admin ADMIN_PASSWORD=itest_password_123
//     export JWT_SECRET=itest-jwt-secret-not-for-prod SECURE_COOKIES=0
//     export PORT=4411 TEST_BASE_URL=http://127.0.0.1:4411
//     node index.js > /tmp/server-news.log 2>&1 &
//     SERVER_PID=$!
//     node test-customer-updates-integration.js
//     EXIT_CODE=$?
//     kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null
//     exit $EXIT_CODE
//   )
// ---------------------------------------------------------------------
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { Pool } = require('pg');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4411';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to run this suite - refusing to fall back to a mock.');
  process.exit(1);
}

const db = require('./db');
const rawPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
rawPool.on('error', err => console.error('idle test pool error:', err.message));

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`FAIL - ${name}`);
    console.log(`  ${e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e.message}`);
  }
}

function sha256(v) {
  return crypto.createHash('sha256').update(v).digest('hex');
}

async function waitForServer(timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`server at ${BASE_URL} did not become ready within ${timeoutMs}ms`);
}

let adminCookie = null;
async function adminLogin() {
  const res = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`admin login failed: HTTP ${res.status}`);
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('login succeeded but no Set-Cookie header was returned');
  adminCookie = setCookie.split(';')[0];
}

async function adminFetch(path, opts = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

async function anonFetch(path, opts = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

async function createTestDevice(label) {
  const deviceId = `news-${label}-${crypto.randomUUID()}`;
  const token = crypto.randomBytes(16).toString('hex');
  await rawPool.query(`INSERT INTO devices (device_id, auth_token_hash) VALUES ($1, $2)`, [deviceId, sha256(token)]);
  return { deviceId, token };
}

async function deviceFetchUpdates(deviceId, token) {
  return fetch(`${BASE_URL}/api/devices/${encodeURIComponent(deviceId)}/updates`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function resetTestDatabase() {
  await rawPool.query(`TRUNCATE customer_updates, commands, alerts, enrollments, devices RESTART IDENTITY CASCADE`);
}

(async () => {
  await waitForServer();
  await db.init();
  await resetTestDatabase();
  await adminLogin();

  // ================= validation =================

  await test('1. create without title is rejected with 400, no row created', async () => {
    const res = await adminFetch('/api/customer-updates', {
      method: 'POST', body: JSON.stringify({ body: 'תוכן בלי כותרת' }),
    });
    assert.strictEqual(res.status, 400);
    const list = await (await adminFetch('/api/customer-updates')).json();
    assert.strictEqual(list.length, 0);
  });

  await test('1b. create with a blank/whitespace-only title is rejected with 400', async () => {
    const res = await adminFetch('/api/customer-updates', {
      method: 'POST', body: JSON.stringify({ title: '   ', body: 'תוכן' }),
    });
    assert.strictEqual(res.status, 400);
  });

  await test('2. create without body is rejected with 400', async () => {
    const res = await adminFetch('/api/customer-updates', {
      method: 'POST', body: JSON.stringify({ title: 'כותרת בלי תוכן' }),
    });
    assert.strictEqual(res.status, 400);
  });

  await test('3. create with non-boolean pinned is rejected with 400', async () => {
    const res = await adminFetch('/api/customer-updates', {
      method: 'POST', body: JSON.stringify({ title: 'כותרת', body: 'תוכן', pinned: 'yes' }),
    });
    assert.strictEqual(res.status, 400);
  });

  await test('4. create with non-boolean published is rejected with 400', async () => {
    const res = await adminFetch('/api/customer-updates', {
      method: 'POST', body: JSON.stringify({ title: 'כותרת', body: 'תוכן', published: 1 }),
    });
    assert.strictEqual(res.status, 400);
  });

  await test('5. create with a title over 200 characters is rejected with 400', async () => {
    const res = await adminFetch('/api/customer-updates', {
      method: 'POST', body: JSON.stringify({ title: 'א'.repeat(201), body: 'תוכן' }),
    });
    assert.strictEqual(res.status, 400);
  });

  await test('6. create with a body over 20000 characters is rejected with 400', async () => {
    const res = await adminFetch('/api/customer-updates', {
      method: 'POST', body: JSON.stringify({ title: 'כותרת', body: 'א'.repeat(20001) }),
    });
    assert.strictEqual(res.status, 400);
  });

  // ================= create/publish lifecycle =================

  let draftId, pinnedPublishedId;

  await test('7. create with pinned/published omitted defaults both to false', async () => {
    const res = await adminFetch('/api/customer-updates', {
      method: 'POST', body: JSON.stringify({ title: 'טיוטה ראשונה', body: 'תוכן טיוטה' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    draftId = body.id;
    assert.strictEqual(body.published, false);
    assert.strictEqual(body.pinned, false);
    assert.strictEqual(body.publishedAt, null);
  });

  await test('8. create with published:true stamps publishedAt immediately', async () => {
    const res = await adminFetch('/api/customer-updates', {
      method: 'POST',
      body: JSON.stringify({ title: 'עדכון נעוץ', body: 'תוכן חשוב', pinned: true, published: true }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    pinnedPublishedId = body.id;
    assert.strictEqual(body.published, true);
    assert.strictEqual(body.pinned, true);
    assert.ok(body.publishedAt, 'publishedAt must be set the moment published:true is created');
  });

  await test('9. admin list returns every row (published and unpublished), newest created first', async () => {
    const list = await (await adminFetch('/api/customer-updates')).json();
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].id, pinnedPublishedId, 'most recently created must be first');
    assert.strictEqual(list[1].id, draftId);
  });

  await test('10. PUT updates only the fields provided (title only), leaves pinned/body untouched', async () => {
    const res = await adminFetch(`/api/customer-updates/${draftId}`, {
      method: 'PUT', body: JSON.stringify({ title: 'טיוטה ראשונה - עודכן' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.title, 'טיוטה ראשונה - עודכן');
    assert.strictEqual(body.body, 'תוכן טיוטה', 'body must be unchanged');
    assert.strictEqual(body.pinned, false, 'pinned must be unchanged');
    assert.strictEqual(body.published, false, 'PUT must never change published state');
  });

  await test('11. PUT with an empty body object is rejected with 400 (never a silent no-op)', async () => {
    const res = await adminFetch(`/api/customer-updates/${draftId}`, {
      method: 'PUT', body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400);
  });

  await test('12. PUT for a non-existent (but validly-shaped) id returns 404', async () => {
    const res = await adminFetch(`/api/customer-updates/${crypto.randomUUID()}`, {
      method: 'PUT', body: JSON.stringify({ title: 'x' }),
    });
    assert.strictEqual(res.status, 404);
  });

  await test('13. a malformed id is rejected with 400, not a raw DB error/500', async () => {
    const res = await adminFetch('/api/customer-updates/not-a-uuid', {
      method: 'PUT', body: JSON.stringify({ title: 'x' }),
    });
    assert.strictEqual(res.status, 400);
  });

  await test('14. publish sets published=true and stamps publishedAt', async () => {
    const res = await adminFetch(`/api/customer-updates/${draftId}/publish`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.published, true);
    assert.ok(body.publishedAt);
  });

  await test('15. publishing an already-published row is idempotent (publishedAt does not change)', async () => {
    const before = await (await adminFetch('/api/customer-updates')).json();
    const beforeAt = before.find(u => u.id === draftId).publishedAt;
    await new Promise(r => setTimeout(r, 50));
    const res = await adminFetch(`/api/customer-updates/${draftId}/publish`, { method: 'POST' });
    const body = await res.json();
    assert.strictEqual(body.publishedAt, beforeAt, 'republishing an already-published row must not bump publishedAt');
  });

  await test('16. unpublish sets published=false but preserves publishedAt history', async () => {
    const before = await (await adminFetch('/api/customer-updates')).json();
    const beforeAt = before.find(u => u.id === draftId).publishedAt;
    const res = await adminFetch(`/api/customer-updates/${draftId}/unpublish`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.published, false);
    assert.strictEqual(body.publishedAt, beforeAt, 'unpublish must not erase the last publishedAt');
  });

  await test('16b. publish/unpublish on a non-existent id returns 404', async () => {
    const fakeId = crypto.randomUUID();
    const pub = await adminFetch(`/api/customer-updates/${fakeId}/publish`, { method: 'POST' });
    const unpub = await adminFetch(`/api/customer-updates/${fakeId}/unpublish`, { method: 'POST' });
    assert.strictEqual(pub.status, 404);
    assert.strictEqual(unpub.status, 404);
  });

  await test('17. delete removes the row; deleting again returns 404', async () => {
    const res = await adminFetch(`/api/customer-updates/${draftId}`, { method: 'DELETE' });
    assert.strictEqual(res.status, 200);
    const again = await adminFetch(`/api/customer-updates/${draftId}`, { method: 'DELETE' });
    assert.strictEqual(again.status, 404);
    const list = await (await adminFetch('/api/customer-updates')).json();
    assert.ok(!list.some(u => u.id === draftId));
  });

  // ================= plain text, never HTML-processed =================

  await test('17b. title/body are stored and returned as exact plain text - no HTML processing by the server', async () => {
    const raw = '<script>alert(1)</script> & "quotes" \'apostrophes\'';
    const res = await adminFetch('/api/customer-updates', {
      method: 'POST', body: JSON.stringify({ title: raw, body: raw }),
    });
    const body = await res.json();
    assert.strictEqual(body.title, raw);
    assert.strictEqual(body.body, raw);
    await adminFetch(`/api/customer-updates/${body.id}`, { method: 'DELETE' });
  });

  // ================= admin auth is enforced =================

  await test('18. every admin customer-updates endpoint requires auth (401 without a session)', async () => {
    const validId = pinnedPublishedId;
    const checks = [
      ['GET', '/api/customer-updates'],
      ['POST', '/api/customer-updates'],
      ['PUT', `/api/customer-updates/${validId}`],
      ['DELETE', `/api/customer-updates/${validId}`],
      ['POST', `/api/customer-updates/${validId}/publish`],
      ['POST', `/api/customer-updates/${validId}/unpublish`],
    ];
    for (const [method, path] of checks) {
      const res = await anonFetch(path, { method, body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify({}) });
      assert.strictEqual(res.status, 401, `${method} ${path} must require auth`);
    }
    // Prove none of the above actually mutated anything despite being rejected.
    const list = await (await adminFetch('/api/customer-updates')).json();
    assert.strictEqual(list.find(u => u.id === validId).title, 'עדכון נעוץ');
  });

  // ================= device-facing: published-only, ordering, auth =================

  const { deviceId, token } = await createTestDevice('main');

  await test('19. an unpublished update never appears in the device feed', async () => {
    const draft = await (await adminFetch('/api/customer-updates', {
      method: 'POST', body: JSON.stringify({ title: 'טיוטה נסתרת', body: 'לא לפרסום' }),
    })).json();
    const res = await deviceFetchUpdates(deviceId, token);
    assert.strictEqual(res.status, 200);
    const list = await res.json();
    assert.ok(!list.some(u => u.id === draft.id), 'an unpublished row must never reach a device');
    await adminFetch(`/api/customer-updates/${draft.id}`, { method: 'DELETE' });
  });

  await test('20. ordering: pinned first, then published_at/created_at newest-first', async () => {
    await resetTestDatabase();
    // Seed directly via db.js so publishedAt ordering is deterministic and
    // not at the mercy of real wall-clock timing between HTTP calls.
    const now = Date.now();
    await rawPool.query(
      `INSERT INTO customer_updates (id, title, body, published, pinned, created_at, published_at)
       VALUES
        ($1, 'ישן, לא נעוץ', 'x', true, false, to_timestamp($5/1000.0), to_timestamp($5/1000.0)),
        ($2, 'חדש, לא נעוץ', 'x', true, false, to_timestamp($6/1000.0), to_timestamp($6/1000.0)),
        ($3, 'ישן אך נעוץ', 'x', true, true,  to_timestamp($7/1000.0), to_timestamp($7/1000.0)),
        ($4, 'לא פורסם', 'x', false, true, to_timestamp($8/1000.0), NULL)`,
      [
        crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(),
        now - 300000, now - 60000, now - 500000, now,
      ],
    );
    const { deviceId: d2, token: t2 } = await createTestDevice('order');
    const res = await deviceFetchUpdates(d2, t2);
    const list = await res.json();
    assert.strictEqual(list.length, 3, 'unpublished row must be excluded');
    assert.strictEqual(list[0].title, 'ישן אך נעוץ', 'pinned must always sort first regardless of age');
    assert.strictEqual(list[1].title, 'חדש, לא נעוץ', 'among non-pinned, newest publishedAt first');
    assert.strictEqual(list[2].title, 'ישן, לא נעוץ');
  });

  await test('21. device fetch requires real device auth: missing token 401, wrong token 401, unknown device 404', async () => {
    const { deviceId: d3, token: t3 } = await createTestDevice('auth');
    assert.strictEqual((await deviceFetchUpdates(d3, null)).status, 401);
    assert.strictEqual((await deviceFetchUpdates(d3, 'wrong-token')).status, 401);
    assert.strictEqual((await deviceFetchUpdates('no-such-device-id', t3)).status, 404);
    assert.strictEqual((await deviceFetchUpdates(d3, t3)).status, 200);
  });

  await test('22. device fetch never returns more than 50 items, taking the highest-ranked 50', async () => {
    await resetTestDatabase();
    const rows = [];
    const now = Date.now();
    for (let i = 0; i < 55; i++) {
      rows.push([crypto.randomUUID(), `עדכון ${i}`, now - i * 1000]);
    }
    for (const [id, title, ts] of rows) {
      await rawPool.query(
        `INSERT INTO customer_updates (id, title, body, published, pinned, created_at, published_at)
         VALUES ($1, $2, 'x', true, false, to_timestamp($3/1000.0), to_timestamp($3/1000.0))`,
        [id, title, ts],
      );
    }
    const { deviceId: d4, token: t4 } = await createTestDevice('cap');
    const list = await (await deviceFetchUpdates(d4, t4)).json();
    assert.strictEqual(list.length, 50, 'must be capped at 50 even though 55 are published');
    // rows[0] has the newest published_at (now - 0) - the cap must keep the
    // most-recent 50, i.e. drop the 5 oldest (indices 50-54), not the newest.
    assert.strictEqual(list[0].title, 'עדכון 0');
    assert.strictEqual(list[49].title, 'עדכון 49');
    assert.ok(!list.some(u => u.title === 'עדכון 54'), 'the 5 oldest rows must be dropped by the cap, not the newest');
  });

  // ================= summary =================

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.error.message}`);
  }
  await rawPool.end();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('FATAL (suite could not complete):', e);
  try { await rawPool.end(); } catch { /* ignore */ }
  process.exit(1);
});
