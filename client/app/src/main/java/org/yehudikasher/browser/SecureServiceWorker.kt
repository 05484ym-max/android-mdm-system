package org.yehudikasher.browser

import android.os.Build
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat

object SecureServiceWorker {
    fun installFailClosedPolicy() {
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
    }
}
