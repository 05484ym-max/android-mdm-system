package org.mdmopen.dpc

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.net.URL

class AppStoreActivity : Activity() {

    private val BG = "#F2F1E6"
    private val CARD = "#FFFFFF"
    private val TEXT = "#1C1C1C"
    private val MUTED = "#8C8C86"
    private val GOLD = "#4B6B45"

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

    private fun buildUi(): ScrollView {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor(BG))
            setPadding(30, 48, 30, 40)
        }

        root.addView(TextView(this).apply {
            text = "חנות האפליקציות"
            textSize = 27f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor(TEXT))
            gravity = Gravity.RIGHT
        })

        root.addView(TextView(this).apply {
            text = "אפליקציות מאושרות למכשיר שלך"
            textSize = 14f
            setTextColor(Color.parseColor(MUTED))
            gravity = Gravity.RIGHT
            setPadding(0, 8, 0, 30)
        })

        val apps = approvedApps()
        if (apps.isEmpty()) {
            root.addView(TextView(this).apply {
                text = "עדיין לא אושרו אפליקציות למכשיר זה"
                textSize = 14f
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.RIGHT
                setPadding(0, 10, 0, 0)
            })
        } else {
            apps.forEach { root.addView(createAppCard(it)) }
        }

        return ScrollView(this).apply {
            setBackgroundColor(Color.parseColor(BG))
            addView(root)
        }
    }

    private fun createAppCard(app: CatalogApp): LinearLayout {
        val installed = isInstalled(app.packageName)

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(22, 22, 22, 22)
            background = roundedBackground(CARD, 24f)
            elevation = 4f
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 0, 0, 18) }
        }

        val icon = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(92, 92).apply {
                setMargins(14, 0, 22, 0)
            }
            setImageResource(android.R.drawable.sym_def_app_icon)
        }
        loadIcon(app, installed, icon)

        val info = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.RIGHT
        }

        info.addView(TextView(this).apply {
            text = app.name
            textSize = 19f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor(TEXT))
            gravity = Gravity.RIGHT
        })

        info.addView(TextView(this).apply {
            text = if (installed) "✓ מותקן במכשיר" else "זמין להתקנה דרך Play Store"
            textSize = 12.5f
            setTextColor(Color.parseColor(if (installed) "#328A52" else MUTED))
            gravity = Gravity.RIGHT
            setPadding(0, 5, 0, 0)
        })

        card.addView(info, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        val action = Button(this).apply {
            text = if (installed) "פתח" else "התקנה"
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = roundedBackground(GOLD, 40f)
            setOnClickListener {
                if (installed) openInstalledApp(app.packageName)
                else openPlayStoreForInstall(app.packageName)
            }
        }

        card.addView(action, LinearLayout.LayoutParams(210, 105).apply {
            setMargins(18, 0, 0, 0)
        })

        card.addView(icon)
        return card
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

    /** Opens this app's install page in the real Play Store. StoreGuardAccessibilityService
     * would otherwise bounce the customer straight back out of Play Store - the allow
     * window here is what tells it this particular visit was sanctioned. */
    private fun openPlayStoreForInstall(packageName: String) {
        Config.setPlayStoreAllowedUntil(
            this,
            System.currentTimeMillis() + StoreGuardAccessibilityService.ALLOW_WINDOW_MS,
        )
        try {
            startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName"))
                    .setPackage("com.android.vending")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (_: Exception) {
            startActivity(
                Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse("https://play.google.com/store/apps/details?id=$packageName"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
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

    private fun roundedBackground(color: String, radius: Float): GradientDrawable {
        return GradientDrawable().apply {
            setColor(Color.parseColor(color))
            cornerRadius = radius
        }
    }
}
