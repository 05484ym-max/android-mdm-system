package org.mdmopen.dpc

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import java.net.URL
import java.text.SimpleDateFormat
import java.time.Instant
import java.util.Locale

class CustomerActivity : Activity() {

    private data class NavItem(
        val container: LinearLayout,
        val icon: TextView,
        val label: TextView,
        val badge: View,
    )

    private lateinit var contentArea: LinearLayout
    private lateinit var headerLabelView: TextView
    private lateinit var personalNavItem: NavItem
    private lateinit var storeNavItem: NavItem
    private lateinit var adminNavItem: NavItem
    private lateinit var newsNavItem: NavItem
    private var isPersonalAreaActive = false
    private var isNewsActive = false
    private var selectedStoreCategory = "all"
    private var storeSearchQuery = ""
    // Cache-first: showNews()/onCreate's badge check both read this rather
    // than re-fetching - a background refresh (refreshNews) is what keeps
    // it current and is also the only thing allowed to write it.
    private var newsItems: List<UpdateItem> = emptyList()

    private val BG = "#F2F1E6"
    private val CARD = "#FFFFFF"
    private val BORDER = "#EAE8DC"
    private val TEXT = "#1C1C1C"
    private val MUTED = "#8C8C86"
    private val ACCENT = "#4B6B45"
    private val ACCENT_TINT = "#E7ECDD"
    private val OK = "#328A52"

