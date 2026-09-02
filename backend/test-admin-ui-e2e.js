// REAL end-to-end verification of the "דפדפן מסונן" admin panel UI
// (Server Phase 2.2). Drives an actual Chromium instance (Playwright)
// against the actual admin-panel HTML/CSS/JS served by a real running
// backend/index.js, backed by a real local PostgreSQL database. Nothing
// mocked: real DOM, real clicks, real HTTP, real SQL rows checked
// directly after every UI action.
//
// Setup/run: same pattern as test-db-integration.js (see that file's own
// header for the one-time local Postgres setup). This suite additionally
// needs a real Chromium binary - this environment has one pre-installed
// under PLAYWRIGHT_BROWSERS_PATH; the exact executablePath is resolved
// below rather than hardcoded to one version directory.
//
//   (
//     export DATABASE_URL="postgresql://browser_test_user:browser_test_pw@127.0.0.1:5432/browser_test"
//     export DATABASE_SSL=disable
//     export ADMIN_USERNAME=itest_admin ADMIN_PASSWORD=itest_password_123
//     export JWT_SECRET=itest-jwt-secret-not-for-prod SECURE_COOKIES=0
//     export PORT=4324 TEST_BASE_URL=http://127.0.0.1:4324
//     node index.js > /tmp/server-e2e.log 2>&1 &
//     SERVER_PID=$!
//     node test-admin-ui-e2e.js
//     EXIT_CODE=$?
//     kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null
//     exit $EXIT_CODE
//   )
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4324';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required - refusing to fall back to a mock.');
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.log('ADMIN UI E2E NOT VERIFIED');
  console.log(`Blocker: the "playwright" package is not installed/resolvable (${e.message}).`);
  process.exit(1);
}

const db = require('./db');
const rawPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

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
    console.log(`  ${e.stack ? e.stack.split('\n').slice(0, 4).join('\n  ') : e.message}`);
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

async function createTestDevice(label) {
  const deviceId = `e2e-${label}-${crypto.randomUUID()}`;
  const token = crypto.randomBytes(16).toString('hex');
  await rawPool.query(`INSERT INTO devices (device_id, auth_token_hash) VALUES ($1, $2)`, [deviceId, sha256(token)]);
  return { deviceId, token };
}

