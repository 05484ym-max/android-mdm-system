package org.mdmopen.dpc

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.os.Build
import android.view.Gravity
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

/**
 * Partial guarded-install overlay shown immediately over the lower part of
 * Google Play. The upper area stays visible and interactive so the customer can
 * see Play's own real installation progress instead of a fake percentage.
 *
 * The lower shield blocks wandering around the rest of Play during the short
 * approved install window and provides an explicit safe exit that always closes
 * the managed install window and re-hides Play Store.
 */
object InstallOverlay {
    private var view: LinearLayout? = null

    fun show(context: Context, appName: String): Boolean {
        if (view != null) return true
        val appContext = context.applicationContext
        val windowManager = appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager

        val overlay = LinearLayout(appContext).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 36, 48, 36)
            setBackgroundColor(Color.parseColor("#F7F2E8"))
            isClickable = true
            isFocusable = true

            addView(TextView(appContext).apply {
                text = "התקנה מאובטחת פעילה"
                textSize = 17f
                typeface = Typeface.create("sans-serif", Typeface.BOLD)
                setTextColor(Color.parseColor("#1C231D"))
                gravity = Gravity.CENTER
            })

            addView(ProgressBar(appContext, null, android.R.attr.progressBarStyleHorizontal).apply {
                isIndeterminate = true
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 18).apply {
                topMargin = 28
            })

            addView(TextView(appContext).apply {
                text = "מתקין את $appName\nהחלק העליון של Google Play נשאר גלוי כדי שתראה את ההתקדמות האמיתית."
                textSize = 14f
                typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
                setTextColor(Color.parseColor("#4E514B"))
                gravity = Gravity.CENTER
                setPadding(0, 24, 0, 24)
            })

            addView(TextView(appContext).apply {
                text = "סגור וחזור לחנות"
                textSize = 14f
                typeface = Typeface.create("sans-serif", Typeface.BOLD)
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                setBackgroundColor(Color.parseColor("#245E38"))
                setPadding(36, 22, 36, 22)
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    PlayStoreGate.cancelCurrentInstall(appContext)
                    hide(appContext)
                    runCatching {
                        appContext.startActivity(
                            Intent(appContext, CustomerActivity::class.java)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                        )
                    }
                }
            })
        }

        val overlayType =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_SYSTEM_ALERT

        val shieldHeight = (appContext.resources.displayMetrics.heightPixels * 0.55f).toInt()
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            shieldHeight,
            overlayType,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.OPAQUE,
        ).apply {
            gravity = Gravity.BOTTOM
        }

        return try {
            windowManager.addView(overlay, params)
            view = overlay
            true
        } catch (_: Exception) {
            false
        }
    }

    fun hide(context: Context) {
        val current = view ?: return
        view = null
        val windowManager = context.applicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        try {
            windowManager.removeView(current)
        } catch (_: Exception) {
        }
    }
}
