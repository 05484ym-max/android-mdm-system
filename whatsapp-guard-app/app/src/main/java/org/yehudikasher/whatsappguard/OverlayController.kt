package org.yehudikasher.whatsappguard

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.view.Gravity
import android.view.View
import android.view.WindowManager

class OverlayController(private val service: AccessibilityService) {
    private val wm = service.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val overlays = mutableListOf<View>()

    fun clear() {
        overlays.toList().forEach {
            try { wm.removeViewImmediate(it) } catch (_: Exception) {}
        }
        overlays.clear()
    }

    fun addMask(bounds: Rect, radiusLikeCircle: Boolean = false) {
        if (bounds.width() <= 1 || bounds.height() <= 1) return
        val view = View(service).apply {
            setBackgroundColor(maskColor())
            alpha = 1f
        }
        add(view, bounds, touchable = false)
    }

    fun addTouchBlocker(bounds: Rect) {
        if (bounds.width() <= 1 || bounds.height() <= 1) return
        val view = View(service).apply {
            setBackgroundColor(Color.TRANSPARENT)
            alpha = 0.01f
            isClickable = true
            setOnTouchListener { _, _ -> true }
        }
        add(view, bounds, touchable = true)
    }

    fun addSectionBlock(bounds: Rect) {
        if (bounds.width() <= 1 || bounds.height() <= 1) return
        val view = View(service).apply {
            setBackgroundColor(maskColor())
            isClickable = true
            setOnTouchListener { _, _ -> true }
        }
        add(view, bounds, touchable = true)
    }

    private fun add(view: View, bounds: Rect, touchable: Boolean) {
        val flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            if (touchable) 0 else WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE

        val lp = WindowManager.LayoutParams(
            bounds.width(),
            bounds.height(),
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            flags,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = bounds.left
            y = bounds.top
        }
        try {
            wm.addView(view, lp)
            overlays.add(view)
        } catch (_: Exception) {
            // Best-effort: stale windows can disappear while WhatsApp animates.
        }
    }

    private fun maskColor(): Int {
        val night = service.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        return if (night == Configuration.UI_MODE_NIGHT_YES) {
            Color.parseColor("#202C33")
        } else {
            Color.parseColor("#F0F2F5")
        }
    }
}
