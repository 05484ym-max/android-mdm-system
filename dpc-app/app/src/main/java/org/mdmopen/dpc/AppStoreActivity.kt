package org.mdmopen.dpc

import android.app.Activity
import android.app.AlertDialog
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.net.URL

class AppStoreActivity : Activity() {

    private val BG = "#F2F1E6"
    private val TEXT = "#1C1C1C"
    private val MUTED = "#8C8C86"
    private val ACCENT = "#4B6B45"
    private val OK = "#328A52"

    private val heavyFont = Typeface.create("sans-serif-black", Typeface.NORMAL)
    private val mediumFont = Typeface.create("sans-serif-medium", Typeface.NORMAL)

    private val mainHandler = Handler(Looper.getMainLooper())
    private var selectedCategory = "all"
    private var searchQuery = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
    }

    /** Approved-app metadata reaches the device from the server on every sync
     * (see PolicySync / Config.appCatalog), so the list here is intersected
     * with the current allowlist rather than trusted blindly. */
    private fun approvedApps(): List<CatalogApp> {
        val allowed = Config.allowedApps(this).toSet()
        return Config.appCatalog(this).filter { it.packageName in allowed }
    }

    private fun buildUi(): View {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor(BG))
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }

        page.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(24), dp(18), dp(24), dp(12))

            addView(LinearLayout(this@AppStoreActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL

                addView(ImageView(this@AppStoreActivity).apply {
                    setImageResource(R.mipmap.ic_launcher)
                    alpha = 0.85f
                    layoutParams = LinearLayout.LayoutParams(dp(38), dp(38)).apply {
                        marginEnd = dp(14)
                    }
                })

                addView(TextView(this@AppStoreActivity).apply {
                    text = "חנות אפליקציות"
                    textSize = 17f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                })
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

            addView(syncBadge())
        })

        val approved = approvedApps()
            .sortedWith(compareBy<CatalogApp> { it.sortOrder }.thenBy { it.name })

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), 0, dp(20), dp(8))
        }

        val search = EditText(this).apply {
            hint = "חפש אפליקציה"
            textSize = 14f
            setTextColor(Color.parseColor(TEXT))
            setHintTextColor(Color.parseColor(MUTED))
            setSingleLine(true)
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            background = flatRounded("#FFFFFF", dp(14).toFloat())
            setPadding(dp(16), dp(11), dp(16), dp(11))
            setText(searchQuery)
            setSelection(text.length)
        }
        controls.addView(
            search,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(10) }
        )

        val categoryBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val categoryScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            addView(categoryBar)
        }
        controls.addView(
            categoryScroll,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        )
        page.addView(controls)

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(6), dp(20), dp(24))
        }

        fun refresh() {
            renderCategoryChips(categoryBar, approved) {
                selectedCategory = it
                refresh()
            }
            renderCatalogContent(content, approved)
        }

        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                searchQuery = s?.toString().orEmpty()
                renderCatalogContent(content, approved)
            }
            override fun afterTextChanged(s: Editable?) = Unit
        })

        refresh()

        page.addView(
            ScrollView(this).apply {
                setBackgroundColor(Color.parseColor(BG))
                addView(content)
            },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        )

        return page
    }

    private fun renderCategoryChips(
        bar: LinearLayout,
        apps: List<CatalogApp>,
        onSelect: (String) -> Unit
    ) {
        bar.removeAllViews()

        val categories = linkedMapOf("all" to "הכל")
        apps.forEach { app ->
            if (app.category.isNotBlank() && app.category !in categories) {
                categories[app.category] = app.categoryLabel.ifBlank { "אחר" }
            }
        }

        // If a category disappeared from this device's approved catalog,
        // return to "all" instead of leaving the screen stuck on an empty filter.
        if (selectedCategory !in categories) selectedCategory = "all"

        categories.forEach { (key, label) ->
            val active = key == selectedCategory
            bar.addView(TextView(this).apply {
                text = label
                textSize = 12f
                typeface = mediumFont
                gravity = Gravity.CENTER
                setTextColor(Color.parseColor(if (active) "#FFFFFF" else ACCENT))
                background = flatRounded(if (active) ACCENT else "#FFFFFF", dp(18).toFloat())
                setPadding(dp(14), dp(8), dp(14), dp(8))
                isClickable = true
                isFocusable = true
                setOnClickListener { onSelect(key) }
            }, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                marginEnd = dp(8)
                bottomMargin = dp(4)
            })
        }
    }

    private fun renderCatalogContent(content: LinearLayout, apps: List<CatalogApp>) {
        content.removeAllViews()

        val query = searchQuery.trim().lowercase()
        val filtered = apps.filter { app ->
            val categoryMatches = selectedCategory == "all" || app.category == selectedCategory
            val textMatches = query.isEmpty() ||
                app.name.lowercase().contains(query) ||
                app.packageName.lowercase().contains(query) ||
                app.categoryLabel.lowercase().contains(query)
            categoryMatches && textMatches
        }.sortedWith(compareBy<CatalogApp> { it.sortOrder }.thenBy { it.name })

        if (filtered.isEmpty()) {
            content.addView(TextView(this).apply {
                text = if (apps.isEmpty()) {
                    "עדיין לא אושרו אפליקציות למכשיר זה"
                } else {
                    "לא נמצאו אפליקציות תואמות"
                }
                textSize = 14f
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.CENTER
                setPadding(0, dp(30), 0, 0)
            })
            return
        }

        if (selectedCategory == "all" && query.isEmpty()) {
            val updates = filtered.filter { app ->
                val installed = isInstalled(app.packageName)
                installed && isUpdateAvailable(app, installed)
            }
            if (updates.isNotEmpty()) {
                addSectionTitle(content, "עדכונים")
                addAppGrid(content, updates)
            }

            val recommended = filtered.filter { it.isRecommended }
            if (recommended.isNotEmpty()) {
                addSectionTitle(content, "מומלצות")
                addAppGrid(content, recommended)
            }
        }

        val sectionTitle = when {
            query.isNotEmpty() -> "תוצאות"
            selectedCategory != "all" ->
                filtered.firstOrNull()?.categoryLabel?.ifBlank { "אפליקציות" } ?: "אפליקציות"
            else -> "כל האפליקציות"
        }
        addSectionTitle(content, sectionTitle)
        addAppGrid(content, filtered)
    }

    private fun addSectionTitle(parent: LinearLayout, title: String) {
        parent.addView(TextView(this).apply {
            text = title
            textSize = 15f
            typeface = heavyFont
            setTextColor(Color.parseColor(TEXT))
            gravity = Gravity.RIGHT
            setPadding(dp(2), dp(10), dp(2), dp(12))
        })
    }

    private fun addAppGrid(parent: LinearLayout, apps: List<CatalogApp>) {
        val columns = 3
        apps.chunked(columns).forEach { rowApps ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            rowApps.forEach { app ->
                row.addView(
                    appTile(app),
                    LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
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
                ).apply { setMargins(0, 0, 0, dp(18)) }
            )
        }
    }

    /** Same sync badge as CustomerActivity's header - this screen is a
     * separate Activity so it can't share that private function directly. */
    private fun syncBadge(): TextView {
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
                                this@AppStoreActivity,
                                "המכשיר סונכרן בהצלחה\n$result",
                                Toast.LENGTH_LONG
                            ).show()
                            // Newly approved apps only show up here after a
                            // full rebuild - the grid is drawn once at onCreate.
                            setContentView(buildUi())
                        }
                    } catch (e: Exception) {
                        runOnUiThread {
                            text = "↻ סינכרון"
                            isClickable = true
                            Toast.makeText(
                                this@AppStoreActivity,
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

    /** One square icon tile, Play-Store-grid style - name and status live
     * under the icon instead of a separate row with its own button. */
    private fun appTile(app: CatalogApp): LinearLayout {
        val installed = isInstalled(app.packageName)

        val icon = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(64), dp(64))
            setImageResource(android.R.drawable.sym_def_app_icon)
        }
        loadIcon(app, installed, icon)

        val name = TextView(this).apply {
            text = app.name
            textSize = 12.5f
            typeface = mediumFont
            setTextColor(Color.parseColor(TEXT))
            gravity = Gravity.CENTER
            maxLines = 2
            setPadding(0, dp(6), 0, 0)
        }

        // Status is resolved automatically when the store screen is built:
        // install if absent, update if the Play metadata points to a newer/
        // different release, otherwise installed. Prefer the actual Play
        // version string when available; fall back to the Play listing's
        // updated timestamp for older catalog rows that do not have a version.
        val updateAvailable = isUpdateAvailable(app, installed)

        val status = TextView(this).apply {
            text = when {
                app.appSource == "APK" && installed -> "התקן/עדכן"
                app.appSource == "APK" -> "התקנה"
                !installed -> "התקנה"
                updateAvailable -> "עדכן"
                else -> "בדוק עדכון"
            }
            textSize = 10.5f
            typeface = mediumFont
            setTextColor(
                Color.parseColor(
                    when {
                        !installed -> ACCENT
                        updateAvailable -> ACCENT
                        else -> ACCENT
                    }
                )
            )
            gravity = Gravity.CENTER
            setPadding(0, dp(2), 0, 0)

            // Installation/update eligibility must be decided by Play Store
            // for this exact device. Do not infer it from public metadata.
            isClickable = true
            isFocusable = true
            setOnClickListener {
                if (app.appSource == "APK") installCustomApk(app)
                else openPlayStoreForInstall(app.packageName)
            }
        }

        val open = TextView(this).apply {
            text = "פתח"
            textSize = 10.5f
            typeface = mediumFont
            setTextColor(Color.parseColor(ACCENT))
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(5), dp(8), dp(5))
            visibility = if (installed) View.VISIBLE else View.GONE
            isClickable = installed
            isFocusable = installed
            if (installed) {
                setOnClickListener { openInstalledApp(app.packageName) }
            }
        }

        val remove = TextView(this).apply {
            text = "הסר"
            textSize = 10.5f
            typeface = mediumFont
            setTextColor(Color.parseColor("#B3432C"))
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(5), dp(8), dp(5))
            visibility = if (installed) View.VISIBLE else View.GONE
            isClickable = installed
            isFocusable = installed
            if (installed) {
                setOnClickListener { confirmQuickUninstall(app) }
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
            addView(open)
            addView(remove)
            setOnClickListener {
                if (app.appSource == "APK") {
                    installCustomApk(app)
                } else {
                    openPlayStoreForInstall(app.packageName)
                }
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
        // Approved/managed is not the same thing as installed. Query retained
        // package metadata so hidden apps are still visible, but only treat the
        // package as installed when Android sets FLAG_INSTALLED.
        return try {
            val info = packageManager.getApplicationInfo(
                packageName,
                PackageManager.MATCH_UNINSTALLED_PACKAGES
            )
            (info.flags and ApplicationInfo.FLAG_INSTALLED) != 0
        } catch (_: PackageManager.NameNotFoundException) {
            false
        } catch (_: Exception) {
            false
        }
    }

    private fun confirmQuickUninstall(app: CatalogApp) {
        AlertDialog.Builder(this)
            .setTitle("הסרת אפליקציה")
            .setMessage("להסיר את " + app.name + " מהמכשיר?")
            .setNegativeButton("ביטול", null)
            .setPositiveButton("הסר") { _, _ ->
                try {
                    AppInstaller(this).uninstall(app.packageName)
                    Toast.makeText(this, "הסרת " + app.name + " הופעלה", Toast.LENGTH_LONG).show()
                    mainHandler.postDelayed({ setContentView(buildUi()) }, 1200)
                } catch (e: Exception) {
                    Toast.makeText(this, "ההסרה נכשלה: " + (e.message ?: "שגיאה לא ידועה"), Toast.LENGTH_LONG).show()
                }
            }
            .show()
    }

    private fun installCustomApk(app: CatalogApp) {
        val apkUrl = app.apkUrl
        val apkSha256 = app.apkSha256
        if (apkUrl.isNullOrBlank() || apkSha256.isNullOrBlank()) {
            Toast.makeText(this, "קובץ ההתקנה אינו זמין כרגע", Toast.LENGTH_LONG).show()
            return
        }

        Toast.makeText(this, "מתחיל התקנה של " + app.name, Toast.LENGTH_SHORT).show()
        Thread {
            try {
                AppInstaller(applicationContext).installFromUrl(apkUrl, apkSha256)
                runOnUiThread {
                    Toast.makeText(this@AppStoreActivity, "ההתקנה נשלחה למכשיר", Toast.LENGTH_LONG).show()
                    mainHandler.postDelayed({ setContentView(buildUi()) }, 1500)
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(
                        this@AppStoreActivity,
                        "ההתקנה נכשלה: " + (e.message ?: "שגיאה לא ידועה"),
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }.start()
    }
    private fun openInstalledApp(packageName: String) {
        // approvedApps() already guarantees this package is server-approved.
        // Recover from a stale hidden state before resolving its launcher.
        try {
            val dpm = getSystemService(DevicePolicyManager::class.java)
            if (dpm.isDeviceOwnerApp(this.packageName)) {
                val admin = ComponentName(this, DpcDeviceAdminReceiver::class.java)
                if (dpm.isApplicationHidden(admin, packageName)) {
                    dpm.setApplicationHidden(admin, packageName, false)
                }
            }
        } catch (_: Exception) {
            // PolicySync/PolicyEnforcer remains the primary enforcement path;
            // a UI recovery failure here must not crash the store.
        }

        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        if (launchIntent != null) {
            startActivity(launchIntent)
        } else {
            Toast.makeText(
                this,
                "האפליקציה מותקנת אך עדיין אינה זמינה לפתיחה. נסה סנכרון נוסף.",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    /** Play Store is hidden by default like any unapproved app - this briefly
     * reveals it, opens the install page, and lets it hide itself again once
     * the window closes (see PlayStoreGate). */
    private fun openPlayStoreForInstall(packageName: String) {
        PlayStoreGate.openForInstall(this, packageName)
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
                mainHandler.post { target.setImageBitmap(bitmap) }
            }
        }.start()
    }

    private fun flatRounded(color: String, radius: Float): GradientDrawable {
        return GradientDrawable().apply {
            setColor(Color.parseColor(color))
            cornerRadius = radius
        }
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }
}
