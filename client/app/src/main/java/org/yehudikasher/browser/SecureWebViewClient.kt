package org.yehudikasher.browser

import android.graphics.Bitmap
import android.net.Uri
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.http.SslError

class SecureWebViewClient(
    private val policy: UrlPolicy,
    private val onBlocked: (String, String) -> Unit
) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val url = request?.url?.toString()
        return enforceNavigation(view, url)
    }

    @Deprecated("Deprecated in Android API, kept for defensive compatibility")
    override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
        return enforceNavigation(view, url)
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        val result = policy.evaluate(url)
        if (result.decision != LocalDecision.ALLOW) {
            view?.stopLoading()
            onBlocked(url.orEmpty(), result.reason)
            return
        }
        super.onPageStarted(view, url, favicon)
    }

    override fun shouldInterceptRequest(
        view: WebView?,
        request: WebResourceRequest?
    ): WebResourceResponse? {
        val url = request?.url?.toString()
        val result = policy.evaluate(url)
        return if (result.decision == LocalDecision.ALLOW) {
            super.shouldInterceptRequest(view, request)
        } else {
            BlockedResponse.empty()
        }
    }

    override fun onReceivedSslError(
        view: WebView?,
        handler: SslErrorHandler?,
        error: SslError?
    ) {
        handler?.cancel()
        onBlocked(error?.url.orEmpty(), "ssl_error")
    }

    private fun enforceNavigation(view: WebView?, rawUrl: String?): Boolean {
        val result = policy.evaluate(rawUrl)
        if (result.decision == LocalDecision.ALLOW) {
            return false
        }

        view?.stopLoading()
        onBlocked(rawUrl.orEmpty(), result.reason)
        return true
    }
}
