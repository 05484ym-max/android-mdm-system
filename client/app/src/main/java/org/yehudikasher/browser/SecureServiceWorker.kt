package org.yehudikasher.browser

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewFeature

object SecureServiceWorker {
    /**
     * Returns true when Service Workers are either unavailable or successfully forced fail-closed.
     * Returns false if the installed WebView reports Service Worker support but hardening fails.
     */
    fun installFailClosedPolicy(): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) {
            return true
        }

        return try {
            val controller = ServiceWorkerControllerCompat.getInstance()
            val settings = controller.serviceWorkerWebSettings
            settings.blockNetworkLoads = true
            settings.allowContentAccess = false
            settings.allowFileAccess = false

            controller.setServiceWorkerClient(object : ServiceWorkerClientCompat() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse {
                    return BlockedResponse.empty()
                }
            })
            true
        } catch (_: Throwable) {
            false
        }
    }
}
