package org.mdmopen.dpc

import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Hands the standalone filtered browser a narrow browser-only credential.
 *
 * This deliberately does NOT expose the DPC device bearer token. The browser
 * credential can only be used for the browser policy endpoint and is rotated
 * automatically whenever the device auth token rotates.
 */
object BrowserBridge {
    private const val TAG = "BrowserBridge"
    private const val BROWSER_PACKAGE = "org.yehudikasher.browser"
    const val ACTION_CONFIGURE = "org.yehudikasher.browser.CONFIGURE"
    const val EXTRA_SERVER_URL = "serverUrl"
    const val EXTRA_DEVICE_ID = "deviceId"
    const val EXTRA_BROWSER_TOKEN = "browserToken"
    const val EXTRA_BROWSER_MODE = "browserMode"

    fun publish(context: Context, serverUrl: String, auth: BrowserAuth?) {
        if (auth == null || auth.deviceId.isBlank() || auth.token.isBlank()) return

        val intent = Intent(ACTION_CONFIGURE)
            .setPackage(BROWSER_PACKAGE)
            .putExtra(EXTRA_SERVER_URL, serverUrl)
            .putExtra(EXTRA_DEVICE_ID, auth.deviceId)
            .putExtra(EXTRA_BROWSER_TOKEN, auth.token)
            .putExtra(EXTRA_BROWSER_MODE, auth.mode)

        runCatching { context.sendBroadcast(intent) }
            .onFailure { Log.w(TAG, "Could not publish browser configuration", it) }
    }
}
