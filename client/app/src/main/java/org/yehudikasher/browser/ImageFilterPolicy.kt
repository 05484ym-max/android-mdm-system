package org.yehudikasher.browser

/**
 * Whether a resolved image classification should be hidden (placeholder -
 * see BlockedResponse.placeholderImage) or shown as-is, for a given
 * FilterLevel.
 *
 * Every level applies the same fail-closed rule today: BLOCK and ERROR
 * both hide, only ALLOW shows. HAREDI_STRICT is the level this was
 * explicitly specified for (and the one shipped as the default);
 * RELIGIOUS_STRICT/STANDARD get the same treatment for now rather than an
 * unspecified, untested relaxation invented here. Revisit this function
 * if/when those levels are given their own defined image-filtering rules.
 */
object ImageFilterPolicy {
    fun shouldHide(@Suppress("UNUSED_PARAMETER") level: FilterLevel, decision: RemoteDecision): Boolean {
        return decision != RemoteDecision.ALLOW
    }
}
