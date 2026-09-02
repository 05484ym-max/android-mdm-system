package org.yehudikasher.browser

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewFeature

object SecureServiceWorker {
    /**
     * Returns true when Service Workers are unavailable, or every hardening control
     * required by this client is supported and successfully installed.
     */
    fun installFailClosedPolicy(): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) {
            return true
        }

        val requiredFeatures = listOf(
            WebViewFeature.SERVICE_WORKER_BLOCK_NETWORK_LOADS,
            WebViewFeature.SERVICE_WORKER_CONTENT_ACCESS,
            WebViewFeature.SERVICE_WORKER_FILE_ACCESS,
            WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST
        )
        if (requiredFeatures.any { !WebViewFeature.isFeatureSupported(it) }) {
            return false
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
