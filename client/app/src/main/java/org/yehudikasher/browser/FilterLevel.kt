package org.yehudikasher.browser

import android.content.Context

/**
 * The strictness levels this browser's content policy can run at.
 * HAREDI_STRICT is both the current default and, today, the only level
 * with any behavior actually specified (see ImageFilterPolicy) -
 * RELIGIOUS_STRICT/STANDARD exist as the layer future work targets rather
 * than as levels with their own defined rules yet.
 */
enum class FilterLevel {
    HAREDI_STRICT,
    RELIGIOUS_STRICT,
    STANDARD,
}

/**
 * Local, on-device storage for the current FilterLevel. A fresh install -
 * or any value that fails to parse back (corrupted prefs, a level name
 * from a future app version) - always resolves to the safe default,
 * never to a guess in either direction. Nothing in this class can ever
 * silently move a device to a less strict level; that only ever happens
 * through an explicit setFilterLevel call.
 */
object FilterLevelStore {
    private const val PREFS = "kosher_browser_policy"
    private const val KEY_LEVEL = "filter_level"
    val DEFAULT_LEVEL = FilterLevel.HAREDI_STRICT

    fun currentLevel(context: Context): FilterLevel {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_LEVEL, null) ?: return DEFAULT_LEVEL
        return try {
            FilterLevel.valueOf(raw)
        } catch (_: IllegalArgumentException) {
            DEFAULT_LEVEL
        }
    }

    fun setFilterLevel(context: Context, level: FilterLevel) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_LEVEL, level.name).apply()
    }
}
