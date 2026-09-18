'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const db = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'admin-panel', 'index.html'), 'utf8');
const panelJs = fs.readFileSync(path.join(root, 'admin-panel', 'browser-review.js'), 'utf8');

function must(text, pattern, message) {
  if (!pattern.test(text)) throw new Error(message);
}

must(db, /CREATE TABLE IF NOT EXISTS browser_review_requests/, 'browser review queue table missing');
must(db, /status IN \('PENDING','APPROVED','BLOCKED'\)/, 'review status constraint missing');
must(db, /source = 'ADMIN_BLOCK'/, 'durable admin block lookup missing');
must(index, /queueBrowserReview\(host, saved\.reason\)/, 'classifier block must queue review');
must(index, /getBrowserDomainBlockEntry\(host\)/, 'admin block must short-circuit browser check');
must(index, /\/api\/browser\/review-requests', browserAllowlistAdminRateLimit, requireAdmin/, 'admin review list must require auth and rate limit');
must(index, /\/api\/browser\/review-requests\/:id\/approve/, 'approve endpoint missing');
must(index, /\/api\/browser\/review-requests\/:id\/block/, 'block endpoint missing');
must(panel, /data-tab="browser"/, 'browser admin tab missing');
must(panel, /browser-review\.js/, 'browser review panel script missing');
must(panelJs, /rel="noopener noreferrer"/, 'review link must isolate opened site');
must(panelJs, /data-browser-approve/, 'approve control missing');
must(panelJs, /data-browser-block/, 'block control missing');

console.log('browser review queue static checks passed');
