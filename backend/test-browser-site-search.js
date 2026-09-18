'use strict';

const assert = require('assert');
const siteSearch = require('./browserSiteSearch');

const html = `
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.example.com%2Fpath%3Fx%3D1">Example Site</a>
</div>
<div class="result">
  <a class="result__a" href="https://example.org/about">Example Org</a>
</div>`;

const parsed = siteSearch.parseDuckDuckGoHtml(html);
assert.deepStrictEqual(parsed, [
  { title: 'Example Site', host: 'www.example.com', url: 'https://www.example.com/' },
  { title: 'Example Org', host: 'example.org', url: 'https://example.org/' },
]);
assert.strictEqual(siteSearch.normalizeResultHref('http://example.com'), null);
assert.strictEqual(siteSearch.normalizeResultHref('https://127.0.0.1/'), null);

console.log('browser site search tests passed');
