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
    private val remotePolicy: RemotePolicyClient,
    private val imageProxy: FilteredImageProxy,
    private val onNeedsClassification: (String) -> Unit,
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
            if (result.reason == "not_in_local_policy" && result.normalizedHost != null) {
                onNeedsClassification(url.orEmpty())
            } else {
                onBlocked(url.orEmpty(), result.reason)
            }
            return
        }
        super.onPageStarted(view, url, favicon)
    }

    override fun shouldInterceptRequest(
        view: WebView?,
        request: WebResourceRequest?
    ): WebResourceResponse? {
        val rawUrl = request?.url?.toString()
        if (ImageSchemeHardening.isForbiddenImageUrl(rawUrl)) {
            return BlockedResponse.imagePlaceholder()
        }

        val result = policy.evaluate(rawUrl)

        var hostAllowed = result.decision == LocalDecision.ALLOW
        if (!hostAllowed &&
            result.reason == "not_in_local_policy" &&
            result.normalizedHost != null
        ) {
            // shouldInterceptRequest runs off the UI thread, so it is safe to
            // perform the remote host classification here.
            val remote = remotePolicy.checkHost(result.normalizedHost)
            hostAllowed = remote.allowed && policy.rememberRemoteAllow(result.normalizedHost)
        }

        if (!hostAllowed) {
            return if (imageProxy.shouldProxy(request)) {
                BlockedResponse.imagePlaceholder()
            } else {
                BlockedResponse.empty()
            }
        }

        // Images never go directly to their origin once the resource is
        // recognized as an image request. The server fetches and moderates
        // the bytes first; BLOCK/ERROR both come back as a harmless SVG
        // placeholder, so the WebView never sees the original unsafe image.
        if (imageProxy.shouldProxy(request) && !rawUrl.isNullOrBlank()) {
            return imageProxy.fetch(rawUrl)
        }

        return super.shouldInterceptRequest(view, request)
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
        if (result.reason == "not_in_local_policy" && result.normalizedHost != null) {
            onNeedsClassification(rawUrl.orEmpty())
        } else {
            onBlocked(rawUrl.orEmpty(), result.reason)
        }
        return true
    }
}
