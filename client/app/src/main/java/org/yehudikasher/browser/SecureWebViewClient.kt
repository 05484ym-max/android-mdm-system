package org.yehudikasher.browser

import android.graphics.Bitmap
import android.net.http.SslError
import android.webkit.ClientCertRequest
import android.webkit.HttpAuthHandler
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.webkit.SafeBrowsingResponseCompat
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebViewClientCompat

class SecureWebViewClient(
    private val policy: UrlPolicy,
    private val onBlocked: (String, String) -> Unit,
    private val onTechnicalError: (String, String) -> Unit
) : WebViewClientCompat() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        return enforceNavigation(view, request.url.toString())
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
        val result = policy.evaluate(request?.url?.toString())
        return if (result.decision == LocalDecision.ALLOW) {
            super.shouldInterceptRequest(view, request)
        } else {
            BlockedResponse.empty()
        }
    }

    override fun onSafeBrowsingHit(
        view: WebView,
        request: WebResourceRequest,
        threatType: Int,
        callback: SafeBrowsingResponseCompat
    ) {
        // Never allow WebView's default/interstitial behavior to become a
        // policy bypass. A Safe Browsing hit is an unconditional fail-closed
        // result for this managed browser.
        callback.backToSafety(true)
        view.stopLoading()
        onBlocked(request.url.toString(), "safe_browsing_threat")
    }

    override fun onReceivedSslError(
        view: WebView?,
        handler: SslErrorHandler?,
        error: SslError?
    ) {
        handler?.cancel()
        onTechnicalError(error?.url.orEmpty(), "ssl_error")
    }

    override fun onReceivedHttpAuthRequest(
        view: WebView?,
        handler: HttpAuthHandler?,
        host: String?,
        realm: String?
    ) {
        handler?.cancel()
        onTechnicalError(host.orEmpty(), "http_auth_blocked")
    }

    override fun onReceivedClientCertRequest(view: WebView?, request: ClientCertRequest?) {
        request?.cancel()
        onTechnicalError(request?.host.orEmpty(), "client_cert_request_blocked")
    }

    override fun onReceivedHttpError(
        view: WebView,
        request: WebResourceRequest,
        errorResponse: WebResourceResponse
    ) {
        if (request.isForMainFrame) {
            view.stopLoading()
            onTechnicalError(
                request.url.toString(),
                "main_frame_http_${errorResponse.statusCode}"
            )
            return
        }
        super.onReceivedHttpError(view, request, errorResponse)
    }

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceErrorCompat
    ) {
        if (request.isForMainFrame) {
            view.stopLoading()
            onTechnicalError(request.url.toString(), "main_frame_network_error")
            return
        }
        super.onReceivedError(view, request, error)
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
