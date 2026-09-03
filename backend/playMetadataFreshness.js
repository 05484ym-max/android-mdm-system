// Models how much an admin/device should trust the cached Google Play
// metadata on a catalog row - see docs/app-update-check.md for the full
// reasoning. This is deliberately NOT a "does this device need an update"
// answer: the backend only ever sees Google Play's PUBLIC, unauthenticated
// listing data (via playStoreSearch.js), never a specific device's
// installed version or Play's own per-device rollout/eligibility state.
// The one true answer to "does this device need an update" lives in the
// real Play Store app on the device itself (see the Android-flow section
// of the doc) - this module only ever grades the INPUT to that decision,
// never fabricates the decision.
//
// Three-state model, never a boolean "hasUpdate":
//   'fresh'   - checked recently, no error, and the version string itself
//               is usable for a heuristic comparison.
//   'stale'   - we have *some* prior data, but it's too old to trust, or
//               the last check attempt failed.
//   'unknown' - we have nothing trustworthy at all: never checked, or the
//               version signal itself is inherently ambiguous (a staged/
//               multi-APK rollout reporting "Varies with device", or no
//               version string at all).

// Same window the auto-refresh worker (index.js) uses to decide a package
// needs re-checking - one constant, not two copies that could drift apart.
const PLAY_METADATA_FRESH_MS = 30 * 60 * 1000;

// Google Play's own public listing reports this literal string (in
// English, regardless of locale) for a "Current Version" field when an
// app ships different APKs to different device configurations - there is
// no single version to compare against in that case, so treating it as a
// real, comparable version string would be actively misleading (a classic
// "rollout/version mismatch" uncertainty case, not a fresh signal).
const AMBIGUOUS_VERSION_VALUES = new Set(['Varies with device']);

function isVersionAmbiguous(version) {
  return version == null || version === '' || AMBIGUOUS_VERSION_VALUES.has(version);
}

/**
 * Pure function - no DB, no clock dependency beyond the optional `now`
 * override (tests pass a fixed value; production leaves it at Date.now()).
 *
 * Order of checks is deliberate: a never-checked row is 'unknown' even if
 * by coincidence it already has a version string (e.g. from a manual add) -
 * "unknown" here specifically means "we have no confidence signal about
 * freshness", not "we have no data at all". A failed last attempt is
 * 'stale' rather than 'unknown': there IS prior real data, it's just not
 * current - a meaningfully different situation for an admin/device to
 * reason about than "never looked".
 */
function computeMetadataFreshness({ playVersion, playMetadataCheckedAt, playMetadataError }, now = Date.now()) {
  if (playMetadataCheckedAt == null) return 'unknown';
  if (isVersionAmbiguous(playVersion)) return 'unknown';
  if (playMetadataError) return 'stale';
  if (now - playMetadataCheckedAt > PLAY_METADATA_FRESH_MS) return 'stale';
  return 'fresh';
}

module.exports = {
  PLAY_METADATA_FRESH_MS,
  isVersionAmbiguous,
  computeMetadataFreshness,
};
