// Fixed V1 category taxonomy for the app-store catalog (see
// docs/app-store-catalog.md). Stable machine keys are what's stored in
// apps_catalog.category and synced to devices; Hebrew labels are
// presentation-only and applied here so the admin panel and Android never
// have to keep their own translation in sync independently.
//
// "הכל"/"כל" (show everything) is a UI-only filter state, never a stored
// category - it deliberately has no entry here.
const CATEGORIES = [
  { key: 'transport', label: 'תחבורה' },
  { key: 'communication', label: 'תקשורת' },
  { key: 'finance', label: 'כספים' },
  { key: 'navigation', label: 'ניווט' },
  { key: 'education', label: 'לימודים' },
  { key: 'games', label: 'משחקים' },
  { key: 'tools', label: 'כלים' },
  { key: 'shopping', label: 'קניות' },
  { key: 'health', label: 'בריאות' },
  { key: 'music', label: 'מוזיקה' },
  { key: 'video', label: 'וידאו' },
  { key: 'other', label: 'אחר' },
];

const DEFAULT_CATEGORY = 'other';
const CATEGORY_KEYS = new Set(CATEGORIES.map(c => c.key));
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]));

function isValidCategoryKey(key) {
  return typeof key === 'string' && CATEGORY_KEYS.has(key);
}

function categoryLabel(key) {
  return CATEGORY_LABELS[key] || CATEGORY_LABELS[DEFAULT_CATEGORY];
}

// Google Play's own genreId taxonomy (see google-play-scraper's
// IAppItemFullDetail.genreId / the library's `category` enum) mapped to our
// fixed V1 set. This is a deterministic lookup table against Google's own
// documented categories, not a classifier - genres with no confident fit
// (e.g. LIFESTYLE, PARENTING, PHOTOGRAPHY) intentionally map to nothing
// here rather than being forced into a wrong-feeling bucket; the caller
// treats a null/unmapped result exactly like "Play gave no reliable
// category" and falls back to DEFAULT_CATEGORY. No AI/heuristic classifier
// involved - see docs/app-store-catalog.md for why each ambiguous genre
// landed where it did (or didn't).
const PLAY_GENRE_TO_CATEGORY = {
  COMMUNICATION: 'communication',
  SOCIAL: 'communication',
  FINANCE: 'finance',
  MAPS_AND_NAVIGATION: 'navigation',
  TRAVEL_AND_LOCAL: 'navigation',
  AUTO_AND_VEHICLES: 'transport',
  EDUCATION: 'education',
  BOOKS_AND_REFERENCE: 'education',
  TOOLS: 'tools',
  PRODUCTIVITY: 'tools',
  PERSONALIZATION: 'tools',
  BUSINESS: 'tools',
  SHOPPING: 'shopping',
  HEALTH_AND_FITNESS: 'health',
  MEDICAL: 'health',
  MUSIC_AND_AUDIO: 'music',
  VIDEO_PLAYERS: 'video',
  ENTERTAINMENT: 'video',
};

/**
 * Maps a Google Play genreId (e.g. "COMMUNICATION", "GAME_PUZZLE") to one of
 * our V1 category keys, or null if there's no confident mapping - the
 * caller (db.addAppToCatalog) treats null as "no suggestion" and falls back
 * to DEFAULT_CATEGORY, never guesses further here.
 */
function categoryFromPlayGenreId(genreId) {
  if (typeof genreId !== 'string' || !genreId) return null;
  if (genreId === 'GAME' || genreId.startsWith('GAME_')) return 'games';
  return PLAY_GENRE_TO_CATEGORY[genreId] || null;
}

module.exports = {
  CATEGORIES,
  DEFAULT_CATEGORY,
  CATEGORY_KEYS,
  isValidCategoryKey,
  categoryLabel,
  categoryFromPlayGenreId,
};
