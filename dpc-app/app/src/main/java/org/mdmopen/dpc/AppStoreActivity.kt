package org.mdmopen.dpc

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class AppStoreActivity : Activity() {

    data class StoreApp(
        val name: String,
        val packageName: String
    )

    private val apps = listOf(
        StoreApp("WhatsApp", "com.whatsapp"),
        StoreApp("Waze", "com.waze"),
        StoreApp("Gmail", "com.google.android.gm")
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
    }

    private fun buildUi(): ViewGroup {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#111111"))
            setPadding(36, 60, 36, 40)
        }

        root.addView(TextView(this).apply {
            text = "חנות האפליקציות"
            textSize = 26f
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#E8C66A"))
            setPadding(0, 0, 0, 12)
        })

        root.addView(TextView(this).apply {
            text = "אפליקציות מאושרות להתקנה ולעדכון"
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#AAAAAA"))
            setPadding(0, 0, 0, 30)
        })

        apps.forEach { app ->
            root.addView(createAppCard(app))
        }

        return ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#111111"))
            addView(root)
        }
    }

    private fun createAppCard(app: StoreApp): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(28, 24, 28, 24)
            setBackgroundColor(Color.parseColor("#1E1E1E"))

            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            params.setMargins(0, 0, 0, 20)
            layoutParams = params

            addView(TextView(this@AppStoreActivity).apply {
                text = app.name
                textSize = 20f
                setTextColor(Color.WHITE)
            })

            addView(TextView(this@AppStoreActivity).apply {
                text = app.packageName
                textSize = 11f
                setTextColor(Color.parseColor("#888888"))
                setPadding(0, 6, 0, 14)
            })

            addView(Button(this@AppStoreActivity).apply {
                text = "התקנה / עדכון"
                setBackgroundColor(Color.parseColor("#D9B84C"))
                setTextColor(Color.BLACK)

                setOnClickListener {
                    openPlayStore(app.packageName)
                }
            })
        }
    }

    private fun openPlayStore(packageName: String) {
        try {
            startActivity(
                Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse("market://details?id=$packageName")
                )
            )
        } catch (_: Exception) {
            startActivity(
                Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse("https://play.google.com/store/apps/details?id=$packageName")
                )
            )
        }
    }
}
