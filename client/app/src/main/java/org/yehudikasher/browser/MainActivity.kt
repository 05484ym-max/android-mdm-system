package org.yehudikasher.browser

import android.annotation.SuppressLint
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.PopupMenu
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var addressBar: EditText
    private lateinit var statusChip: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var contentFrame: FrameLayout
    private lateinit var statePanel: LinearLayout
    private lateinit var backButton: Button
    private lateinit var forwardButton: Button
    private lateinit var refreshButton: Button
    private lateinit var pageTitle: TextView
    private lateinit var faviconView: ImageView
    private lateinit var tabButton: Button
    private val tabs = CopyOnWriteArrayList<BrowserTab>()
    private var activeTabId: Long = 1L
    private var nextTabId: Long = 2L

    private data class BrowserTab(
        val id: Long,
        var title: String = "כרטיסייה חדשה",
        var url: String = "",
    )

    private val policy by lazy { LocalPolicyStore.createPolicy() }
    private val remotePolicy by lazy { RemotePolicyClient(applicationContext) }
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

        root.addView(createBrowserChrome())

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

    private fun createBrowserChrome(): View {
        val shell = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }

        val titleRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(4), 0, dp(4), dp(6))
        }

        faviconView = ImageView(this).apply {
            setImageResource(android.R.drawable.ic_menu_search)
            adjustViewBounds = true
            alpha = 0.72f
            contentDescription = "סמל האתר"
        }

        pageTitle = TextView(this).apply {
            text = "דפדפן כשר"
            textSize = 12.5f
            setTextColor(textDimColor)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            gravity = Gravity.CENTER_VERTICAL
        }

        tabButton = createNavButton("□ 1") { anchor ->
            showTabsMenu(anchor)
        }.apply {
            contentDescription = "כרטיסיות"
        }

        val menuButton = createNavButton("⋮") { anchor ->
            showBrowserMenu(anchor)
        }.apply {
            contentDescription = "תפריט דפדפן"
        }

        titleRow.addView(
            faviconView,
            LinearLayout.LayoutParams(dp(22), dp(22)).apply { marginEnd = dp(8) }
        )
        titleRow.addView(
            pageTitle,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        )
        titleRow.addView(tabButton)
        titleRow.addView(menuButton)

        val addressContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(8), dp(5), dp(8), dp(5))
            background = roundedBackground(cardColor, dp(22).toFloat(), borderColor, dp(1))
        }

        val goButton = Button(this).apply {
            text = "➜"
            textSize = 17f
            setTextColor(Color.WHITE)
            background = roundedBackground(accentColor, dp(18).toFloat())
            setOnClickListener { navigateFromAddressBar() }
            isAllCaps = false
            minHeight = 0
            minimumHeight = 0
            minWidth = 0
            minimumWidth = 0
            setPadding(dp(12), dp(7), dp(12), dp(7))
            contentDescription = "פתח כתובת"
        }

        statusChip = TextView(this).apply {
            visibility = View.GONE
            textSize = 10.5f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(5), dp(8), dp(5))
        }

        addressBar = EditText(this).apply {
            hint = "חיפוש או הקלדת כתובת"
            setHintTextColor(textDimColor)
            setTextColor(textColor)
            textSize = 14f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_GO
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            textDirection = View.TEXT_DIRECTION_FIRST_STRONG
            setSingleLine(true)
            setSelectAllOnFocus(true)
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_GO ||
                    actionId == EditorInfo.IME_ACTION_SEARCH ||
                    actionId == EditorInfo.IME_ACTION_DONE
                ) {
                    navigateFromAddressBar()
                    true
                } else {
                    false
                }
            }
            background = null
            setPadding(dp(8), 0, dp(8), 0)
        }

        addressContainer.addView(goButton)
        addressContainer.addView(
            statusChip,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { marginStart = dp(6) }
        )
        addressContainer.addView(
            addressBar,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        )

        val navRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(0, dp(7), 0, 0)
        }

        backButton = createNavButton("‹") {
            if (::webView.isInitialized && webView.canGoBack()) webView.goBack()
        }.apply { contentDescription = "חזרה" }

        forwardButton = createNavButton("›") {
            if (::webView.isInitialized && webView.canGoForward()) webView.goForward()
        }.apply { contentDescription = "קדימה" }

        refreshButton = createNavButton("↻") {
            if (::webView.isInitialized && webView.visibility == View.VISIBLE) webView.reload()
        }.apply { contentDescription = "רענון" }

        val homeButton = createNavButton("⌂") {
            addressBar.setText("")
            if (::webView.isInitialized) webView.loadUrl("about:blank")
            showHome()
        }.apply { contentDescription = "דף הבית" }

        listOf(backButton, forwardButton, refreshButton, homeButton).forEach { button ->
            navRow.addView(
                button,
                LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            )
        }

        shell.addView(titleRow)
        shell.addView(addressContainer)
        shell.addView(navRow)
        tabs.add(BrowserTab(id = activeTabId))
        updateTabButton()
        return shell
    }

    private fun createNavButton(label: String, onClick: (View) -> Unit): Button =
        Button(this).apply {
            text = label
            textSize = 18f
            setTextColor(textColor)
            background = roundedBackground(Color.TRANSPARENT, dp(14).toFloat())
            isAllCaps = false
            minHeight = 0
            minimumHeight = 0
            minWidth = 0
            minimumWidth = 0
            setPadding(dp(10), dp(6), dp(10), dp(6))
            setOnClickListener { onClick(it) }
        }

    private fun showTabsMenu(anchor: View) {
        val popup = PopupMenu(this, anchor)
        tabs.forEach { tab ->
            val prefix = if (tab.id == activeTabId) "✓ " else ""
            val label = tab.title.take(34).ifBlank { "כרטיסייה חדשה" }
            popup.menu.add(prefix + label).setOnMenuItemClickListener {
                switchToTab(tab.id)
                true
            }
        }
        popup.menu.add("+ כרטיסייה חדשה").setOnMenuItemClickListener {
            createNewTab()
            true
        }
        if (tabs.size > 1) {
            popup.menu.add("סגור כרטיסייה נוכחית").setOnMenuItemClickListener {
                closeCurrentTab()
                true
            }
        }
        popup.show()
    }

    private fun createNewTab() {
        saveActiveTab()
        val tab = BrowserTab(id = nextTabId++)
        tabs.add(tab)
        activeTabId = tab.id
        BrowserTrustState.clear()
        webView.loadUrl("about:blank")
        webView.clearHistory()
        addressBar.setText("")
        pageTitle.text = "כרטיסייה חדשה"
        faviconView.setImageResource(android.R.drawable.ic_menu_search)
        showHome()
        updateTabButton()
    }

    private fun switchToTab(id: Long) {
        if (id == activeTabId) return
        saveActiveTab()
        val tab = tabs.firstOrNull { it.id == id } ?: return
        activeTabId = id
        BrowserTrustState.clear()
        webView.clearHistory()
        if (tab.url.isBlank()) {
            addressBar.setText("")
            pageTitle.text = tab.title
            showHome()
        } else {
            addressBar.setText(tab.url)
            pageTitle.text = tab.title
            navigateToCandidate(tab.url)
        }
        updateTabButton()
    }

    private fun closeCurrentTab() {
        if (tabs.size <= 1) return
        val index = tabs.indexOfFirst { it.id == activeTabId }.coerceAtLeast(0)
        tabs.removeAll { it.id == activeTabId }
        val next = tabs.getOrNull(index.coerceAtMost(tabs.lastIndex)) ?: tabs.first()
        activeTabId = next.id
        BrowserTrustState.clear()
        webView.clearHistory()
        if (next.url.isBlank()) {
            addressBar.setText("")
            pageTitle.text = next.title
            showHome()
        } else {
            addressBar.setText(next.url)
            pageTitle.text = next.title
            navigateToCandidate(next.url)
        }
        updateTabButton()
    }

    private fun saveActiveTab() {
        val tab = tabs.firstOrNull { it.id == activeTabId } ?: return
        val current = webView.url
        tab.url = if (!current.isNullOrBlank() && current != "about:blank") current else addressBar.text?.toString().orEmpty()
        tab.title = pageTitle.text?.toString()?.takeIf { it.isNotBlank() } ?: "כרטיסייה חדשה"
    }

    private fun updateTabButton() {
        if (::tabButton.isInitialized) tabButton.text = "□ " + tabs.size
    }

    private fun showBrowserMenu(anchor: View) {
        val popup = PopupMenu(this, anchor)
        popup.menu.add("דף הבית").setOnMenuItemClickListener {
            addressBar.setText("")
            webView.loadUrl("about:blank")
            showHome()
            true
        }
        popup.menu.add("רענן").setOnMenuItemClickListener {
            if (webView.visibility == View.VISIBLE) webView.reload()
            true
        }
        popup.menu.add("חזרה").setOnMenuItemClickListener {
            if (webView.canGoBack()) webView.goBack()
            true
        }
        popup.menu.add("קדימה").setOnMenuItemClickListener {
            if (webView.canGoForward()) webView.goForward()
            true
        }
        popup.menu.add("כרטיסייה חדשה").setOnMenuItemClickListener {
            createNewTab()
            true
        }
        popup.menu.add("העתק כתובת").setOnMenuItemClickListener {
            val url = webView.url?.takeIf { it != "about:blank" } ?: addressBar.text?.toString().orEmpty()
            if (url.isNotBlank()) {
                val clipboard = getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                clipboard.setPrimaryClip(android.content.ClipData.newPlainText("URL", url))
            }
            true
        }
        popup.show()
    }

    private fun updateBrowserChrome() {
        if (!::webView.isInitialized) return
        backButton.isEnabled = webView.canGoBack()
        forwardButton.isEnabled = webView.canGoForward()
        backButton.alpha = if (backButton.isEnabled) 1f else 0.35f
        forwardButton.alpha = if (forwardButton.isEnabled) 1f else 0.35f
        val current = webView.url
        if (!current.isNullOrBlank() && current != "about:blank" && !addressBar.hasFocus()) {
            addressBar.setText(current)
        }
        saveActiveTab()
        updateTabButton()
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
        // Expose only a boolean trust signal. It carries no device identity,
        // token, policy data or mutation capability.
        view.addJavascriptInterface(object {
            @JavascriptInterface
            fun isFullTrust(): Boolean = BrowserTrustState.isActive()
        }, "YkTrustedPage")

        // Install document-start hardening before JavaScript is enabled and
        // before any page is loaded. If this WebView cannot guarantee the
        // pre-page hook, keep JavaScript disabled rather than allowing blob:
        // image creation to bypass native request interception.
        val documentStartImageSafe = StrictImageHardening.install(view)

        val settings = view.settings
        settings.javaScriptEnabled = serviceWorkerSafe && documentStartImageSafe
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.setSupportMultipleWindows(false)
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.domStorageEnabled = true
        settings.databaseEnabled = false
        settings.setGeolocationEnabled(false)
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        // Keep normal HTTP/WebView caching enabled for already-approved content.
        // Policy checks and image moderation still run in SecureWebViewClient,
        // so this does not turn cached content into an authorization source.
        settings.cacheMode = WebSettings.LOAD_DEFAULT
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
                progressBar.isIndeterminate = false
                progressBar.progress = newProgress
                if (newProgress in 1..99 && webView.visibility == View.VISIBLE) {
                    progressBar.visibility = View.VISIBLE
                    refreshButton.text = "✕"
                    refreshButton.setOnClickListener { webView.stopLoading() }
                } else if (newProgress >= 100) {
                    refreshButton.text = "↻"
                    refreshButton.setOnClickListener {
                        if (webView.visibility == View.VISIBLE) webView.reload()
                    }
                }
                updateBrowserChrome()
                if (newProgress >= 100 && webView.visibility == View.VISIBLE) {
                    progressBar.visibility = View.GONE
                    setAllowedChip()
                }
            }

            override fun onReceivedTitle(view: WebView?, title: String?) {
                super.onReceivedTitle(view, title)
                pageTitle.text = title?.takeIf { it.isNotBlank() } ?: displayHost(view?.url.orEmpty()) ?: "דפדפן כשר"
                saveActiveTab()
                updateBrowserChrome()
            }

            override fun onReceivedIcon(view: WebView?, icon: Bitmap?) {
                super.onReceivedIcon(view, icon)
                if (icon != null) faviconView.setImageBitmap(icon)
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
        val raw = addressBar.text?.toString().orEmpty()
        val candidate = SearchInput.resolve(raw)
        if (candidate.isBlank()) {
            showHome()
            return
        }
        navigateToCandidate(candidate)
    }

    private fun navigateToCandidate(candidate: String) {
        val result = policy.evaluate(candidate)
        when {
            result.decision == LocalDecision.ALLOW -> {
                applyTrustForHost(result.normalizedHost)
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
            applyTrustForHost(host)
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
                policy.rememberRemoteAllow(host, remote.expiresAtMs)
                if (remote.fullTrust) BrowserTrustState.setTrustedHost(host)
                else BrowserTrustState.clear()
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

    private fun applyTrustForHost(host: String?) {
        if (host == null) {
            BrowserTrustState.clear()
            return
        }
        val cached = remotePolicy.peekCachedDecision(host)
        if (cached?.allowed == true && cached.fullTrust) {
            BrowserTrustState.setTrustedHost(host)
        } else {
            BrowserTrustState.clear()
        }
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
        BrowserTrustState.clear()
        if (::pageTitle.isInitialized) pageTitle.text = "כרטיסייה חדשה"
        if (::faviconView.isInitialized) faviconView.setImageResource(android.R.drawable.ic_menu_search)
        if (::backButton.isInitialized && ::webView.isInitialized) updateBrowserChrome()
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
            text = "חיפוש באינטרנט"
            textSize = 18f
            setTextColor(textColor)
            typeface = Typeface.create("sans-serif-black", Typeface.NORMAL)
            gravity = Gravity.CENTER
        }

        val body = TextView(this).apply {
            text = "הקלד כתובת אתר או חיפוש בשורת הכתובת למעלה"
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
        BrowserTrustState.clear()
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
        BrowserTrustState.clear()
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
