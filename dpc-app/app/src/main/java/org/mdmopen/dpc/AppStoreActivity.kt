package org.mdmopen.dpc

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class AppStoreActivity : Activity() {

    data class StoreApp(
        val name: String,
        val packageName: String,
        val description: String
    )

    private val apps = listOf(
        StoreApp("WhatsApp", "com.whatsapp", "הודעות, שיחות ושיתוף קבצים"),
        StoreApp("Waze", "com.waze", "ניווט, עומסי תנועה והתראות בדרך"),
        StoreApp("Gmail", "com.google.android.gm", "דואר אלקטרוני מבית Google")
    )

    private val BG = "#F5F6FA"
    private val CARD = "#FFFFFF"
    private val TEXT = "#202333"
    private val MUTED = "#7A7F91"
    private val GOLD = "#A88425"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
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

        apps.forEach { root.addView(createAppCard(it)) }

        return ScrollView(this).apply {
            setBackgroundColor(Color.parseColor(BG))
            addView(root)
        }
    }

    private fun createAppCard(app: StoreApp): LinearLayout {
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
            if (installed) {
                try {
                    setImageDrawable(packageManager.getApplicationIcon(app.packageName))
                } catch (_: Exception) {
                    setImageResource(android.R.drawable.sym_def_app_icon)
                }
            } else {
                setImageResource(android.R.drawable.sym_def_app_icon)
            }
        }

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
            text = app.description
            textSize = 12.5f
            setTextColor(Color.parseColor(MUTED))
            gravity = Gravity.RIGHT
            setPadding(0, 5, 0, 8)
        })

        info.addView(TextView(this).apply {
            text = if (installed) "✓ מותקן במכשיר" else "זמין להתקנה"
            textSize = 12f
            setTextColor(Color.parseColor(if (installed) "#328A52" else MUTED))
            gravity = Gravity.RIGHT
        })

        card.addView(info, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        val action = Button(this).apply {
            text = if (installed) "פתח" else "התקנה"
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = roundedBackground(GOLD, 40f)
            setOnClickListener {
                if (installed) openInstalledApp(app.packageName) else openPlayStore(app.packageName)
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
        if (launchIntent != null) startActivity(launchIntent) else openPlayStore(packageName)
    }

    private fun openPlayStore(packageName: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName")))
        } catch (_: Exception) {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$packageName")))
        }
    }

    private fun roundedBackground(color: String, radius: Float): GradientDrawable {
        return GradientDrawable().apply {
            setColor(Color.parseColor(color))
            cornerRadius = radius
        }
    }
}
