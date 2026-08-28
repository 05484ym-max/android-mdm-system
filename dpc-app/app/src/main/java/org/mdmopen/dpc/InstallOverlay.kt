package org.mdmopen.dpc

import android.content.Context
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
 * Full-screen, touch-blocking overlay drawn on top of Play Store once an
 * approved install has actually started. Without this, the customer keeps
 * seeing (and can keep tapping around in) the real Play Store for the whole
 * guarded window - this hides it from view and blocks all input to it for
 * however long install completion takes to detect.
 *
 * Device Owner apps get the "draw over other apps" special access
 * automatically, without a settings toggle - if that ever isn't true on some
 * OEM build, addView below throws and this silently does nothing, same as
 * every other best-effort fallback in this app.
 */
object InstallOverlay {
    private var view: LinearLayout? = null

    fun show(context: Context, appName: String) {
        if (view != null) return
        val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

        val overlay = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#F2F1E6"))
            isClickable = true
            isFocusable = true

            addView(ProgressBar(context).apply { isIndeterminate = true })
            addView(TextView(context).apply {
                text = "מתקין את $appName..."
                textSize = 16f
                typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
                setTextColor(Color.parseColor("#1C1C1C"))
                gravity = Gravity.CENTER
                setPadding(40, 40, 40, 0)
            })
        }

        val overlayType =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_SYSTEM_ALERT

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            overlayType,
            0,
            PixelFormat.OPAQUE,
        )

        try {
            windowManager.addView(overlay, params)
            view = overlay
        } catch (_: Exception) {
            // No overlay permission on this device/build - the guarded
            // window still closes itself on its own timeout regardless.
        }
    }

    fun hide(context: Context) {
        val current = view ?: return
        view = null
        val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        try {
            windowManager.removeView(current)
        } catch (_: Exception) {
        }
    }
}
