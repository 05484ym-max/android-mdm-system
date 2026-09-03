// Real browser smoke test for the "חדשות ועדכונים" admin UI (news.js /
// news.css). Real headless Chromium, a real running backend/index.js, a
// real local PostgreSQL database - nothing mocked. Scoped to the news tab
// only, not a full admin-panel regression sweep.
//
// ---------------------------------------------------------------------
// One-time setup: same newsupdates_test / newsupdates_test_user database
// as test-customer-updates-integration.js (see that file's header).
//
// From backend/:
//
//   (
//     export DATABASE_URL="postgresql://newsupdates_test_user:newsupdates_test_pw@127.0.0.1:5432/newsupdates_test"
//     export DATABASE_SSL=disable
//     export ADMIN_USERNAME=itest_admin ADMIN_PASSWORD=itest_password_123
//     export JWT_SECRET=itest-jwt-secret-not-for-prod SECURE_COOKIES=0
//     export PORT=4412 TEST_BASE_URL=http://127.0.0.1:4412
//     node index.js > /tmp/server-news-ui.log 2>&1 &
//     SERVER_PID=$!
//     node test-news-ui-smoke.js
//     EXIT_CODE=$?
//     kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null
//     exit $EXIT_CODE
//   )
// ---------------------------------------------------------------------
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4412';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to run this suite - refusing to fall back to a mock.');
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('playwright is not installed/usable in this environment:', e.message);
  console.error('NEWS ADMIN UI SMOKE NOT VERIFIED');
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

async function resetTestDatabase() {
  await rawPool.query(`TRUNCATE customer_updates, commands, alerts, enrollments, devices RESTART IDENTITY CASCADE`);
}

function resolveChromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(require('os').homedir(), '.cache', 'ms-playwright');
  const dirs = fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d));
  if (!dirs.length) throw new Error(`no chromium-* directory found under ${base}`);
  return path.join(base, dirs.sort().pop(), 'chrome-linux', 'chrome');
}

// Polls for the actual expected state rather than a coarser signal that
// could already be true before the real re-render happens - same
// discipline as the other UI smoke suites in this project.
async function waitForCount(getCount, expected, timeoutMs = 8000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await getCount();
    if (last === expected) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for count ${expected} - last seen: ${last}`);
}

(async () => {
  await waitForServer();
  await db.init();
  await resetTestDatabase();

  const executablePath = resolveChromiumExecutable();
  const browser = await chromium.launch({
    executablePath,
    args: ['--disable-background-networking', '--disable-sync', '--disable-client-side-phishing-detection'],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(String(err)));

  try {
    await page.goto(BASE_URL);
    await page.fill('#loginUsername', process.env.ADMIN_USERNAME);
    await page.fill('#loginPassword', process.env.ADMIN_PASSWORD);
    await page.click('#loginBtn');
    await page.waitForSelector('.login-screen', { state: 'hidden', timeout: 10000 }).catch(() => {});

    await page.click('[data-tab="news"]');
    await page.waitForSelector('#newsList', { timeout: 10000 });

    await test('empty state shows a normal message, not an error', async () => {
      const text = await page.locator('#newsList .empty-state').textContent();
      assert.ok(text.includes('אין עדיין הודעות'));
    });

    await test('creating a published, pinned update via the real form works end-to-end', async () => {
      await page.fill('#newsTitleInput', 'הודעה ראשונה');
      await page.fill('#newsBodyInput', 'זהו תוכן ההודעה הראשונה לבדיקה');
      await page.check('#newsPinnedInput');
      await page.check('#newsPublishedInput');
      await page.click('#newsSaveBtn');
      await waitForCount(() => page.locator('.news-card').count(), 1);

      const title = await page.locator('.news-card-title').first().textContent();
      assert.strictEqual(title.trim(), 'הודעה ראשונה');
      const badges = await page.locator('.news-card .news-badge').allTextContents();
      assert.ok(badges.some(b => b.includes('פורסם')));
      assert.ok(badges.some(b => b.includes('חשוב')));

      // Form must reset after a successful save.
      assert.strictEqual(await page.inputValue('#newsTitleInput'), '');
    });

    await test('a draft (unpublished) update shows the draft badge', async () => {
      await page.fill('#newsTitleInput', 'טיוטה');
      await page.fill('#newsBodyInput', 'תוכן טיוטה שלא פורסמה');
      await page.click('#newsSaveBtn');
      await waitForCount(() => page.locator('.news-card').count(), 2);

      const draftCard = page.locator('.news-card', { hasText: 'טיוטה' });
      const badges = await draftCard.locator('.news-badge').allTextContents();
      assert.ok(badges.some(b => b.includes('טיוטה')));
    });

    await test('admin-authored text containing HTML-like characters is escaped, never rendered as markup', async () => {
      const raw = '<img src=x onerror=alert(1)>';
      await page.fill('#newsTitleInput', raw);
      await page.fill('#newsBodyInput', 'תוכן בדיקת בריחה');
      await page.click('#newsSaveBtn');
      await waitForCount(() => page.locator('.news-card').count(), 3);

      // If this ever renders unescaped, the literal <img> tag would become
      // a real broken image element instead of visible text - assert the
      // visible text contains the raw markup as TEXT, and that no such
      // element was actually created in the DOM.
      const titles = await page.locator('.news-card-title').allTextContents();
      assert.ok(titles.some(t => t.includes('<img src=x onerror=alert(1)>')));
      const injectedImages = await page.locator('.news-card-title img').count();
      assert.strictEqual(injectedImages, 0, 'the <img> must never be parsed as a real element');
    });

    await test('editing an update pre-fills the form and PUT updates it in place (no duplicate)', async () => {
      // Locate by the actual "טיוטה" title precisely (avoid matching the
      // escaped-HTML card above by accident).
      const editBtn = page.locator('.news-card', { hasText: 'טיוטה' })
        .filter({ hasNotText: 'בדיקת בריחה' })
        .locator('[data-edit]');
      await editBtn.click();
      assert.strictEqual(await page.inputValue('#newsTitleInput'), 'טיוטה');
      await page.fill('#newsTitleInput', 'טיוטה - עודכנה');
      await page.click('#newsSaveBtn');
      await waitForCount(() => page.locator('.news-card', { hasText: 'טיוטה - עודכנה' }).count(), 1);
      // Still 3 cards total - an edit must never create a duplicate.
      await waitForCount(() => page.locator('.news-card').count(), 3);
    });

    await test('publish/unpublish buttons on a card toggle its state for real', async () => {
      const card = page.locator('.news-card', { hasText: 'טיוטה - עודכנה' });
      await card.locator('[data-publish]').click();
      await waitForCount(() => card.locator('.news-badge.published').count(), 1);
      await card.locator('[data-unpublish]').click();
      await waitForCount(() => card.locator('.news-badge.draft').count(), 1);
    });

    await test('deleting an update removes its card for real', async () => {
      const card = page.locator('.news-card', { hasText: 'טיוטה - עודכנה' });
      page.once('dialog', dialog => dialog.accept());
      await card.locator('.news-delete-btn').click();
      await waitForCount(() => page.locator('.news-card').count(), 2);
    });

    await test('no uncaught page errors occurred during the whole flow', () => {
      assert.deepStrictEqual(pageErrors, []);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.log('\nFailures:');
      for (const f of failures) console.log(`  - ${f.name}: ${f.error.message}`);
    }
  } finally {
    await browser.close();
    await rawPool.end();
  }
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error('FATAL (suite could not complete):', e);
  process.exit(1);
});
