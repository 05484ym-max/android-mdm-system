package org.mdmopen.dpc

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.view.Gravity
import android.view.View
import android.view.WindowManager

/**
 * Keeps accessibility overlays alive between WhatsApp accessibility events.
 *
 * The first implementation removed every overlay and re-added it for every
 * content-change event. WhatsApp emits many of those while scrolling and
 * animating between screens, so that approach can expose an avatar for a
 * frame. This controller renders a tiny retained list instead: beginFrame()
 * collects the desired rectangles and endFrame() updates existing windows in
 * place, creating/removing a window only when the number/type of masks really
 * changes.
 */
class WhatsAppOverlayController(private val service: AccessibilityService) {
    private val wm = service.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    private enum class Kind { MASK, TOUCH_MASK, TRANSPARENT_BLOCKER }
    private data class Spec(val bounds: Rect, val kind: Kind)
    private data class Slot(val view: View, var kind: Kind, var bounds: Rect)

    private val desired = mutableListOf<Spec>()
    private val slots = mutableListOf<Slot>()

    fun beginFrame() {
        desired.clear()
    }

    fun addMask(bounds: Rect, touchable: Boolean = false) {
        if (bounds.width() <= 1 || bounds.height() <= 1) return
        desired += Spec(Rect(bounds), if (touchable) Kind.TOUCH_MASK else Kind.MASK)
    }

    fun addTransparentTouchBlocker(bounds: Rect) {
        if (bounds.width() <= 1 || bounds.height() <= 1) return
        desired += Spec(Rect(bounds), Kind.TRANSPARENT_BLOCKER)
    }

    fun endFrame() {
        desired.forEachIndexed { index, spec ->
            if (index >= slots.size) {
                createSlot(spec)?.let(slots::add)
                return@forEachIndexed
            }

            var slot = slots[index]
            if (slot.kind != spec.kind) {
                remove(slot.view)
                val replacement = createSlot(spec)
                if (replacement != null) {
                    slots[index] = replacement
                    slot = replacement
                } else {
                    slots.removeAt(index)
                    return@forEachIndexed
                }
            }

            applyAppearance(slot.view, spec.kind)
            if (slot.bounds != spec.bounds) {
                try {
                    wm.updateViewLayout(slot.view, layoutParams(spec.bounds, spec.kind))
                    slot.bounds = Rect(spec.bounds)
                } catch (_: Exception) {
                    // WhatsApp may replace its window while animating. Keep the
                    // old mask until the next accessibility event rather than
                    // deliberately creating a visible gap here.
                }
            }
        }

        while (slots.size > desired.size) {
            val slot = slots.removeAt(slots.lastIndex)
            remove(slot.view)
        }
    }

    fun clear() {
        slots.toList().forEach { remove(it.view) }
        slots.clear()
        desired.clear()
    }

    private fun createSlot(spec: Spec): Slot? {
        val view = View(service)
        applyAppearance(view, spec.kind)
        return try {
            wm.addView(view, layoutParams(spec.bounds, spec.kind))
            Slot(view, spec.kind, Rect(spec.bounds))
        } catch (_: Exception) {
            null
        }
    }

    private fun applyAppearance(view: View, kind: Kind) {
        when (kind) {
            Kind.MASK -> {
                view.setBackgroundColor(maskColor())
                view.alpha = 1f
                view.isClickable = false
                view.setOnTouchListener(null)
            }
            Kind.TOUCH_MASK -> {
                view.setBackgroundColor(maskColor())
                view.alpha = 1f
                view.isClickable = true
                view.setOnTouchListener { _, _ -> true }
            }
            Kind.TRANSPARENT_BLOCKER -> {
                view.setBackgroundColor(Color.TRANSPARENT)
                view.alpha = 0.01f
                view.isClickable = true
                view.setOnTouchListener { _, _ -> true }
            }
        }
    }

    private fun layoutParams(bounds: Rect, kind: Kind): WindowManager.LayoutParams {
        val touchable = kind != Kind.MASK
        val flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            if (touchable) 0 else WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE

        return WindowManager.LayoutParams(
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
    }

    private fun remove(view: View) {
        try {
            wm.removeViewImmediate(view)
        } catch (_: Exception) {
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
