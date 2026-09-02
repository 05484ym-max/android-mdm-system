package org.yehudikasher.browser

import android.annotation.SuppressLint
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var addressBar: EditText
    private lateinit var statusView: TextView
    private val policy by lazy { LocalPolicyStore.createPolicy() }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WebView.setWebContentsDebuggingEnabled(false)
        val serviceWorkerSafe = SecureServiceWorker.installFailClosedPolicy()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }

        addressBar = EditText(this).apply {
            hint = "הקלד כתובת מאובטחת"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setSingleLine(true)
        }

        val goButton = Button(this).apply {
            text = "פתח"
            setOnClickListener { navigateFromAddressBar() }
        }

        bar.addView(
            addressBar,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        )
        bar.addView(goButton)

        statusView = TextView(this).apply {
            text = "הדפדפן מוכן. אתר לא מאושר ייחסם."
            setPadding(24, 20, 24, 20)
        }

        webView = WebView(this)
        configureWebView(webView, serviceWorkerSafe)

        root.addView(bar)
        root.addView(statusView)
        root.addView(
            webView,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        )

        setContentView(root)
        webView.loadUrl("about:blank")
    }

    override fun onDestroy() {
        webView.stopLoading()
        webView.loadUrl("about:blank")
        webView.clearHistory()
        webView.removeAllViews()
        webView.destroy()
        super.onDestroy()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(view: WebView, serviceWorkerSafe: Boolean) {
        val settings = view.settings
        settings.javaScriptEnabled = serviceWorkerSafe
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.setSupportMultipleWindows(false)
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.domStorageEnabled = true
        settings.databaseEnabled = false
        settings.setGeolocationEnabled(false)
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.cacheMode = WebSettings.LOAD_NO_CACHE
        settings.mediaPlaybackRequiresUserGesture = true

        @Suppress("DEPRECATION")
        run {
            settings.allowFileAccessFromFileURLs = false
            settings.allowUniversalAccessFromFileURLs = false
        }

        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)

        view.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(
                view: WebView?,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: android.os.Message?
            ): Boolean = false
        }

        view.setDownloadListener { url, _, _, _, _ ->
            showBlocked(url.orEmpty(), "downloads_disabled")
        }

        view.webViewClient = SecureWebViewClient(policy, ::showBlocked)

        if (!serviceWorkerSafe) {
            showBlocked("", "service_worker_hardening_failed")
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.START_SAFE_BROWSING)) {
            @Suppress("DEPRECATION")
            WebViewCompat.startSafeBrowsing(applicationContext) { success ->
                if (!success) {
                    showBlocked("", "safe_browsing_init_failed")
                }
            }
        }
    }

    private fun navigateFromAddressBar() {
        val raw = addressBar.text?.toString().orEmpty().trim()
        val candidate = when {
            raw.contains("://") -> raw
            raw.isNotBlank() -> "https://$raw"
            else -> ""
        }

        val result = policy.evaluate(candidate)
        if (result.decision == LocalDecision.ALLOW) {
            statusView.text = "פותח אתר מאושר..."
            webView.loadUrl(candidate)
        } else {
            showBlocked(candidate, result.reason)
        }
    }

    private fun showBlocked(url: String, reason: String) {
        runOnUiThread {
            webView.stopLoading()
            statusView.text = "האתר נחסם • $reason"
            if (url.isNotBlank()) {
                addressBar.setText(url)
            }
        }
    }
}
