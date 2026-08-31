package org.mdmopen.dpc

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
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
            // Same fix as CustomerActivity: the manifest's supportsRtl alone
            // isn't relied on here - forced explicitly so this screen matches
            // regardless of device locale.
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }

        page.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(24), dp(18), dp(24), dp(14))

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

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(4), dp(20), dp(24))
        }

        val apps = approvedApps()
        if (apps.isEmpty()) {
            content.addView(TextView(this).apply {
                text = "עדיין לא אושרו אפליקציות למכשיר זה"
                textSize = 14f
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.CENTER
                setPadding(0, dp(30), 0, 0)
            })
        } else {
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
                content.addView(
                    row,
                    LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT
                    ).apply { setMargins(0, 0, 0, dp(20)) }
                )
            }
        }

        page.addView(
            ScrollView(this).apply {
                setBackgroundColor(Color.parseColor(BG))
                addView(content)
            },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        )

        return page
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

        // Installed apps don't get background updates while Play Store is
        // hidden most of the time, and tapping the tile just opens the app -
        // so this is the only way the customer can ever reach an update:
        // it's a separate clickable label (own click listener wins over the
        // tile's) that reopens the same guarded Play Store page, which shows
        // "Update" there when one is available and does nothing otherwise.
        val updateAvailable = if (installed && app.playUpdatedAt != null) {
            try {
                val info = packageManager.getPackageInfo(app.packageName, 0)
                app.playUpdatedAt > info.lastUpdateTime
            } catch (_: Exception) {
                false
            }
        } else {
            false
        }

        val status = TextView(this).apply {
            text = when {
                !installed -> "התקן"
                updateAvailable -> "עדכון זמין"
                app.playUpdatedAt != null -> "✓ מעודכן"
                else -> "סטטוס לא ידוע"
            }
            textSize = 10.5f
            typeface = mediumFont
            setTextColor(Color.parseColor(if (installed) OK else ACCENT))
            gravity = Gravity.CENTER
            setPadding(0, dp(2), 0, 0)
            if (installed) {
                isClickable = true
                setOnClickListener { openPlayStoreForInstall(app.packageName) }
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
                else openPlayStoreForInstall(app.packageName)
            }
        }
    }

    private fun isInstalled(packageName: String): Boolean {
        return try {
            packageManager.getPackageInfo(packageName, 0)
            true
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
