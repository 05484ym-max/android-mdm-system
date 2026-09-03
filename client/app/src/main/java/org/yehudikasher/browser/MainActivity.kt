package org.yehudikasher.browser

import android.annotation.SuppressLint
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.util.concurrent.ConcurrentHashMap

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var addressBar: EditText
    private lateinit var statusChip: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var contentFrame: FrameLayout
    private lateinit var statePanel: LinearLayout

    private val policy by lazy { LocalPolicyStore.createPolicy() }
    private val remotePolicy by lazy { RemotePolicyClient() }
    private val imageProxy by lazy { FilteredImageProxy() }
    private val classificationInFlight = ConcurrentHashMap.newKeySet<String>()

    private val bgColor = Color.parseColor("#F2F1E6")
    private val cardColor = Color.parseColor("#FFFFFF")
    private val borderColor = Color.parseColor("#EAE8DC")
    private val accentColor = Color.parseColor("#4B6B45")
    private val accentSoftColor = Color.parseColor("#6B8A65")
    private val accentTintColor = Color.parseColor("#E7ECDD")
    private val textColor = Color.parseColor("#1C1C1C")
    private val textDimColor = Color.parseColor("#8C8C86")
    private val okColor = Color.parseColor("#328A52")
    private val warnColor = Color.parseColor("#A5661D")
    private val warnTintColor = Color.parseColor("#FBEEDD")
    private val dangerColor = Color.parseColor("#B3432C")
    private val dangerTintColor = Color.parseColor("#F6E1DC")

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WebView.setWebContentsDebuggingEnabled(false)
        val serviceWorkerSafe = SecureServiceWorker.installFailClosedPolicy()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setBackgroundColor(bgColor)
            setPadding(dp(14), dp(18), dp(14), dp(14))
        }

        root.addView(createAddressBar())

        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
            visibility = View.GONE
            indeterminateTintList = ColorStateList.valueOf(accentColor)
        }
        root.addView(
            progressBar,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(3)
            ).apply {
                topMargin = dp(6)
            }
        )

        contentFrame = FrameLayout(this)

        webView = WebView(this).apply {
            visibility = View.GONE
        }
        configureWebView(webView, serviceWorkerSafe)

        statePanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(24), dp(28), dp(24), dp(28))
        }

        contentFrame.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        contentFrame.addView(
            statePanel,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        root.addView(
            contentFrame,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f
            ).apply {
                topMargin = dp(14)
            }
        )

        setContentView(root)
        showHome()

        if (!serviceWorkerSafe) {
            showTechnicalError("service_worker_hardening_failed")
        } else if (WebViewFeature.isFeatureSupported(WebViewFeature.START_SAFE_BROWSING)) {
            @Suppress("DEPRECATION")
            WebViewCompat.startSafeBrowsing(applicationContext) { success ->
                if (!success) {
                    showTechnicalError("safe_browsing_init_failed")
                } else {
                    handleIncomingWebIntent(intent)
                }
            }
        } else {
            handleIncomingWebIntent(intent)
        }
    }

    private fun createAddressBar(): View {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(10), dp(7), dp(10), dp(7))
            background = roundedBackground(cardColor, dp(14).toFloat(), borderColor, dp(1))
        }

        val goButton = Button(this).apply {
            text = "פתח"
            textSize = 14.5f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            setTextColor(Color.WHITE)
            background = roundedBackground(accentColor, dp(12).toFloat())
            setOnClickListener { navigateFromAddressBar() }
            isAllCaps = false
            minHeight = 0
            minimumHeight = 0
            setPadding(dp(14), dp(9), dp(14), dp(9))
        }

        statusChip = TextView(this).apply {
            visibility = View.GONE
            textSize = 11f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            gravity = Gravity.CENTER
            setPadding(dp(10), dp(6), dp(10), dp(6))
        }

        addressBar = EditText(this).apply {
            hint = "הקלד כתובת אתר..."
            setHintTextColor(textDimColor)
            setTextColor(textColor)
            textSize = 13.5f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            textDirection = View.TEXT_DIRECTION_LTR
            setSingleLine(true)
            background = null
            setPadding(dp(8), 0, dp(8), 0)
        }

        container.addView(goButton)
        container.addView(
            statusChip,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                marginStart = dp(8)
            }
        )
        container.addView(
            addressBar,
            LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f
            )
        )

        return container
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
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                super.onProgressChanged(view, newProgress)
                if (newProgress >= 100 && webView.visibility == View.VISIBLE) {
                    progressBar.visibility = View.GONE
                    setAllowedChip()
                }
            }

            override fun onCreateWindow(
                view: WebView?,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: android.os.Message?
            ): Boolean = false

            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.deny()
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                callback?.invoke(origin, false, false)
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                return true
            }
        }

        view.setDownloadListener { url, _, _, _, _ ->
            showBlocked(url.orEmpty(), "downloads_disabled")
        }

        view.webViewClient = SecureWebViewClient(
            policy,
            remotePolicy,
            imageProxy,
            ::classifyAndNavigate,
            ::showBlocked,
            { _, reason -> showTechnicalError(reason) }
        )
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingWebIntent(intent)
    }

    private fun handleIncomingWebIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val candidate = intent.data?.toString().orEmpty()
        if (candidate.isBlank()) return
        navigateToCandidate(candidate)
    }

    private fun navigateFromAddressBar() {
        val raw = addressBar.text?.toString().orEmpty().trim()
        val candidate = when {
            raw.contains("://") -> raw
            raw.isNotBlank() -> "https://$raw"
            else -> ""
        }
        navigateToCandidate(candidate)
    }

    private fun navigateToCandidate(candidate: String) {
        val result = policy.evaluate(candidate)
        when {
            result.decision == LocalDecision.ALLOW -> {
                addressBar.setText(candidate)
                showLoading()
                webView.loadUrl(candidate)
            }
            result.reason == "not_in_local_policy" && result.normalizedHost != null ->
                classifyAndNavigate(candidate)
            else -> showBlocked(candidate, result.reason)
        }
    }

    private fun classifyAndNavigate(candidate: String) {
        val local = policy.evaluate(candidate)
        val host = local.normalizedHost
        if (local.decision == LocalDecision.ALLOW) {
            runOnUiThread {
                if (!isFinishing && !isDestroyed) {
                    addressBar.setText(candidate)
                    showLoading()
                    webView.loadUrl(candidate)
                }
            }
            return
        }
        if (local.reason != "not_in_local_policy" || host == null) {
            showBlocked(candidate, local.reason)
            return
        }

        if (!classificationInFlight.add(host)) return
        runOnUiThread {
            if (!isFinishing && !isDestroyed) showChecking(host)
        }

        Thread {
            val remote = remotePolicy.checkHost(host)
            classificationInFlight.remove(host)

            if (remote.allowed) {
                policy.rememberRemoteAllow(host)
                runOnUiThread {
                    if (!isFinishing && !isDestroyed) {
                        addressBar.setText(candidate)
                        showLoading()
                        webView.loadUrl(candidate)
                    }
                }
            } else {
                val technical = remote.reason.startsWith("classifier_") ||
                    remote.reason == "rate_limited"
                if (technical) showTechnicalError(remote.reason)
                else showBlocked(candidate, remote.reason)
            }
        }.start()
    }

    private fun showChecking(host: String) {
        progressBar.visibility = View.VISIBLE
        webView.visibility = View.GONE
        statusChip.visibility = View.GONE
        showStateCard(
            tintColor = accentTintColor,
            icon = "⌛",
            iconColor = accentColor,
            title = "בודק את האתר",
            domain = host,
            body = "האתר נבדק אוטומטית לפני פתיחה.",
        )
    }

    private fun showHome() {
        progressBar.visibility = View.GONE
        webView.visibility = View.GONE
        statusChip.visibility = View.GONE
        statePanel.visibility = View.VISIBLE
        statePanel.removeAllViews()
        statePanel.background = null

        val emblem = TextView(this).apply {
            text = "✦"
            textSize = 44f
            setTextColor(Color.parseColor("#B6862B"))
            gravity = Gravity.CENTER
        }

        val title = TextView(this).apply {
            text = "דפדפן כשר"
            textSize = 18f
            setTextColor(textColor)
            typeface = Typeface.create("sans-serif-black", Typeface.NORMAL)
            gravity = Gravity.CENTER
        }

        val body = TextView(this).apply {
            text = "כל אתר נבדק ומאושר לפני שהוא נפתח אצלך"
            textSize = 13.5f
            setTextColor(textDimColor)
            gravity = Gravity.CENTER
        }

        statePanel.addView(emblem)
        statePanel.addView(title, spacedParams(dp(8)))
        statePanel.addView(body, spacedParams(dp(8)))
    }

    private fun showLoading() {
        statePanel.visibility = View.GONE
        webView.visibility = View.VISIBLE
        webView.alpha = 0f
        progressBar.visibility = View.VISIBLE
        statusChip.visibility = View.GONE
    }

    private fun showBlocked(url: String, reason: String) {
        runOnUiThread {
            webView.stopLoading()
            webView.visibility = View.GONE
            webView.alpha = 1f
            progressBar.visibility = View.GONE
            statusChip.visibility = View.GONE

            if (url.isNotBlank()) {
                addressBar.setText(url)
            }

            val domain = policy.evaluate(url).normalizedHost ?: displayHost(url)
            showStateCard(
                tintColor = dangerTintColor,
                icon = "⛔",
                iconColor = dangerColor,
                title = "האתר אינו מאושר",
                domain = domain,
                body = blockedMessage(reason),
                primaryLabel = null,
                secondaryLabel = "חזרה לדף הבית",
                onSecondary = {
                    addressBar.setText("")
                    webView.loadUrl("about:blank")
                    showHome()
                }
            )
        }
    }

    private fun showTechnicalError(reason: String) {
        runOnUiThread {
            webView.stopLoading()
            webView.visibility = View.GONE
            progressBar.visibility = View.GONE
            statusChip.visibility = View.GONE

            showStateCard(
                tintColor = warnTintColor,
                icon = "⚠",
                iconColor = warnColor,
                title = "לא ניתן היה לבדוק את האתר",
                domain = displayHost(addressBar.text?.toString().orEmpty()),
                body = "מטעמי בטיחות, האתר לא נפתח כרגע.",
                primaryLabel = "נסה שוב",
                onPrimary = {
                    if (addressBar.text?.isNotBlank() == true) {
                        navigateFromAddressBar()
                    } else {
                        showHome()
                    }
                },
                secondaryLabel = "חזרה לדף הבית",
                onSecondary = {
                    addressBar.setText("")
                    showHome()
                }
            )
        }
    }

    private fun showStateCard(
        tintColor: Int,
        icon: String,
        iconColor: Int,
        title: String,
        domain: String?,
        body: String,
        primaryLabel: String? = null,
        onPrimary: (() -> Unit)? = null,
        secondaryLabel: String? = null,
        onSecondary: (() -> Unit)? = null
    ) {
        statePanel.visibility = View.VISIBLE
        statePanel.removeAllViews()
        statePanel.background = roundedBackground(tintColor, dp(20).toFloat())

        val iconView = TextView(this).apply {
            text = icon
            textSize = 28f
            gravity = Gravity.CENTER
            setTextColor(iconColor)
        }

        val titleView = TextView(this).apply {
            text = title
            textSize = 18.5f
            typeface = Typeface.create("sans-serif-black", Typeface.NORMAL)
            setTextColor(textColor)
            gravity = Gravity.CENTER
        }

        statePanel.addView(iconView)
        statePanel.addView(titleView, spacedParams(dp(14)))

        if (!domain.isNullOrBlank()) {
            val domainView = TextView(this).apply {
                text = domain
                textSize = 12f
                setTextColor(textDimColor)
                gravity = Gravity.CENTER
                layoutDirection = View.LAYOUT_DIRECTION_LTR
                textDirection = View.TEXT_DIRECTION_LTR
            }
            statePanel.addView(domainView, spacedParams(dp(8)))
        }

        val bodyView = TextView(this).apply {
            text = body
            textSize = 13.5f
            setTextColor(textColor)
            gravity = Gravity.CENTER
        }
        statePanel.addView(bodyView, spacedParams(dp(12)))

        if (primaryLabel != null && onPrimary != null) {
            statePanel.addView(createPrimaryButton(primaryLabel, onPrimary), spacedParams(dp(20)))
        }

        if (secondaryLabel != null && onSecondary != null) {
            statePanel.addView(createGhostButton(secondaryLabel, onSecondary), spacedParams(dp(10)))
        }
    }

    private fun createPrimaryButton(label: String, action: () -> Unit): Button =
        Button(this).apply {
            text = label
            textSize = 14.5f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            setTextColor(Color.WHITE)
            background = roundedBackground(accentColor, dp(12).toFloat())
            setOnClickListener { action() }
            isAllCaps = false
        }

    private fun createGhostButton(label: String, action: () -> Unit): Button =
        Button(this).apply {
            text = label
            textSize = 14.5f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            setTextColor(accentColor)
            background = roundedBackground(cardColor, dp(12).toFloat(), accentSoftColor, dp(1))
            setOnClickListener { action() }
            isAllCaps = false
        }

    private fun setAllowedChip() {
        webView.alpha = 1f
        statusChip.text = "מאושר"
        statusChip.setTextColor(okColor)
        statusChip.background = roundedBackground(accentTintColor, dp(999).toFloat())
        statusChip.visibility = View.VISIBLE
    }

    private fun blockedMessage(reason: String): String {
        return when (reason) {
            "downloads_disabled" -> "הורדת קבצים חסומה בדפדפן המאובטח."
            "safe_browsing_threat" -> "האתר זוהה כמסוכן ולכן נחסם."
            "ssl_error" -> "החיבור המאובטח לאתר נכשל ולכן האתר נחסם."
            "http_auth_blocked", "client_cert_request_blocked" ->
                "האתר ביקש מנגנון אימות שאינו מאושר בדפדפן המאובטח."
            "category_not_allowed", "classification_not_confident", "classification_missing" ->
                "האתר לא סווג בקטגוריה בטוחה מספיק ולכן נחסם."
            else -> "האתר הזה אינו מאושר לפי מדיניות הסינון."
        }
    }

    private fun displayHost(rawUrl: String): String? {
        return try {
            Uri.parse(rawUrl).host
        } catch (_: Throwable) {
            null
        }
    }

    private fun roundedBackground(
        fillColor: Int,
        radius: Float,
        strokeColor: Int? = null,
        strokeWidth: Int = 0
    ): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(fillColor)
            cornerRadius = radius
            if (strokeColor != null && strokeWidth > 0) {
                setStroke(strokeWidth, strokeColor)
            }
        }
    }

    private fun spacedParams(topMargin: Int): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            this.topMargin = topMargin
        }
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()
}
