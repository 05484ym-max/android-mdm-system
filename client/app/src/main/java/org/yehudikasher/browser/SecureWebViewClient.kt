package org.yehudikasher.browser

import android.graphics.Bitmap
import android.net.http.SslError
import android.webkit.ClientCertRequest
import android.webkit.HttpAuthHandler
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.util.Locale

class SecureWebViewClient(
    private val engine: BrowsingPolicyEngine,
    private val onBlocked: (String, String) -> Unit,
    private val onChecking: (String) -> Unit,
    private val onTechnicalError: (String, String) -> Unit
) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        return enforceNavigation(view, request?.url?.toString())
    }

    @Deprecated("Deprecated in Android API, kept for defensive compatibility")
    override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
        return enforceNavigation(view, url)
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        when (val decision = engine.evaluateNavigation(url)) {
            is NavigationDecision.Allow -> super.onPageStarted(view, url, favicon)
            is NavigationDecision.PendingApproval -> {
                view?.stopLoading()
                handlePendingApproval(view, url.orEmpty(), decision.host)
            }
            is NavigationDecision.Blocked -> {
                view?.stopLoading()
                onBlocked(url.orEmpty(), decision.reason)
            }
        }
    }

    /** Subresources (images, scripts, iframes, ...) never get the
     * pending-approval retry flow that a real page navigation does (see
     * enforceNavigation/onPageStarted) - anything not already on an
     * approved host is simply never fetched. That is exactly what makes an
     * unknown/unapproved iframe or subresource unable to bypass policy: it
     * cannot trigger its own remote approval and load anyway. */
    override fun shouldInterceptRequest(
        view: WebView?,
        request: WebResourceRequest?
    ): WebResourceResponse? {
        val url = request?.url?.toString()
        val navigationDecision = engine.evaluateNavigation(url)
        if (navigationDecision !is NavigationDecision.Allow || url == null) {
            return BlockedResponse.empty()
        }

        if (request?.isForMainFrame != true && isLikelyImageRequest(request)) {
            val imageDecision = engine.evaluateImage(url)
            if (ImageFilterPolicy.shouldHide(engine.currentFilterLevel(), imageDecision)) {
                return BlockedResponse.placeholderImage()
            }
        }

        return super.shouldInterceptRequest(view, request)
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

    override fun onReceivedError(
        view: WebView?,
        request: WebResourceRequest?,
        error: WebResourceError?
    ) {
        if (request?.isForMainFrame == true) {
            view?.stopLoading()
            onTechnicalError(request.url?.toString().orEmpty(), "main_frame_network_error")
            return
        }
        super.onReceivedError(view, request, error)
    }

    private fun enforceNavigation(view: WebView?, rawUrl: String?): Boolean {
        return when (val decision = engine.evaluateNavigation(rawUrl)) {
            is NavigationDecision.Allow -> false
            is NavigationDecision.PendingApproval -> {
                view?.stopLoading()
                handlePendingApproval(view, rawUrl.orEmpty(), decision.host)
                true
            }
            is NavigationDecision.Blocked -> {
                view?.stopLoading()
                onBlocked(rawUrl.orEmpty(), decision.reason)
                true
            }
        }
    }

    /** Every redirect to a new host runs through this exact same path
     * (onPageStarted/shouldOverrideUrlLoading fire again for the redirect
     * target, calling evaluateNavigation fresh on it) - a redirect to an
     * unapproved host is just another PendingApproval, checked before it
     * ever opens, same as a first-time navigation. */
    private fun handlePendingApproval(view: WebView?, url: String, host: String) {
        onChecking(host)
        engine.requestHostApproval(host) { approved ->
            if (approved) {
                val target = view
                target?.post { target.loadUrl(url) }
            } else {
                onBlocked(url, "not_in_local_policy")
            }
        }
    }

    /** Best-effort only - WebView gives no direct "this is an &lt;img&gt;
     * fetch" signal. A real image fetch's Accept header is led by image
     * types (e.g. "image/avif,image/webp,image/apng,image/svg+xml,
     * image/*,*/*;q=0.8"); requiring it to *start* with "image/" (not
     * merely contain it) is what keeps this from also matching the main
     * page's own navigation request, whose Accept header commonly lists
     * "image/webp" too, just not first (e.g. "text/html,...,image/webp,
     * .../*;q=0.8") - already additionally excluded by the isForMainFrame
     * check at this function's one call site, kept here too as a second,
     * independent safeguard against ever hiding real page content. */
    private fun isLikelyImageRequest(request: WebResourceRequest?): Boolean {
        val accept = request?.requestHeaders?.entries
            ?.firstOrNull { it.key.equals("Accept", ignoreCase = true) }
            ?.value
        if (accept != null && accept.trim().startsWith("image/", ignoreCase = true)) return true

        val path = request?.url?.path?.lowercase(Locale.US) ?: return false
        return IMAGE_EXTENSIONS.any { path.endsWith(it) }
    }

    companion object {
        private val IMAGE_EXTENSIONS =
            listOf(".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif")
    }
}
