package org.yehudikasher.browser

import android.os.SystemClock
import android.util.Log

object BrowserPerf {
    private const val TAG = "YehudiBrowserPerf"

    inline fun <T> measure(
        metric: String,
        source: String,
        block: () -> T,
    ): T {
        val started = SystemClock.elapsedRealtime()
        return try {
            block()
        } finally {
            val elapsed = SystemClock.elapsedRealtime() - started
            record(metric, source, elapsed)
        }
    }

    fun record(metric: String, source: String, elapsedMs: Long) {
        // Deliberately do not log URLs, hosts, search terms or image addresses.
        Log.i(TAG, "metric=$metric source=$source elapsedMs=$elapsedMs")
    }
}
