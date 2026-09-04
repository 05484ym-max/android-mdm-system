'use strict';

const assert = require('assert');
const { Pool } = require('pg');
const db = require('./db');
const { shouldPromoteToAllowlist } = require('./browserClassifier');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const rawPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
rawPool.on('error', err => console.error('idle test pool error:', err.message));

// Mirrors index.js's maybePromoteToAllowlist() exactly: the real exported
// gate (already unit-tested in test-browser-classifier.js) composed with the
// real DB write. index.js itself starts a live server on require and cannot
// be imported directly, so this is the same composition exercised end to
// end against a real database instead.
async function maybePromoteToAllowlist(host, classification) {
  if (!shouldPromoteToAllowlist(classification)) return null;
  return db.upsertAutoBrowserDomainAllowlistEntry({
    host,
    reason: classification.reason,
    categories: classification.categories || [],
  });
}

function safeClassification(host) {
  return {
    host,
    allowed: true,
    reason: 'safe_category',
    categories: [{ id: 'IAB19', parent: 'IAB19', label: 'Technology & Computing', confident: true, score: 0.95 }],
    source: 'webshrinker',
  };
}

(async () => {
  await db.init();

  // ---- 1. First safe classification persists exact host to allowlist ----
  const host1 = 'safe-site-' + Date.now() + '.example';
  assert.strictEqual(await db.getBrowserDomainAllowlistEntry(host1), null, 'must start absent');
  const promoted = await maybePromoteToAllowlist(host1, safeClassification(host1));
  assert.ok(promoted, 'a safe_category classification must promote');
  assert.strictEqual(promoted.host, host1);
  assert.strictEqual(promoted.enabled, true);
  assert.strictEqual(promoted.source, 'AUTO_CLASSIFIER');
  assert.deepStrictEqual(promoted.categories, safeClassification(host1).categories);

  // ---- 3. Persistence survives a new request/process/DB lookup ----
  // Simulated by a completely fresh read through db.js, exactly as a new
  // incoming HTTP request would perform - no in-memory state is reused.
  const reread = await db.getBrowserDomainAllowlistEntry(host1);
  assert.ok(reread, 'must persist across a fresh lookup');
  assert.strictEqual(reread.host, host1);
  assert.strictEqual(reread.enabled, true);

  // ---- 4. Shared fleet behavior: another device benefits from the same allowlist ----
  // The table has no per-device column at all - two independent lookups (as
  // if from two different devices/processes) both see the same entry.
  const deviceARead = await db.getBrowserDomainAllowlistEntry(host1);
  const deviceBRead = await db.getBrowserDomainAllowlistEntry(host1);
  assert.ok(deviceARead && deviceBRead, 'both simulated devices must see the entry');
  assert.strictEqual(deviceARead.host, deviceBRead.host);

  // ---- 5. sub.example.com does NOT inherit example.com's allowlisting ----
  const parentHost = 'parent-' + Date.now() + '.example';
  const subHost = 'sub.' + parentHost;
  await maybePromoteToAllowlist(parentHost, safeClassification(parentHost));
  assert.ok(await db.getBrowserDomainAllowlistEntry(parentHost), 'parent must be allowlisted');
  assert.strictEqual(
    await db.getBrowserDomainAllowlistEntry(subHost),
    null,
    'a subdomain must NEVER inherit its parent domain\'s allowlist entry',
  );

  // ---- 6. A transient classifier result never creates an allowlist entry ----
  const transientHost = 'transient-' + Date.now() + '.example';
  const transientResult = await maybePromoteToAllowlist(transientHost, {
    host: transientHost, allowed: false, reason: 'classifier_unreachable', categories: [],
  });
  assert.strictEqual(transientResult, null);
  assert.strictEqual(await db.getBrowserDomainAllowlistEntry(transientHost), null);

  // ---- 7. A blocked classification never creates an allowlist entry ----
  const blockedHost = 'blocked-' + Date.now() + '.example';
  await maybePromoteToAllowlist(blockedHost, {
    host: blockedHost, allowed: false, reason: 'category_not_allowed', categories: [],
  });
  assert.strictEqual(await db.getBrowserDomainAllowlistEntry(blockedHost), null);

  // ---- 8. A low-confidence classification never creates an allowlist entry ----
  const lowConfHost = 'lowconf-' + Date.now() + '.example';
  await maybePromoteToAllowlist(lowConfHost, {
    host: lowConfHost, allowed: false, reason: 'classification_not_confident', categories: [],
  });
  assert.strictEqual(await db.getBrowserDomainAllowlistEntry(lowConfHost), null);

  // ---- 9. A malformed classification result never creates an allowlist entry ----
  const malformedHost = 'malformed-' + Date.now() + '.example';
  await maybePromoteToAllowlist(malformedHost, { host: malformedHost });
  await maybePromoteToAllowlist(malformedHost, null);
  await maybePromoteToAllowlist(malformedHost, undefined);
  assert.strictEqual(await db.getBrowserDomainAllowlistEntry(malformedHost), null);

  // ---- 10. Admin revoke immediately stops the allowlist fast path (DB layer) ----
  const revokeHost = 'revoke-' + Date.now() + '.example';
  await maybePromoteToAllowlist(revokeHost, safeClassification(revokeHost));
  assert.ok(await db.getBrowserDomainAllowlistEntry(revokeHost), 'must be allowlisted before revoke');
  const revoked = await db.revokeBrowserDomainAllowlistEntry(revokeHost);
  assert.ok(revoked);
  assert.strictEqual(revoked.enabled, false);
  assert.ok(revoked.revokedAt);
  assert.strictEqual(
    await db.getBrowserDomainAllowlistEntry(revokeHost),
    null,
    'the very next lookup after revoke must no longer see the entry',
  );

  // Revoking is a soft-delete, not a DELETE - history must be preserved,
  // findable directly (not via the fast-path getter, which correctly hides it).
  const { rows: historyRows } = await rawPool.query(
    'SELECT host, enabled, revoked_at FROM browser_domain_allowlist WHERE host = $1',
    [revokeHost],
  );
  assert.strictEqual(historyRows.length, 1, 'revoke must not delete the row');
  assert.strictEqual(historyRows[0].enabled, false);
  assert.ok(historyRows[0].revoked_at);

  // A revoked host must NOT be silently resurrected by the automatic
  // classifier promoting it again - only an explicit admin action can.
  await maybePromoteToAllowlist(revokeHost, safeClassification(revokeHost));
  assert.strictEqual(
    await db.getBrowserDomainAllowlistEntry(revokeHost),
    null,
    'AUTO_CLASSIFIER must never resurrect a revoked host',
  );

  // An explicit admin re-add, in contrast, is allowed to un-revoke.
  const readmitted = await db.upsertAdminBrowserDomainAllowlistEntry({
    host: revokeHost, reason: 'manual_admin_allow', categories: [],
  });
  assert.strictEqual(readmitted.enabled, true);
  assert.strictEqual(readmitted.revokedAt, null);
  assert.strictEqual(readmitted.source, 'ADMIN');
  assert.ok(await db.getBrowserDomainAllowlistEntry(revokeHost), 'admin re-add must un-revoke');

  // ---- listBrowserDomainAllowlist() surfaces entries for the admin UI ----
  const listed = await db.listBrowserDomainAllowlist();
  assert.ok(Array.isArray(listed));
  assert.ok(listed.some(e => e.host === host1));
  assert.ok(listed.some(e => e.host === revokeHost && e.enabled === true));

  console.log('Browser persistent domain allowlist (real PostgreSQL): all tests passed');
  await rawPool.end();
  process.exit(0);
})().catch(async err => {
  console.error(err);
  await rawPool.end().catch(() => {});
  process.exit(1);
});
