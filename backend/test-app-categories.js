// Pure (DB-free) unit tests for appCategories.js - same style as
// test-db.js's neighbors on the filtered-browser-server branch: run
// directly with `node test-app-categories.js`, no network/DB needed.
'use strict';

const assert = require('assert');
const cat = require('./appCategories');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

check('CATEGORIES has exactly the 12 fixed V1 stable keys, in order', () => {
  const keys = cat.CATEGORIES.map(c => c.key);
  assert.deepStrictEqual(keys, [
    'transport', 'communication', 'finance', 'navigation', 'education',
    'games', 'tools', 'shopping', 'health', 'music', 'video', 'other',
  ]);
});

check('every category has a non-empty Hebrew label', () => {
  for (const { key, label } of cat.CATEGORIES) {
    assert.ok(typeof label === 'string' && label.trim().length > 0, `${key} must have a label`);
  }
});

check('"הכל"/"all" is not a stored category key', () => {
  assert.strictEqual(cat.CATEGORY_KEYS.has('all'), false);
  assert.strictEqual(cat.CATEGORY_KEYS.has('הכל'), false);
});

check('DEFAULT_CATEGORY is "other" and is a valid key', () => {
  assert.strictEqual(cat.DEFAULT_CATEGORY, 'other');
  assert.strictEqual(cat.isValidCategoryKey('other'), true);
});

check('isValidCategoryKey accepts every fixed key and rejects everything else', () => {
  for (const { key } of cat.CATEGORIES) {
    assert.strictEqual(cat.isValidCategoryKey(key), true, key);
  }
  for (const bad of ['sports', 'transport ', 'Transport', 'TRANSPORT', '', null, undefined, 123, {}, ['games']]) {
    assert.strictEqual(cat.isValidCategoryKey(bad), false, JSON.stringify(bad));
  }
});

check('categoryLabel returns the correct Hebrew label for a known key', () => {
  assert.strictEqual(cat.categoryLabel('transport'), 'תחבורה');
  assert.strictEqual(cat.categoryLabel('finance'), 'כספים');
  assert.strictEqual(cat.categoryLabel('other'), 'אחר');
});

check('categoryLabel falls back to the "אחר" label for an unknown/missing key rather than throwing', () => {
  assert.strictEqual(cat.categoryLabel('not-a-real-category'), 'אחר');
  assert.strictEqual(cat.categoryLabel(null), 'אחר');
  assert.strictEqual(cat.categoryLabel(undefined), 'אחר');
});

check('categoryFromPlayGenreId maps well-known Play genres to the right V1 category', () => {
  const cases = [
    ['COMMUNICATION', 'communication'],
    ['SOCIAL', 'communication'],
    ['FINANCE', 'finance'],
    ['MAPS_AND_NAVIGATION', 'navigation'],
    ['TRAVEL_AND_LOCAL', 'navigation'],
    ['AUTO_AND_VEHICLES', 'transport'],
    ['EDUCATION', 'education'],
    ['BOOKS_AND_REFERENCE', 'education'],
    ['TOOLS', 'tools'],
    ['PRODUCTIVITY', 'tools'],
    ['PERSONALIZATION', 'tools'],
    ['BUSINESS', 'tools'],
    ['SHOPPING', 'shopping'],
    ['HEALTH_AND_FITNESS', 'health'],
    ['MEDICAL', 'health'],
    ['MUSIC_AND_AUDIO', 'music'],
    ['VIDEO_PLAYERS', 'video'],
    ['ENTERTAINMENT', 'video'],
  ];
  for (const [genreId, expected] of cases) {
    assert.strictEqual(cat.categoryFromPlayGenreId(genreId), expected, genreId);
  }
});

check('categoryFromPlayGenreId maps GAME and every GAME_* subtype to "games"', () => {
  for (const genreId of [
    'GAME', 'GAME_ACTION', 'GAME_PUZZLE', 'GAME_CASUAL', 'GAME_ROLE_PLAYING',
    'GAME_STRATEGY', 'GAME_TRIVIA', 'GAME_WORD', 'GAME_SIMULATION',
  ]) {
    assert.strictEqual(cat.categoryFromPlayGenreId(genreId), 'games', genreId);
  }
});

check('categoryFromPlayGenreId returns null (never a guess) for an unmapped or missing genre', () => {
  for (const genreId of [
    'LIFESTYLE', 'PARENTING', 'PHOTOGRAPHY', 'ART_AND_DESIGN', 'BEAUTY',
    'COMICS', 'DATING', 'EVENTS', 'FOOD_AND_DRINK', 'HOUSE_AND_HOME',
    'LIBRARIES_AND_DEMO', 'NEWS_AND_MAGAZINES', 'SPORTS', 'WATCH_FACE',
    'WEATHER', 'FAMILY', 'ANDROID_WEAR', 'APPLICATION', 'not-a-real-genre',
  ]) {
    assert.strictEqual(cat.categoryFromPlayGenreId(genreId), null, genreId);
  }
});

check('categoryFromPlayGenreId never throws on missing/wrong-type input', () => {
  for (const bad of [null, undefined, 123, {}, [], '']) {
    assert.strictEqual(cat.categoryFromPlayGenreId(bad), null, JSON.stringify(bad));
  }
});

console.log(`\n${passed} passed, 0 failed`);
