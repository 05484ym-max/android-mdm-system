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
        }

        page.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(24), dp(22), dp(24), dp(14))

            addView(TextView(this@AppStoreActivity).apply {
                text = "יהודי כשר"
                textSize = 21f
                typeface = heavyFont
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.RIGHT
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

            addView(TextView(this@AppStoreActivity).apply {
                text = "✓"
                textSize = 15f
                typeface = heavyFont
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                background = flatCircle(ACCENT)
                layoutParams = LinearLayout.LayoutParams(dp(34), dp(34))
            })
        })

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(4), dp(20), dp(24))
        }

        content.addView(TextView(this).apply {
            text = "חנות אפליקציות"
            textSize = 20f
            typeface = heavyFont
            setTextColor(Color.parseColor(TEXT))
            gravity = Gravity.RIGHT
            setPadding(0, 0, 0, dp(18))
        })

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
        val status = TextView(this).apply {
            text = if (installed) "✓ מותקן · בדוק עדכון" else "התקנה"
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
                target.setImageDrawable(packageManager.getApplicationIcon(app.packageName))
                return
            } catch (_: Exception) {
                // Fall through to the remote icon below.
            }
        }
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

    private fun flatCircle(color: String): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.parseColor(color))
        }
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }
}
