package org.yehudikasher.browser

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BrowserConfigReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_CONFIGURE) return
        val server = intent.getStringExtra(EXTRA_SERVER_URL).orEmpty()
        val deviceId = intent.getStringExtra(EXTRA_DEVICE_ID).orEmpty()
        val token = intent.getStringExtra(EXTRA_BROWSER_TOKEN).orEmpty()
        val mode = intent.getStringExtra(EXTRA_BROWSER_MODE).orEmpty()
        if (!server.startsWith("https://") || deviceId.isBlank() || token.length < 20) return

        BrowserDeviceConfigStore.save(
            context.applicationContext,
            BrowserDeviceConfig(
                serverUrl = server,
                deviceId = deviceId,
                browserToken = token,
                browserMode = if (mode == "BLACKLIST") "BLACKLIST" else "WHITELIST",
            ),
        )
    }

    companion object {
        private const val ACTION_CONFIGURE = "org.yehudikasher.browser.CONFIGURE"
        private const val EXTRA_SERVER_URL = "serverUrl"
        private const val EXTRA_DEVICE_ID = "deviceId"
        private const val EXTRA_BROWSER_TOKEN = "browserToken"
        private const val EXTRA_BROWSER_MODE = "browserMode"
    }
}