    private val heavyFont = Typeface.create("sans-serif-black", Typeface.NORMAL)
    private val mediumFont = Typeface.create("sans-serif-medium", Typeface.NORMAL)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        newsItems = Config.newsCache(this)
        setContentView(buildUi())
        showAppStore()
        updateNewsBadge()
        refreshNews()
    }

    private fun buildUi(): View {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor(BG))
            // The manifest doesn't declare supportsRtl, so the system never
            // mirrors add-order-based layout on its own even under a Hebrew
            // locale - forced explicitly here instead of relying on that.
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }

        page.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(24), dp(18), dp(24), dp(14))

            // Right side: the app's own emblem (it already carries the
            // "יהודי כשר" lettering) plus a label naming the active screen -
            // replaces the old static wordmark so the header stays useful
            // as a per-tab indicator instead of a repeated brand name.
            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL

                addView(ImageView(this@CustomerActivity).apply {
                    setImageResource(R.mipmap.ic_launcher)
                    alpha = 0.85f
                    layoutParams = LinearLayout.LayoutParams(dp(38), dp(38)).apply {
                        marginEnd = dp(14)
                    }
                })

                headerLabelView = TextView(this@CustomerActivity).apply {
                    textSize = 17f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                }
                addView(headerLabelView)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

            addView(headerSyncBadge())
        })

        contentArea = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(4), dp(20), dp(24))
        }

        val scroll = ScrollView(this).apply { addView(contentArea) }

        page.addView(
            scroll,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        )

        page.addView(buildBottomBar())

        return page
    }

    /** Small fixed badge in the header, present on every screen (built once
     * in buildUi, not per-tab) instead of the old full-width button that only
     * lived inside the personal-area tab. */
    private fun headerSyncBadge(): TextView {
        lateinit var badge: TextView
        badge = TextView(this).apply {
            text = "↻ סינכרון"
            textSize = 12.5f
            typeface = heavyFont
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            background = flatRounded(ACCENT, dp(12).toFloat())
            setPadding(dp(14), dp(11), dp(14), dp(11))
            isClickable = true
            isFocusable = true

            setOnClickListener {
                isClickable = false
                text = "⏳ מסנכרן..."

                Thread {
                    try {
                        val result = PolicySync.run(applicationContext)
                        AutoUpdater.check(applicationContext)
                        Config.setLastSyncNow(applicationContext)

                        runOnUiThread {
                            text = "✓ סונכרן"
                            Toast.makeText(
                                this@CustomerActivity,
                                "המכשיר סונכרן בהצלחה\n$result",
                                Toast.LENGTH_LONG
                            ).show()
                            refreshLastSyncLabelIfShown()

                            postDelayed({
                                text = "↻ סינכרון"
                                isClickable = true
                            }, 1800)
                        }
                    } catch (e: Exception) {
                        runOnUiThread {
                            text = "↻ סינכרון"
                            isClickable = true
                            Toast.makeText(
                                this@CustomerActivity,
                                "הסנכרון נכשל: ${e.message}",
                                Toast.LENGTH_LONG
                            ).show()
                        }
                    }
                }.start()
            }
        }
        return badge
    }

    private fun buildBottomBar(): LinearLayout {
        val bar = LinearLayout(this)
        bar.apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor(CARD))
            minimumHeight = dp(80)

            addView(View(this@CustomerActivity).apply {
                setBackgroundColor(Color.parseColor(BORDER))
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)))
        }

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(12), dp(10), dp(12), dp(14))
        }

        personalNavItem = navButton("👤", "אזור אישי") { showPersonalArea() }
        storeNavItem = navButton("▦", "חנות אפליקציות") { showAppStore() }
        newsNavItem = navButton("📰", "חדשות ועדכונים") { showNews() }
        adminNavItem = navButton("🔒", "כניסת מנהל") { showAdminLogin() }

        row.addView(
            personalNavItem.container,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        row.addView(
            storeNavItem.container,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        row.addView(
            newsNavItem.container,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        row.addView(
            adminNavItem.container,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )

        bar.addView(row)
        return bar
    }

    private fun navButton(icon: String, label: String, action: () -> Unit): NavItem {
        val iconView = TextView(this).apply {
            text = icon
            textSize = 18f
            gravity = Gravity.CENTER
        }
        // Small unread-indicator dot, top-end of the icon - GONE by default,
        // only news's badge is ever actually shown (see updateNewsBadge()),
        // but every nav item gets one for a uniform, reusable NavItem shape.
        val badgeDot = View(this).apply {
            background = flatCircle("#B3432C")
            visibility = View.GONE
        }
        val iconFrame = FrameLayout(this).apply {
            addView(iconView, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { gravity = Gravity.CENTER })
            addView(badgeDot, FrameLayout.LayoutParams(dp(9), dp(9)).apply {
                gravity = Gravity.TOP or Gravity.END
            })
        }
        val labelView = TextView(this).apply {
            text = label
            textSize = 11f
            typeface = mediumFont
            setTextColor(Color.parseColor(MUTED))
            gravity = Gravity.CENTER
            setPadding(0, dp(4), 0, 0)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(10), dp(10), dp(10), dp(6))
            isClickable = true
            isFocusable = true
            addView(iconFrame)
            addView(labelView)
            setOnClickListener { action() }
        }
        return NavItem(container, iconView, labelView, badgeDot)
    }

    private fun setActiveNav(active: NavItem) {
        for (item in listOf(personalNavItem, storeNavItem, newsNavItem, adminNavItem)) {
            val isActive = item === active
            item.icon.alpha = if (isActive) 1f else 0.5f
            item.label.typeface = if (isActive) heavyFont else mediumFont
            item.label.setTextColor(Color.parseColor(if (isActive) ACCENT else MUTED))
            item.container.background =
                if (isActive) flatRounded(ACCENT_TINT, dp(14).toFloat()) else null
        }
    }

    /** Shows the actual app grid directly in this tab - no separate page to
     * tap into first, matching the other two tabs. */
    private fun showAppStore() {
        isPersonalAreaActive = false
        isNewsActive = false
        headerLabelView.text = "חנות אפליקציות"
        setActiveNav(storeNavItem)
        contentArea.removeAllViews()

        val apps = approvedApps()
            .sortedWith(compareBy<CatalogApp> { it.sortOrder }.thenBy { it.name })

        val search = EditText(this).apply {
            hint = "חפש אפליקציה"
            textSize = 14f
            setTextColor(Color.parseColor(TEXT))
            setHintTextColor(Color.parseColor(MUTED))
            setSingleLine(true)
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            background = flatRounded(CARD, dp(14).toFloat())
            setPadding(dp(16), dp(11), dp(16), dp(11))
            setText(storeSearchQuery)
            setSelection(text.length)
        }
        contentArea.addView(
            search,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(8)
                bottomMargin = dp(10)
            }
        )

        val categories = linkedMapOf("all" to "הכל")
        apps.forEach { app ->
            if (app.category.isNotBlank() && app.category !in categories) {
                categories[app.category] = app.categoryLabel.ifBlank { "אחר" }
            }
        }
        if (selectedStoreCategory !in categories) selectedStoreCategory = "all"

        val categoryRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        categories.forEach { (key, label) ->
            val active = key == selectedStoreCategory
            categoryRow.addView(TextView(this).apply {
                text = label
                textSize = 12f
                typeface = mediumFont
                gravity = Gravity.CENTER
                setTextColor(Color.parseColor(if (active) CARD else ACCENT))
                background = flatRounded(if (active) ACCENT else CARD, dp(18).toFloat())
                setPadding(dp(14), dp(8), dp(14), dp(8))
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    selectedStoreCategory = key
                    showAppStore()
                }
            }, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                marginEnd = dp(8)
                bottomMargin = dp(4)
            })
        }

        contentArea.addView(
            HorizontalScrollView(this).apply {
                isHorizontalScrollBarEnabled = false
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                addView(categoryRow)
            },
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(8) }
        )

        val listContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        contentArea.addView(
            listContainer,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        )

        fun render() {
            renderStoreContent(listContainer, apps)
        }

        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                storeSearchQuery = s?.toString().orEmpty()
                render()
            }
            override fun afterTextChanged(s: Editable?) = Unit
        })

        render()
    }

    private fun renderStoreContent(container: LinearLayout, apps: List<CatalogApp>) {
        container.removeAllViews()

        val query = storeSearchQuery.trim().lowercase()
        val filtered = apps.filter { app ->
            val categoryMatches =
                selectedStoreCategory == "all" || app.category == selectedStoreCategory
            val textMatches =
                query.isEmpty() ||
                    app.name.lowercase().contains(query) ||
                    app.packageName.lowercase().contains(query) ||
                    app.categoryLabel.lowercase().contains(query)
            categoryMatches && textMatches
        }.sortedWith(compareBy<CatalogApp> { it.sortOrder }.thenBy { it.name })

        if (filtered.isEmpty()) {
            container.addView(TextView(this).apply {
                text = if (apps.isEmpty()) {
                    "עדיין לא אושרו אפליקציות למכשיר זה"
                } else {
                    "לא נמצאו אפליקציות תואמות"
                }
                textSize = 14f
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.CENTER
                setPadding(0, dp(34), 0, 0)
            })
            return
        }

        if (selectedStoreCategory == "all" && query.isEmpty()) {
            val updates = filtered.filter { app ->
                val installed = isInstalled(app.packageName)
                installed && isUpdateAvailable(app, installed)
            }
            if (updates.isNotEmpty()) {
                addStoreSectionTitle(container, "עדכונים")
                addStoreGrid(container, updates)
            }

            val recommended = filtered.filter { it.isRecommended }
            if (recommended.isNotEmpty()) {
                addStoreSectionTitle(container, "מומלצות")
                addStoreGrid(container, recommended)
            }
        }

        val title = when {
            query.isNotEmpty() -> "תוצאות"
            selectedStoreCategory != "all" ->
                filtered.firstOrNull()?.categoryLabel?.ifBlank { "אפליקציות" } ?: "אפליקציות"
            else -> "כל האפליקציות"
        }
        addStoreSectionTitle(container, title)
        addStoreGrid(container, filtered)
    }

    private fun addStoreSectionTitle(parent: LinearLayout, title: String) {
        parent.addView(TextView(this).apply {
            text = title
            textSize = 15f
            typeface = heavyFont
            setTextColor(Color.parseColor(TEXT))
            gravity = Gravity.RIGHT
            setPadding(dp(2), dp(10), dp(2), dp(12))
        })
    }

    private fun addStoreGrid(parent: LinearLayout, apps: List<CatalogApp>) {
        val columns = 2
        apps.chunked(columns).forEach { rowApps ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            rowApps.forEach { app ->
                row.addView(
                    appTile(app),
                    LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                        .apply {
                            marginStart = dp(6)
                            marginEnd = dp(6)
                        }
                )
            }
            repeat(columns - rowApps.size) {
                row.addView(View(this), LinearLayout.LayoutParams(0, 0, 1f))
            }
            parent.addView(
                row,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(20) }
            )
        }
    }

    /** Approved-app metadata reaches the device from the server on every sync
     * (see PolicySync / Config.appCatalog), so the list here is intersected
     * with the current allowlist rather than trusted blindly. */
    private fun approvedApps(): List<CatalogApp> {
        val allowed = Config.allowedApps(this).toSet()
        return Config.appCatalog(this).filter { it.packageName in allowed }
    }

    /** One tile, icon framed in a rounded green square (2 per row) - name and
     * status live under it instead of a separate row with its own button. */
    private fun appTile(app: CatalogApp): LinearLayout {
        val installed = isInstalled(app.packageName)

        val icon = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(96), dp(96))
            background = flatRoundedBordered(ACCENT_TINT, ACCENT, dp(20).toFloat())
            scaleType = ImageView.ScaleType.FIT_CENTER
            setPadding(dp(14), dp(14), dp(14), dp(14))
            setImageResource(android.R.drawable.sym_def_app_icon)
        }
        loadIcon(app, installed, icon)

        val name = TextView(this).apply {
            text = app.name
            textSize = 13f
            typeface = mediumFont
            setTextColor(Color.parseColor(TEXT))
            gravity = Gravity.CENTER
            maxLines = 2
            setPadding(0, dp(8), 0, 0)
        }

        val updateAvailable = isUpdateAvailable(app, installed)
        val status = TextView(this).apply {
            text = when {
                !installed -> "התקנה"
                updateAvailable -> "עדכן"
                else -> "✓ מותקן"
            }
            textSize = 11f
            typeface = mediumFont
            setTextColor(Color.parseColor(if (installed && !updateAvailable) OK else ACCENT))
            gravity = Gravity.CENTER
            setPadding(0, dp(3), 0, 0)
            if (!installed || updateAvailable) {
                isClickable = true
                isFocusable = true
                setOnClickListener { installApp(app) }
            }
        }

        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(6), 0, dp(6), 0)
            isClickable = true
            isFocusable = true
            addView(icon)
            addView(name)
            addView(status)
            setOnClickListener {
                if (installed) openInstalledApp(app.packageName)
                else installApp(app)
            }
        }
    }

    private fun isUpdateAvailable(app: CatalogApp, installed: Boolean): Boolean {
        if (!installed) return false

        // Google Play's public metadata is catalog-level, not device-specific.
        // A different version/timestamp can mean staged rollout, device/ABI
        // targeting, regional rollout, or simply metadata that is newer than
        // what this exact device is currently eligible to install.
        //
        // Therefore we deliberately do NOT label an installed app as "עדכן"
        // from versionName/timestamp heuristics alone. False update prompts are
        // worse than a conservative "מותקן". When we later have an
        // authoritative device-specific update signal, this is the one place
        // that should consume it.
        return false
    }

    private fun isInstalled(packageName: String): Boolean {
        val installedByPackageManager = try {
            val info = packageManager.getApplicationInfo(
                packageName,
                PackageManager.MATCH_UNINSTALLED_PACKAGES
            )
            (info.flags and ApplicationInfo.FLAG_INSTALLED) != 0
        } catch (_: Exception) {
            false
        }
        if (installedByPackageManager) return true

        return try {
            val dpm = getSystemService(DevicePolicyManager::class.java)
            val admin = ComponentName(this, DpcDeviceAdminReceiver::class.java)
            dpm.isDeviceOwnerApp(this.packageName) &&
                dpm.isApplicationHidden(admin, packageName)
        } catch (_: Exception) {
            false
        }
    }

    private fun openInstalledApp(packageName: String) {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        if (launchIntent != null) startActivity(launchIntent) else openPlayStoreForInstall(packageName)
    }

    /** Play Store is hidden by default like any unapproved app - this briefly
     * reveals it, opens the install page, and lets it hide itself again once
     * the window closes (see PlayStoreGate). */
    private fun openPlayStoreForInstall(packageName: String) {
        PlayStoreGate.openForInstall(this, packageName)
    }

    /** Routes an install/update tap by where the app actually comes from.
     * A PLAY-sourced app has a real Play Store listing, so that path is
     * unchanged. An APK-sourced app (uploaded directly by an admin, see
     * apkManifest.js/apkStorage.js on the server) was never published to
     * Play - sending it through openPlayStoreForInstall opens Play Store to
     * a listing that doesn't exist, which is what customers were seeing as
     * a "no connection" error from Play Store itself. This mirrors
     * AppStoreActivity.installCustomApk(), the admin-only screen that
     * already installs APK-sourced apps correctly via
     * AppInstaller.installFromUrl - customers reach the store through this
     * screen instead, so it needs the same handling. */
    private fun installApp(app: CatalogApp) {
        if (app.appSource != "APK") {
            openPlayStoreForInstall(app.packageName)
            return
        }

        val apkUrl = app.apkUrl
        val apkSha256 = app.apkSha256
        if (apkUrl.isNullOrBlank() || apkSha256.isNullOrBlank()) {
            Toast.makeText(this, "קובץ ההתקנה אינו זמין כרגע", Toast.LENGTH_LONG).show()
            return
        }

        Toast.makeText(this, "מתחיל התקנה של ${app.name}", Toast.LENGTH_SHORT).show()
        Thread {
            try {
                AppInstaller(applicationContext).installFromUrl(apkUrl, apkSha256)
                runOnUiThread {
                    Toast.makeText(this@CustomerActivity, "ההתקנה נשלחה למכשיר", Toast.LENGTH_LONG).show()
                    showAppStore()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(
                        this@CustomerActivity,
                        "ההתקנה נכשלה: ${e.message ?: "שגיאה לא ידועה"}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }.start()
    }

    private fun loadIcon(app: CatalogApp, installed: Boolean, target: ImageView) {
        if (installed) {
            try {
                val drawable = packageManager.getApplicationIcon(app.packageName)
                target.setImageDrawable(drawable)
                // Cached now so the icon still has something real to fall
                // back to later if the customer uninstalls this app - the
                // server's scraped iconUrl isn't always reliable.
                AppIconCache.save(this, app.packageName, drawable)
                return
            } catch (_: Exception) {
                // Fall through to the remote/cached icon below.
            }
        }

        val cached = AppIconCache.get(this, app.packageName)
        if (cached != null) target.setImageBitmap(cached)

        val url = app.iconUrl ?: return
        Thread {
            val bitmap: Bitmap? = try {
                URL(url).openStream().use { BitmapFactory.decodeStream(it) }
            } catch (_: Exception) {
                null
            }
            if (bitmap != null && !isFinishing) {
                runOnUiThread { target.setImageBitmap(bitmap) }
            }
        }.start()
    }

    /** A full tab like the other two, rather than a popup dialog - centered
     * PIN field, styled to match the rest of the app. Business logic (first-time
     * PIN setup vs. checking an existing one) is unchanged from the old dialog. */
    private fun showAdminLogin() {
        isPersonalAreaActive = false
        isNewsActive = false
        headerLabelView.text = "כניסת מנהל"
        setActiveNav(adminNavItem)
        contentArea.removeAllViews()

        val hasPin = Config.hasAdminPin(this)

        contentArea.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(36), dp(24), dp(36))
            background = roundedCardWithBorder()
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, dp(24), 0, dp(16)) }

            addView(TextView(this@CustomerActivity).apply {
                text = "🔒"
                textSize = 26f
                gravity = Gravity.CENTER
                background = flatCircle(ACCENT_TINT)
                layoutParams = LinearLayout.LayoutParams(dp(64), dp(64))
            })

            addView(TextView(this@CustomerActivity).apply {
                text = if (hasPin) "כניסת מנהל" else "הגדרת קוד מנהל"
                textSize = 18f
                typeface = heavyFont
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.CENTER
                setPadding(0, dp(18), 0, dp(6))
            })

            addView(TextView(this@CustomerActivity).apply {
                text = if (hasPin) "הכנס את קוד המנהל כדי להמשיך"
                       else "בחר קוד מנהל חדש בן 4 ספרות לפחות"
                textSize = 13f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.CENTER
                setPadding(dp(12), 0, dp(12), dp(22))
            })

            val input = EditText(this@CustomerActivity).apply {
                hint = if (hasPin) "קוד מנהל" else "קוד חדש"
                inputType =
                    InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
                setSingleLine()
                textSize = 20f
                typeface = heavyFont
                gravity = Gravity.CENTER
                setTextColor(Color.parseColor(TEXT))
                background = roundedCardWithBorder()
                setPadding(dp(16), dp(14), dp(16), dp(14))
                layoutParams = LinearLayout.LayoutParams(
                    dp(180),
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            }
            addView(input)

            addView(primaryButton(if (hasPin) "היכנס" else "שמור והמשך") {
                val pin = input.text.toString()

                if (!hasPin) {
                    if (pin.length < 4) {
                        Toast.makeText(
                            this@CustomerActivity,
                            "הקוד חייב להכיל לפחות 4 ספרות",
                            Toast.LENGTH_SHORT
                        ).show()
                        return@primaryButton
                    }

                    Config.setAdminPin(this@CustomerActivity, pin)

                    // Grants access in-process, right before MainActivity
                    // starts - not via an Intent extra, which any external
                    // caller could set regardless of who sent the Intent.
                    AdminAccess.grant()
                    startActivity(Intent(this@CustomerActivity, MainActivity::class.java))
                } else if (Config.checkAdminPin(this@CustomerActivity, pin)) {
                    AdminAccess.grant()
                    startActivity(Intent(this@CustomerActivity, MainActivity::class.java))
                } else {
                    Toast.makeText(
                        this@CustomerActivity,
                        "קוד שגוי",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            })
        })
    }

    private fun showPersonalArea() {
        isPersonalAreaActive = true
        isNewsActive = false
        headerLabelView.text = "אזור אישי"
        setActiveNav(personalNavItem)
        contentArea.removeAllViews()

        contentArea.addView(identityCard("האזור האישי שלך"))
        contentArea.addView(statusCard())

        contentArea.addView(sectionTitle("פרטי המנוי"))
        contentArea.addView(
            infoRowCard(
                listOf(
                    Triple("✓", "סטטוס המנוי", "פעיל"),
                    Triple("₪", "מחיר חודשי", "טרם הוגדר"),
                    Triple("▤", "תאריך הצטרפות", "טרם הוגדר"),
                )
            )
        )

        contentArea.addView(sectionTitle("המכשיר שלי"))
        contentArea.addView(
            infoRowCard(
                listOf(
                    Triple("#", "מזהה מכשיר", Config.deviceId(this)),
                    Triple("↻", "עדכון אחרון", lastSyncLabel()),
                )
            )
        )

        contentArea.addView(sectionTitle("סינון DNS"))
        contentArea.addView(dnsToggleCard())
        contentArea.addView(dnsStatusCard())
    }

    /** Header row with the on/off switch - a separate small card from the
     * read-only status rows below it, same split as statusCard()/infoRowCard()
     * above (one bespoke interactive card, one generic read-only list). */
    private fun dnsToggleCard(): LinearLayout {
        val allowToggle = Config.dnsAllowCustomerToggle(this)
        val actualOn = AdBlockDns.currentStatus(this).dnsFilteringActual
        // Never claim ad/content blocking is happening unless the server has
        // explicitly confirmed the configured provider actually filters
        // content - a plain encrypted resolver (the current placeholder,
        // dns.google) is not that, and the title/subtitle must not imply it.
        val providerFilters = Config.dnsDesiredProviderFilters(this)

        lateinit var switchView: Switch

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(16))
            background = roundedCardWithBorder()
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, dp(10), 0, dp(16)) }

            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL

                addView(TextView(this@CustomerActivity).apply {
                    text = if (providerFilters) "חסימת אתרים ופרסומות" else "DNS מאובטח"
                    textSize = 15f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

                switchView = Switch(this@CustomerActivity).apply {
                    isChecked = actualOn
                    isEnabled = allowToggle
                }
                addView(switchView)
            })

            addView(TextView(this@CustomerActivity).apply {
                text = when {
                    !allowToggle -> "ההגדרה מנוהלת על ידי מנהל המערכת"
                    !providerFilters -> "מצפין את תעבורת ה-DNS, אך הספק הנוכחי אינו חוסם תוכן"
                    else -> "ניתן להפעיל ולכבות בעצמך"
                }
                textSize = 11.5f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.RIGHT
                setPadding(0, dp(4), 0, 0)
            })
        }

        switchView.setOnCheckedChangeListener { _, isChecked ->
            if (!allowToggle) return@setOnCheckedChangeListener
            switchView.isEnabled = false
            Thread {
                // Applied locally right away regardless of network (the switch
                // must feel instant), and separately marked pending so the
                // server's own desired-state record catches up as soon as a
                // sync succeeds - see Config.setDnsPendingCustomerRequest() and
                // DeviceHealth.collect(). Without this, the server would still
                // think the old value is desired and the next scheduled sync's
                // reconcile() would silently undo this exact action.
                Config.setDnsPendingCustomerRequest(applicationContext, isChecked)
                if (isChecked) {
                    Config.dnsDesiredProviderHost(applicationContext)
                        ?.let { AdBlockDns.enable(applicationContext, it) }
                } else {
                    AdBlockDns.disable(applicationContext)
                }
                // Eager sync so the server's desired-state record catches up
                // immediately when there's a connection - also lets reconcile()
                // finish the job below if the local attempt above couldn't (e.g.
                // no provider host was known yet locally but the server has one).
                val syncFailed = try {
                    PolicySync.run(applicationContext)
                    false
                } catch (e: Exception) {
                    true
                }
                // Message is built from the actual post-attempt truth, not from
                // whichever intermediate step happened to run - so a case like
                // "no host known locally yet, but the eager sync's own
                // reconcile() picked one up from the server and applied it"
                // still reports success rather than the earlier local failure.
                val status = AdBlockDns.currentStatus(applicationContext)
                val message = when {
                    status.dnsFilteringActual == isChecked ->
                        if (isChecked) "סינון DNS הופעל" else "סינון DNS כובה (עבר ל-Opportunistic)"
                    syncFailed -> "הבקשה נשמרה במכשיר - תושלם בשרת כשהחיבור יחזור"
                    else -> "הפעולה לא הושלמה - נסה שוב"
                }
                runOnUiThread {
                    Toast.makeText(this@CustomerActivity, message, Toast.LENGTH_LONG).show()
                    // Rebuilds with the real post-action state, same pattern as
                    // the sync badges elsewhere in this app.
                    refreshPersonalAreaIfShown()
                }
            }.start()
        }

        return card
    }

    private fun dnsStatusCard(): LinearLayout {
        val status = AdBlockDns.currentStatus(this)
        return infoRowCard(
            listOf(
                Triple("◈", "מצב", dnsModeLabel(status.dnsMode)),
                Triple("⌂", "ספק", status.dnsActualProviderHost ?: "—"),
                Triple("📶", "חיבור", dnsNetworkLabel(status.currentNetworkType)),
                Triple("✓", "DNS תקין", dnsResolutionLabel(status.dnsResolutionOk)),
                Triple("⚑", "Fail-safe", dnsFailSafeLabel(status.dnsFailSafeState, status.dnsMode)),
                Triple("↻", "עודכן", dnsUpdatedLabel(status.lastDnsCheckAt)),
            )
        )
    }

    private fun dnsModeLabel(mode: DnsMode): String = when (mode) {
        DnsMode.PROVIDER_HOSTNAME -> "מסונן (Strict)"
        DnsMode.OPPORTUNISTIC -> "Opportunistic"
        DnsMode.OFF -> "כבוי"
        DnsMode.UNKNOWN -> "לא ידוע"
        DnsMode.ERROR -> "שגיאת קריאה"
    }

    private fun dnsNetworkLabel(type: DnsNetworkType): String = when (type) {
        DnsNetworkType.WIFI -> "Wi-Fi"
        DnsNetworkType.CELLULAR -> "סלולרי"
        DnsNetworkType.OTHER -> "אחר"
        DnsNetworkType.NONE -> "אין חיבור"
    }

    private fun dnsResolutionLabel(ok: Boolean?): String = when (ok) {
        true -> "כן"
        false -> "לא"
        null -> "טרם נבדק"
    }

    /** Deliberately just three outcomes for the customer, matching the design
     * spec exactly - the admin panel shows the full four-state detail instead. */
    private fun dnsFailSafeLabel(state: DnsFailSafeState, mode: DnsMode): String = when {
        mode == DnsMode.ERROR -> "תקלה"
        state == DnsFailSafeState.ROLLED_BACK -> "בוצע rollback"
        state == DnsFailSafeState.RECOVERING -> "בתהליך התאוששות"
        else -> "תקין"
    }

    private fun dnsUpdatedLabel(lastCheckAt: Long?): String {
        if (lastCheckAt == null) return "טרם נבדק"
        val minutes = ((System.currentTimeMillis() - lastCheckAt) / 60000).toInt()
        return when {
            minutes < 1 -> "לפני פחות מדקה"
            minutes < 60 -> "לפני $minutes דקות"
            else -> "לפני ${minutes / 60} שעות"
        }
    }

    /** Same rebuild-in-place idea as refreshLastSyncLabelIfShown() - a no-op
     * if some other tab is showing when the DNS toggle's own action finishes. */
    private fun refreshPersonalAreaIfShown() {
        if (isPersonalAreaActive) showPersonalArea()
    }

    // ---------- "חדשות ועדכונים" ----------

    /** Renders whatever is currently cached in newsItems immediately (so
     * opening this tab never shows a blank/loading screen), then kicks a
     * background refresh - same cache-first pattern as the app store tab's
     * approvedApps()/Config.appCatalog(). */
    private fun showNews() {
        isPersonalAreaActive = false
        isNewsActive = true
        headerLabelView.text = "חדשות ועדכונים"
        setActiveNav(newsNavItem)
        renderNewsList()
        refreshNews()
    }

    private fun renderNewsList() {
        contentArea.removeAllViews()
        // Requirement: the screen must work with zero updates too - a plain
        // empty state, never an error, same MUTED-centered-text convention
        // as "עדיין לא אושרו אפליקציות למכשיר זה" elsewhere in this file.
        if (newsItems.isEmpty()) {
            contentArea.addView(TextView(this).apply {
                text = "אין עדכונים כרגע"
                textSize = 14f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.CENTER
                setPadding(0, dp(40), 0, 0)
            })
            return
        }
        newsItems.forEach { item -> contentArea.addView(newsCard(item)) }
    }

    /** Background GET against the dedicated /updates endpoint (never folded
     * into PolicySync's main sync - see ApiClient.fetchUpdates). Best-effort:
     * a failed refresh silently keeps showing whatever was already cached/
     * rendered rather than replacing it with an error - the cache (or the
     * empty state above) is always a valid thing to show offline. */
    private fun refreshNews() {
        val deviceId = Config.deviceId(this)
        val serverUrl = Config.serverUrl(this)
        val deviceToken = Config.deviceToken(this)
        Thread {
            try {
                val fetched = ApiClient(serverUrl, deviceToken).fetchUpdates(deviceId)
                Config.setNewsCache(applicationContext, fetched)
                runOnUiThread {
                    newsItems = fetched
                    updateNewsBadge()
                    if (isNewsActive) renderNewsList()
                }
            } catch (e: Exception) {
                // Offline/server error - the tab already shows the last
                // known-good cache (or the empty state), which stays as-is.
            }
        }.start()
    }

    /** Small red dot on the bottom-nav icon, visible whenever at least one
     * cached update hasn't been opened yet (see Config.isUpdateRead). */
    private fun updateNewsBadge() {
        val hasUnread = newsItems.any { !Config.isUpdateRead(this, it.id) }
        newsNavItem.badge.visibility = if (hasUnread) View.VISIBLE else View.GONE
    }

    /** Marking as read happens here - the moment the customer actually opens
     * an update for full reading, not merely from it appearing in the list
     * (which would make the "new" indicator disappear before it was ever
     * actually seen). Read-state is local-only, per this feature's own
     * scope - see Config.markUpdateRead. */
    private fun showNewsDetail(item: UpdateItem) {
        Config.markUpdateRead(this, item.id)
        updateNewsBadge()
        contentArea.removeAllViews()

        contentArea.addView(TextView(this).apply {
            text = "→ חזרה"
            textSize = 13f
            typeface = mediumFont
            setTextColor(Color.parseColor(ACCENT))
            gravity = Gravity.RIGHT
            setPadding(dp(2), 0, dp(2), dp(18))
            isClickable = true
            isFocusable = true
            setOnClickListener { showNews() }
        })

        if (item.pinned) {
            contentArea.addView(
                newsBadge("★ חשוב", "#FBEEDD", "#A5661D"),
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(10) }
            )
        }

        contentArea.addView(TextView(this).apply {
            text = item.title
            textSize = 19f
            typeface = heavyFont
            setTextColor(Color.parseColor(TEXT))
            gravity = Gravity.RIGHT
            setPadding(0, 0, 0, dp(6))
        })

        contentArea.addView(TextView(this).apply {
            text = formatUpdateDate(item.publishedAt)
            textSize = 12f
            typeface = mediumFont
            setTextColor(Color.parseColor(MUTED))
            gravity = Gravity.RIGHT
            setPadding(0, 0, 0, dp(18))
        })

        // Plain TextView.text assignment - never Html.fromHtml or a WebView -
        // so admin-authored body content is always rendered as literal text,
        // exactly what the server stores (see backend/index.js's
        // customer-updates validation: title/body are stored/returned as
        // plain strings, no markup interpretation anywhere in this pipeline).
        contentArea.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedCardWithBorder()
            setPadding(dp(20), dp(20), dp(20), dp(20))
            addView(TextView(this@CustomerActivity).apply {
                text = item.body
                textSize = 15f
                typeface = mediumFont
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.RIGHT
                setLineSpacing(dp(4).toFloat(), 1f)
            })
        })
    }

    private fun newsCard(item: UpdateItem): LinearLayout {
        val isRead = Config.isUpdateRead(this, item.id)
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(16))
            background = roundedCardWithBorder()
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(14) }
            isClickable = true
            isFocusable = true

            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL

                addView(TextView(this@CustomerActivity).apply {
                    text = item.title
                    textSize = 15f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                    maxLines = 2
                }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

                if (!isRead) {
                    addView(
                        newsBadge("חדש", ACCENT_TINT, ACCENT),
                        LinearLayout.LayoutParams(
                            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
                        ).apply { marginStart = dp(6) }
                    )
                }
                if (item.pinned) {
                    addView(
                        newsBadge("★", "#FBEEDD", "#A5661D"),
                        LinearLayout.LayoutParams(
                            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
                        ).apply { marginStart = dp(6) }
                    )
                }
            })

            addView(TextView(this@CustomerActivity).apply {
                text = item.body
                textSize = 13f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.RIGHT
                maxLines = 3
                ellipsize = android.text.TextUtils.TruncateAt.END
                setPadding(0, dp(6), 0, 0)
            })

            addView(TextView(this@CustomerActivity).apply {
                text = formatUpdateDate(item.publishedAt)
                textSize = 11f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.RIGHT
                setPadding(0, dp(8), 0, 0)
            })

            setOnClickListener { showNewsDetail(item) }
        }
    }

    private fun newsBadge(text: String, bg: String, fg: String): TextView {
        return TextView(this).apply {
            this.text = text
            textSize = 10.5f
            typeface = mediumFont
            setTextColor(Color.parseColor(fg))
            background = flatRounded(bg, dp(10).toFloat())
            setPadding(dp(8), dp(3), dp(8), dp(3))
            gravity = Gravity.CENTER
        }
    }

    private fun formatUpdateDate(iso: String): String {
        return try {
            val millis = Instant.parse(iso).toEpochMilli()
            SimpleDateFormat("dd/MM/yyyy HH:mm", Locale("he", "IL")).format(java.util.Date(millis))
        } catch (e: Exception) {
            iso
        }
    }

    private fun identityCard(subtitle: String): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(20), dp(18), dp(20), dp(18))
            background = roundedCardWithBorder()
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, dp(10), 0, dp(16)) }

            addView(TextView(this@CustomerActivity).apply {
                text = "י"
                textSize = 18f
                typeface = heavyFont
                setTextColor(Color.parseColor(ACCENT))
                gravity = Gravity.CENTER
                background = flatCircle(ACCENT_TINT)
                layoutParams = LinearLayout.LayoutParams(dp(46), dp(46)).apply {
                    marginStart = dp(14)
                }
            })

            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.RIGHT
                addView(TextView(this@CustomerActivity).apply {
                    text = "יהודי כשר"
                    textSize = 16f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                })
                addView(TextView(this@CustomerActivity).apply {
                    text = subtitle
                    textSize = 12.5f
                    typeface = mediumFont
                    setTextColor(Color.parseColor(MUTED))
                    gravity = Gravity.RIGHT
                    setPadding(0, dp(2), 0, 0)
                })
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
    }

    private fun statusCard(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(20))
            background = roundedCardWithBorder()
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 0, 0, dp(14)) }

            addView(TextView(this@CustomerActivity).apply {
                text = "✓"
                textSize = 24f
                typeface = heavyFont
                setTextColor(Color.parseColor(ACCENT))
                gravity = Gravity.CENTER
                background = flatCircle(ACCENT_TINT)
                layoutParams = LinearLayout.LayoutParams(dp(56), dp(56)).apply {
                    marginStart = dp(16)
                }
            })

            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.RIGHT
                addView(TextView(this@CustomerActivity).apply {
                    text = "המנוי שלך"
                    textSize = 13f
                    typeface = mediumFont
                    setTextColor(Color.parseColor(MUTED))
                    gravity = Gravity.RIGHT
                })
                addView(TextView(this@CustomerActivity).apply {
                    text = "פעיל"
                    textSize = 26f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                    setPadding(0, dp(4), 0, 0)
                })
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
    }

    /** Rebuilds the personal-area tab so its "last synced" row picks up a
     * sync that just completed via the header badge - a no-op if some other
     * tab is showing. */
    private fun refreshLastSyncLabelIfShown() {
        if (isPersonalAreaActive) showPersonalArea()
    }

    private fun lastSyncLabel(): String {
        val last = Config.lastSyncAt(this)
        if (last == 0L) return "טרם סונכרן"
        val minutes = ((System.currentTimeMillis() - last) / 60000).toInt()
        return when {
            minutes < 1 -> "עדכון אחרון: הרגע"
            minutes < 60 -> "עדכון אחרון: לפני $minutes דקות"
            else -> "עדכון אחרון: לפני ${minutes / 60} שעות"
        }
    }

    private fun sectionTitle(title: String): TextView {
        return TextView(this).apply {
            text = title
            textSize = 13.5f
            typeface = mediumFont
            letterSpacing = 0.04f
            setTextColor(Color.parseColor(MUTED))
            gravity = Gravity.RIGHT
            setPadding(dp(2), dp(18), dp(2), dp(10))
        }
    }

    /** Icon, label, value triples rendered as rows inside one shared card. */
    private fun infoRowCard(rows: List<Triple<String, String, String>>): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedCardWithBorder()
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 0, 0, dp(4)) }

            rows.forEachIndexed { index, (icon, label, value) ->
                addView(infoRow(icon, label, value))
                if (index < rows.size - 1) {
                    addView(View(this@CustomerActivity).apply {
                        setBackgroundColor(Color.parseColor(BORDER))
                    }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)).apply {
                        marginStart = dp(20)
                        marginEnd = dp(20)
                    })
                }
            }
        }
    }

    private fun infoRow(icon: String, label: String, value: String): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(16))

            addView(TextView(this@CustomerActivity).apply {
                text = icon
                textSize = 15f
                typeface = heavyFont
                setTextColor(Color.parseColor(ACCENT))
                gravity = Gravity.CENTER
                background = flatCircle(ACCENT_TINT)
                layoutParams = LinearLayout.LayoutParams(dp(36), dp(36)).apply {
                    marginStart = dp(14)
                }
            })

            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.RIGHT
                addView(TextView(this@CustomerActivity).apply {
                    text = label
                    textSize = 12.5f
                    typeface = mediumFont
                    setTextColor(Color.parseColor(MUTED))
                    gravity = Gravity.RIGHT
                })
                addView(TextView(this@CustomerActivity).apply {
                    text = value
                    textSize = 16.5f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                    setPadding(0, dp(3), 0, 0)
                })
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
    }

    private fun primaryButton(label: String, onClick: () -> Unit): Button {
        return Button(this).apply {
            text = label
            textSize = 15f
            isAllCaps = false
            typeface = mediumFont
            setTextColor(Color.WHITE)
            background = flatRounded(ACCENT, dp(14).toFloat())
            setPadding(dp(18), dp(14), dp(18), dp(14))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(56)
            ).apply { setMargins(0, dp(4), 0, 0) }
            setOnClickListener { onClick() }
        }
    }

    private fun flatCircle(color: String): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.parseColor(color))
        }
    }

    private fun flatRounded(color: String, radius: Float): GradientDrawable {
        return GradientDrawable().apply {
            setColor(Color.parseColor(color))
            cornerRadius = radius
        }
    }

    private fun flatRoundedBordered(fill: String, border: String, radius: Float): GradientDrawable {
        return GradientDrawable().apply {
            setColor(Color.parseColor(fill))
            setStroke(dp(2), Color.parseColor(border))
            cornerRadius = radius
        }
    }

    private fun roundedCardWithBorder(): GradientDrawable {
        return GradientDrawable().apply {
            setColor(Color.parseColor(CARD))
            setStroke(dp(1), Color.parseColor(BORDER))
            cornerRadius = dp(16).toFloat()
        }
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

}
