package org.mdmopen.filteredbrowser

import android.net.http.SslError
import android.webkit.ClientCertRequest
import android.webkit.HttpAuthHandler
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream

class SecureWebViewClient(
    private val policy: NavigationPolicy,
    private val onBlocked: (String, String) -> Unit,
) : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url.toString()
        val result = policy.evaluate(url)
        return if (result.decision == NavigationDecision.ALLOW) {
            false
        } else {
            if (request.isForMainFrame) onBlocked(url, result.reason)
            true
        }
    }

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val result = policy.evaluate(request.url.toString())
        return if (result.decision == NavigationDecision.ALLOW) null else blockedResponse()
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        handler.cancel()
        onBlocked(error.url ?: "", "ssl_error")
    }

    override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String) {
        handler.cancel()
        onBlocked("https://" + host, "http_auth_blocked")
    }

    override fun onReceivedClientCertRequest(view: WebView, request: ClientCertRequest) {
        request.cancel()
        onBlocked("https://" + request.host, "client_cert_blocked")
    }

    private fun blockedResponse() = WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
}