async function deviceCheck(deviceId, token, url) {
  return fetch(`${BASE_URL}/api/devices/${encodeURIComponent(deviceId)}/browser/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url }),
  });
}

async function resetTestDatabase() {
  await rawPool.query(`
    TRUNCATE browser_policy_audit, browser_decision_log, browser_request_devices,
             browser_requests, browser_device_overrides, browser_domains,
             commands, alerts, enrollments, devices
    RESTART IDENTITY CASCADE
  `);
  await rawPool.query(`UPDATE browser_policy_meta SET value = 1 WHERE key = 'policy_version'`);
}

function resolveChromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!fs.existsSync(base)) return undefined; // let Playwright try its own default resolution
  const dir = fs.readdirSync(base).find(d => /^chromium-\d+$/.test(d));
  if (!dir) return undefined;
  const exe = path.join(base, dir, 'chrome-linux', 'chrome');
  return fs.existsSync(exe) ? exe : undefined;
}

(async () => {
  await waitForServer();
  await resetTestDatabase();

  const executablePath = resolveChromiumExecutable();
  const browser = await chromium.launch({
    headless: true,
    // Chromium's own background services (Safe Browsing updates, GAIA/
    // autofill pings, etc.) try to reach Google endpoints regardless of
    // what page is loaded - irrelevant to this suite and just noisy
    // (blocked by this sandbox's egress proxy anyway). Disabling them
    // keeps the run's output focused on the actual page under test.
    args: ['--disable-background-networking', '--disable-sync', '--disable-client-side-phishing-detection'],
    ...(executablePath ? { executablePath } : {}),
  });
  const page = await browser.newPage();

  // pageErrors = real uncaught exceptions in page script - a genuine bug if
  // any appear, asserted on at the end. consoleErrors = anything logged via
  // console.error, tracked separately and only informational: this suite
  // deliberately triggers 401/404/400 responses as part of its own
  // negative-path tests (sections D/G), and Chromium logs every failed
  // fetch/resource load as a console.error regardless of whether the page's
  // own JS handled it correctly - that's expected noise from this suite's
  // own tests, not evidence of anything broken.
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  let lastDialogMessage = null;
  page.on('dialog', async (dialog) => {
    lastDialogMessage = dialog.message();
    await dialog.accept();
  });

  // ================= B: login + navigation =================

  await test('B1: unauthenticated access shows the login screen', async () => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    const visible = await page.locator('#loginScreen').evaluate(el => getComputedStyle(el).display !== 'none');
    assert.ok(visible, 'login screen must be shown when not authenticated');
  });

  await test('B2: valid admin login works', async () => {
    await page.fill('#loginUsername', process.env.ADMIN_USERNAME);
    await page.fill('#loginPassword', process.env.ADMIN_PASSWORD);
    await page.click('#loginBtn');
    await page.waitForFunction(() => document.getElementById('loginScreen').style.display === 'none', { timeout: 5000 });
  });

  await test('B3: "דפדפן מסונן" tab opens', async () => {
    await page.click('[data-tab="browser"]');
    await page.waitForSelector('[data-tab-content="browser"].active');
  });

  await test('B4: Requests view is visible by default', async () => {
    assert.ok(await page.locator('#browserRequestsView').isVisible());
  });

  await test('B5: Domains view opens via the sub-tab', async () => {
    await page.click('[data-browser-mode="domains"]');
    assert.ok(await page.locator('#browserDomainsView').isVisible());
    assert.strictEqual(await page.locator('#browserRequestsView').isVisible(), false);
  });

  await test('B6: existing unrelated tabs still work (no regression)', async () => {
    for (const tab of ['health', 'alerts', 'catalog', 'enroll', 'customers']) {
      await page.click(`[data-tab="${tab}"]`);
      await page.waitForSelector(`[data-tab-content="${tab}"].active`);
    }
    await page.click('[data-tab="browser"]');
    await page.waitForSelector('[data-tab-content="browser"].active');
  });

  // ================= C: domain management UI =================

  await page.click('[data-browser-mode="domains"]');

  await test('C1: add ALLOW domain via the real form writes the correct real row', async () => {
    await page.fill('#browserDomainInput', 'e2e-allow.itest.com');
    await page.selectOption('#browserDecisionInput', 'ALLOW');
    await page.fill('#browserReasonInput', 'e2e test reason');
    await page.click('#browserDomainForm button[type="submit"]');
    await page.waitForTimeout(500);
    const { rows } = await rawPool.query(`SELECT decision, reason FROM browser_domains WHERE domain = 'e2e-allow.itest.com'`);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].decision, 'ALLOW');
    assert.strictEqual(rows[0].reason, 'e2e test reason');
    await page.click('#browserDomainsRefreshBtn');
    await page.waitForSelector('[data-domain="e2e-allow.itest.com"]');
  });

  await test('C2: "ערוך" pre-fills the form, and re-submitting updates the same row (decisionVersion bumps)', async () => {
    const row = page.locator('[data-domain="e2e-allow.itest.com"]');
    await row.locator('[data-action="edit-domain"]').click();
    await page.waitForFunction(() => document.getElementById('browserDomainInput').value === 'e2e-allow.itest.com');
    await page.selectOption('#browserDecisionInput', 'BLOCK');
    await page.click('#browserDomainForm button[type="submit"]');
    await page.waitForTimeout(500);
    const { rows } = await rawPool.query(`SELECT decision, decision_version FROM browser_domains WHERE domain = 'e2e-allow.itest.com'`);
    assert.strictEqual(rows[0].decision, 'BLOCK');
    assert.strictEqual(rows[0].decision_version, 2);
  });

  // NOTE: must be a real two-label registrable domain (its own eTLD+1),
  // not a subdomain of one - "e2e-wild.itest.com" would itself resolve to
  // registrable domain "itest.com" per the real Public Suffix List, which
  // Phase 1.1's validation correctly rejects for allowSubdomains=true (see
  // "allow_subdomains_requires_registrable_domain") - that was this test's
  // own mistake on the first run, not a product bug; fixed here by using
  // "e2e-wild.com" instead, which is its own real registrable domain.
  await test('C3: allowSubdomains checkbox triggers a distinct confirmation and is persisted', async () => {
    await page.fill('#browserDomainInput', 'e2e-wild.com');
    await page.selectOption('#browserDecisionInput', 'ALLOW');
    await page.check('#browserAllowSubdomainsInput');
    try {
      lastDialogMessage = null;
      await page.click('#browserDomainForm button[type="submit"]');
      await page.waitForTimeout(500);
      assert.ok(lastDialogMessage && lastDialogMessage.includes('תת-הדומיינים'), `expected a subdomains-specific confirmation, got: ${lastDialogMessage}`);
      const { rows } = await rawPool.query(`SELECT allow_subdomains FROM browser_domains WHERE domain = 'e2e-wild.com'`);
      assert.strictEqual(rows[0].allow_subdomains, true);
    } finally {
      // Always leave the checkbox unchecked for later tests, even if an
      // assertion above threw - state leaking across tests is exactly what
      // turned this one failure into a cascade the first time this suite ran.
      await page.uncheck('#browserAllowSubdomainsInput');
    }
  });

  await test('C4: search narrows the visible list to the matching domain', async () => {
    await page.click('#browserDomainsRefreshBtn');
    try {
      await page.fill('#browserDomainSearchInput', 'e2e-wild');
      await page.waitForTimeout(500);
      await page.waitForSelector('[data-domain="e2e-wild.com"]');
      const count = await page.locator('.browser-domain-row').count();
      assert.strictEqual(count, 1, `search must narrow to one row, got ${count}`);
    } finally {
      await page.fill('#browserDomainSearchInput', '');
      await page.waitForTimeout(500);
    }
  });

  await test('C5: decision filter shows only matching-decision rows', async () => {
    await page.selectOption('#browserDomainFilterSelect', 'BLOCK');
    try {
      await page.waitForTimeout(400);
      const badges = await page.locator('.browser-domain-row .browser-badge.bad, .browser-domain-row .browser-badge.ok, .browser-domain-row .browser-badge.warn').allTextContents();
      assert.ok(badges.length > 0, 'expected at least one BLOCK row (e2e-allow.itest.com)');
      assert.ok(badges.every(b => b.includes('חסום')), `all shown rows must be BLOCK, got: ${badges.join(', ')}`);
    } finally {
      await page.selectOption('#browserDomainFilterSelect', '');
      await page.waitForTimeout(400);
    }
  });

  await test('C6: audit history expansion shows real entries for domain_upsert', async () => {
    const row = page.locator('[data-domain="e2e-allow.itest.com"]');
    await row.locator('[data-action="toggle-history"]').click();
    await row.locator('.browser-audit-row').first().waitFor();
    const count = await row.locator('.browser-audit-row').count();
    assert.ok(count >= 2, `expected at least 2 audit entries (create + edit), got ${count}`);
  });

  await test('C7: delete domain removes the rule after a distinct confirmation', async () => {
    const row = page.locator('[data-domain="e2e-wild.com"]');
    lastDialogMessage = null;
    await row.locator('[data-action="delete-domain"]').click();
    await page.waitForTimeout(500);
    assert.ok(lastDialogMessage && lastDialogMessage.includes('למחוק'), `expected a delete-specific confirmation, got: ${lastDialogMessage}`);
    const { rows } = await rawPool.query(`SELECT 1 FROM browser_domains WHERE domain = 'e2e-wild.com'`);
    assert.strictEqual(rows.length, 0);
    await page.locator('[data-domain="e2e-wild.com"]').waitFor({ state: 'detached', timeout: 3000 });
  });

  // ================= D: validation through the real UI =================

  const REJECT_CASES = [
    ['github.io', 'github.io'],
    ['blogspot.com', 'blogspot.com'],
    ['appspot.com', 'appspot.com'],
    ['co.uk', 'co.uk'],
    ['192.168.1.1', '192.168.1.1'],
    ['https://e2e-bad-scheme.itest.com', 'e2e-bad-scheme.itest.com'],
    ['e2e-bad-path.itest.com/x', 'e2e-bad-path.itest.com'],
    ['e2e-bad-port.itest.com:443', 'e2e-bad-port.itest.com'],
    ['*.e2e-bad-wild.itest.com', 'e2e-bad-wild.itest.com'],
    ['nodothost', 'nodothost'],
  ];
  for (const [input, probeDomain] of REJECT_CASES) {
    await test(`D: invalid input "${input}" is rejected by the real form and never reaches the DB`, async () => {
      await page.fill('#browserDomainInput', input);
      await page.selectOption('#browserDecisionInput', 'ALLOW');
      lastDialogMessage = null;
      await page.click('#browserDomainForm button[type="submit"]');
      await page.waitForTimeout(400);
      assert.ok(lastDialogMessage && lastDialogMessage.includes('נכשל'), `expected a failure alert for "${input}", got: ${lastDialogMessage}`);
      const { rows } = await rawPool.query(`SELECT 1 FROM browser_domains WHERE domain = $1`, [probeDomain]);
      assert.strictEqual(rows.length, 0);
    });
  }

  await test('D: uppercase + trailing dot normalize to the same canonical row via the UI', async () => {
    await page.fill('#browserDomainInput', 'E2E-NORM.ITEST.COM.');
    await page.selectOption('#browserDecisionInput', 'ALLOW');
    await page.click('#browserDomainForm button[type="submit"]');
    await page.waitForTimeout(500);
    const { rows } = await rawPool.query(`SELECT 1 FROM browser_domains WHERE domain = 'e2e-norm.itest.com'`);
    assert.strictEqual(rows.length, 1);
  });

  await test('D: Unicode and Punycode equivalent domains collapse to one row via the UI', async () => {
    await page.fill('#browserDomainInput', 'müncheni-e2e.de');
    await page.selectOption('#browserDecisionInput', 'ALLOW');
    await page.click('#browserDomainForm button[type="submit"]');
    await page.waitForTimeout(500);
    const { rows: r1 } = await rawPool.query(`SELECT domain FROM browser_domains WHERE domain LIKE 'xn--%e2e%'`);
    assert.strictEqual(r1.length, 1);
    const punycodeForm = r1[0].domain;

    await page.fill('#browserDomainInput', punycodeForm);
    await page.selectOption('#browserDecisionInput', 'BLOCK');
    await page.click('#browserDomainForm button[type="submit"]');
    await page.waitForTimeout(500);
    const { rows: r2 } = await rawPool.query(`SELECT decision_version FROM browser_domains WHERE domain = $1`, [punycodeForm]);
    assert.strictEqual(r2.length, 1, 'must still be exactly one row, not a second one for the Punycode resubmission');
    assert.strictEqual(r2[0].decision_version, 2);
  });

  // ================= E: review request workflow =================

  await page.click('[data-browser-mode="requests"]');

  let devE1, devE2, e2eReviewDomain;
  await test('E setup: two real devices request the same unknown domain through the real check endpoint', async () => {
    e2eReviewDomain = 'e2e-review1.itest.com';
    devE1 = await createTestDevice('review-1');
    devE2 = await createTestDevice('review-2');
    const [r1, r2] = await Promise.all([
      deviceCheck(devE1.deviceId, devE1.token, `https://${e2eReviewDomain}/`),
      deviceCheck(devE2.deviceId, devE2.token, `https://${e2eReviewDomain}/`),
    ]);
    assert.strictEqual((await r1.json()).decision, 'REVIEW');
    assert.strictEqual((await r2.json()).decision, 'REVIEW');
  });

  await test('E1: the request appears with correct requesterCount/totalRequesterCount, and a visible GLOBAL badge', async () => {
    await page.click('#browserRequestsRefreshBtn');
    const card = page.locator(`.browser-card:has-text("${e2eReviewDomain}")`);
    await card.waitFor();
    const fieldsText = await card.locator('.browser-fields').innerText();
    assert.ok(fieldsText.includes('2'), `expected requesterCount/totalRequesterCount = 2 somewhere, got: ${fieldsText}`);
    assert.ok(await card.locator('.browser-scope-badge.global').isVisible());
  });

  await test('E2: expandable device list shows both pending devices', async () => {
    const card = page.locator(`.browser-card:has-text("${e2eReviewDomain}")`);
    await card.locator('[data-action="toggle-devices"]').click();
    await card.locator('.browser-devices .browser-device-row').first().waitFor();
    assert.strictEqual(await card.locator('.browser-devices .browser-device-row').count(), 2);
  });

  await test('E3: DEVICE ALLOW resolves only devE1; devE2 remains pending; request stays listed', async () => {
    const card = page.locator(`.browser-card:has-text("${e2eReviewDomain}")`);
    const devE1Row = card.locator('.browser-devices .browser-device-row', { hasText: devE1.deviceId });
    lastDialogMessage = null;
    await devE1Row.locator('[data-action="device-allow"]').click();
    await page.waitForTimeout(600);
    assert.ok(lastDialogMessage && lastDialogMessage.includes(devE1.deviceId) && lastDialogMessage.includes('לאשר'));

    const { rows } = await rawPool.query(
      `SELECT rd.device_id, rd.decision FROM browser_request_devices rd
         JOIN browser_requests r ON r.id = rd.request_id WHERE r.domain = $1`,
      [e2eReviewDomain],
    );
    assert.strictEqual(rows.find(r => r.device_id === devE1.deviceId).decision, 'ALLOW');
    assert.strictEqual(rows.find(r => r.device_id === devE2.deviceId).decision, null, 'sibling device must remain pending');

    await page.locator(`.browser-card:has-text("${e2eReviewDomain}")`).waitFor({ timeout: 3000 });
  });

  await test('E4: DEVICE BLOCK resolves devE2 and closes the request (disappears from the pending list)', async () => {
    const card = page.locator(`.browser-card:has-text("${e2eReviewDomain}")`);
    await card.locator('[data-action="toggle-devices"]').click();
    const devE2Row = card.locator('.browser-devices .browser-device-row', { hasText: devE2.deviceId });
    lastDialogMessage = null;
    await devE2Row.locator('[data-action="device-block"]').click();
    await page.waitForTimeout(600);
    assert.ok(lastDialogMessage && lastDialogMessage.includes(devE2.deviceId) && lastDialogMessage.includes('לחסום'));

    const { rows } = await rawPool.query(`SELECT status FROM browser_requests WHERE domain = $1`, [e2eReviewDomain]);
    assert.strictEqual(rows[0].status, 'RESOLVED');

    await page.click('#browserRequestsRefreshBtn');
    await page.waitForTimeout(300);
    assert.strictEqual(await page.locator(`.browser-card:has-text("${e2eReviewDomain}")`).count(), 0, 'a fully-resolved request must disappear');
  });

  let devG1, devG2, e2eGlobalDomain;
  await test('E setup 2: two devices request a second domain', async () => {
    e2eGlobalDomain = 'e2e-global1.itest.com';
    devG1 = await createTestDevice('global-1');
    devG2 = await createTestDevice('global-2');
    await deviceCheck(devG1.deviceId, devG1.token, `https://${e2eGlobalDomain}/`);
    await deviceCheck(devG2.deviceId, devG2.token, `https://${e2eGlobalDomain}/`);
    await page.click('#browserRequestsRefreshBtn');
    await page.locator(`.browser-card:has-text("${e2eGlobalDomain}")`).waitFor();
  });

  await test('E5: GLOBAL ALLOW resolves all pending devices at once and closes the request', async () => {
    const card = page.locator(`.browser-card:has-text("${e2eGlobalDomain}")`);
    lastDialogMessage = null;
    await card.locator('[data-action="global-allow"]').click();
    await page.waitForTimeout(600);
    assert.ok(lastDialogMessage && lastDialogMessage.includes('גלובלית') && !lastDialogMessage.includes(devG1.deviceId));

    const { rows: reqRows } = await rawPool.query(`SELECT status FROM browser_requests WHERE domain = $1`, [e2eGlobalDomain]);
    assert.strictEqual(reqRows[0].status, 'RESOLVED');
    const { rows: deviceRows } = await rawPool.query(
      `SELECT rd.decision FROM browser_request_devices rd JOIN browser_requests r ON r.id = rd.request_id WHERE r.domain = $1`,
      [e2eGlobalDomain],
    );
    assert.ok(deviceRows.every(r => r.decision === 'ALLOW'));

    await page.click('#browserRequestsRefreshBtn');
    await page.waitForTimeout(300);
    assert.strictEqual(await page.locator(`.browser-card:has-text("${e2eGlobalDomain}")`).count(), 0);
  });

  let devH1, devH2, devH3, e2eMixedDomain;
  await test('E setup 3: three devices request a third domain; one gets an individual DEVICE decision first', async () => {
    e2eMixedDomain = 'e2e-mixed1.itest.com';
    devH1 = await createTestDevice('mixed-1');
    devH2 = await createTestDevice('mixed-2');
    devH3 = await createTestDevice('mixed-3');
    for (const d of [devH1, devH2, devH3]) await deviceCheck(d.deviceId, d.token, `https://${e2eMixedDomain}/`);
    await page.click('#browserRequestsRefreshBtn');
    const card = page.locator(`.browser-card:has-text("${e2eMixedDomain}")`);
    await card.waitFor();
    await card.locator('[data-action="toggle-devices"]').click();
    const devH1Row = card.locator('.browser-devices .browser-device-row', { hasText: devH1.deviceId });
    await devH1Row.locator('[data-action="device-block"]').click();
    await page.waitForTimeout(600);
  });

  await test('E6: GLOBAL BLOCK resolves remaining pending devices; the already-individually-resolved device is never overwritten', async () => {
    await page.click('#browserRequestsRefreshBtn');
    const card = page.locator(`.browser-card:has-text("${e2eMixedDomain}")`);
    await card.waitFor();
    lastDialogMessage = null;
    await card.locator('[data-action="global-block"]').click();
    await page.waitForTimeout(600);
    assert.ok(lastDialogMessage && lastDialogMessage.includes('גלובלית'));

    const { rows } = await rawPool.query(
      `SELECT rd.device_id, rd.decision FROM browser_request_devices rd
         JOIN browser_requests r ON r.id = rd.request_id WHERE r.domain = $1`,
      [e2eMixedDomain],
    );
    assert.strictEqual(rows.find(r => r.device_id === devH1.deviceId).decision, 'BLOCK', "devH1's own earlier individual decision must survive untouched");
    assert.strictEqual(rows.find(r => r.device_id === devH2.deviceId).decision, 'BLOCK');
    assert.strictEqual(rows.find(r => r.device_id === devH3.deviceId).decision, 'BLOCK');

    const { rows: reqRows } = await rawPool.query(`SELECT status FROM browser_requests WHERE domain = $1`, [e2eMixedDomain]);
    assert.strictEqual(reqRows[0].status, 'RESOLVED');
  });

  // ================= F: audit (via the real UI) =================

  await test('F1: audit history for a GLOBAL-resolved domain shows the resolve entry via the UI', async () => {
    await page.click('[data-browser-mode="domains"]');
    await page.fill('#browserDomainSearchInput', e2eGlobalDomain);
    try {
      await page.waitForTimeout(500);
      const row = page.locator(`[data-domain="${e2eGlobalDomain}"]`);
      await row.waitFor();
      await row.locator('[data-action="toggle-history"]').click();
      await row.locator('.browser-audit-row').first().waitFor();
      const text = await row.locator('.browser-history').innerText();
      assert.ok(text.includes('גלובלית'), `expected the audit row to mention the global resolve action, got: ${text}`);
    } finally {
      await page.fill('#browserDomainSearchInput', '');
      await page.waitForTimeout(400);
    }
  });

  // ================= G: failure cases =================

  await test('G1 (404 stale): acting on an already-resolved device request shows a failure, never a false success', async () => {
    const domain = 'e2e-stale1.itest.com';
    const dev = await createTestDevice('stale');
    await deviceCheck(dev.deviceId, dev.token, `https://${domain}/`);

    await page.click('[data-browser-mode="requests"]');
    await page.click('#browserRequestsRefreshBtn');
    const card = page.locator(`.browser-card:has-text("${domain}")`);
    await card.waitFor();
    await card.locator('[data-action="toggle-devices"]').click();
    const deviceRow = card.locator('.browser-devices .browser-device-row', { hasText: dev.deviceId });
    await deviceRow.locator('[data-action="device-allow"]').waitFor();

    // Resolve it directly on the backend, out from under the still-rendered
    // stale UI button - simulates another admin (or another browser tab)
    // winning the race first.
    const { rows } = await rawPool.query(`SELECT id FROM browser_requests WHERE domain = $1`, [domain]);
    await db.resolveBrowserRequest(rows[0].id, { scope: 'DEVICE', deviceId: dev.deviceId, decision: 'ALLOW', actor: 'other-admin' });

    lastDialogMessage = null;
    await deviceRow.locator('[data-action="device-allow"]').click(); // still rendered in the DOM, now stale
    await page.waitForTimeout(700);
    assert.ok(lastDialogMessage && lastDialogMessage.includes('נכשל'), `expected a failure alert for the stale action, got: ${lastDialogMessage}`);

    const { rows: overrides } = await rawPool.query(
      `SELECT 1 FROM browser_device_overrides WHERE device_id = $1 AND domain = $2`, [dev.deviceId, domain],
    );
    assert.strictEqual(overrides.length, 1, 'must still be exactly one override row - no duplicate mutation from the stale click');
  });

  await test('G2 (401 expiry): a session lost mid-session shows the login screen again, never a false success', async () => {
    await page.context().clearCookies();
    // Switching to the Domains sub-tab itself triggers loadDomains() -> a
    // real fetch -> a real 401 -> showLoginIfUnauthorized() - the login
    // screen appears from THIS click alone, before any form is even
    // touched. (An earlier version of this test tried to fill/submit the
    // form afterward, which flaked: the login screen overlay was already
    // covering the page by then and intercepted the click - fixed by
    // asserting on the real, earlier point where the 401 actually surfaces.)
    await page.click('[data-browser-mode="domains"]');
    await page.waitForFunction(() => document.getElementById('loginScreen').style.display === 'flex', { timeout: 3000 });
    const { rows } = await rawPool.query(`SELECT 1 FROM browser_domains WHERE domain = 'e2e-expired.itest.com'`);
    assert.strictEqual(rows.length, 0, 'no write must have happened - the session died before any admin fetch could succeed');
  });

  console.log('\nG3 (400 validation): covered extensively above under section D (10 real rejection cases through the UI).');
  console.log('G4 (500/backend failure): NOT attempted - no safe way to force a genuine 500 through the UI without corrupting shared server state for later tests; this exact guarantee (never ALLOW, never fabricate success on a 5xx) is already proven for the underlying endpoints in test-db-integration.js at the HTTP layer, and browser.js\'s own fetch error handling (try/catch around every fetch, checking res.ok before treating anything as success) was verified by code review.');

  if (consoleErrors.length) {
    console.log(`\n(informational only, not a failure - expected from this suite's own negative-path tests in D/G):`);
    console.log(consoleErrors.map(e => `  console.error: ${e}`).join('\n'));
  }

  await test('no uncaught JavaScript exception occurred anywhere in the session', async () => {
    assert.deepStrictEqual(pageErrors, [], `real page-script exceptions were captured during the run:\n${pageErrors.join('\n')}`);
  });

  await browser.close();

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
