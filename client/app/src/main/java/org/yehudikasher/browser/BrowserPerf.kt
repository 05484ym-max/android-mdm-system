package org.yehudikasher.browser

import android.util.Log

object BrowserPerf {
    private const val TAG = "YehudiBrowserPerf"

    fun record(metric: String, source: String, elapsedMs: Long) {
        // Deliberately do not log URLs, hosts, search terms or image addresses.
        Log.i(TAG, "metric=$metric source=$source elapsedMs=$elapsedMs")
    }
}
