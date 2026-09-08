package org.mdmopen.dpc

import android.app.Activity
import android.app.Application
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import java.util.WeakHashMap

/**
 * Visual-only polish for CustomerActivity.
 *
 * Keeps the existing customer/store behavior untouched while replacing the old
 * text-glyph bottom navigation with consistent vector icons, normalising
 * two-column store card geometry and sharpening the transparent gold header emblem.
 */
class CustomerUiPolish : Application.ActivityLifecycleCallbacks {

    private val listeners = WeakHashMap<Activity, View.OnLayoutChangeListener>()

    override fun onActivityResumed(activity: Activity) {
        if (activity !is CustomerActivity) return
        val root = activity.window?.decorView ?: return
        polish(activity, root)
        if (listeners.containsKey(activity)) return

        val listener = View.OnLayoutChangeListener { v, _, _, _, _, _, _, _, _ ->
            polish(activity, v)
        }
        listeners[activity] = listener
        root.addOnLayoutChangeListener(listener)
    }

    override fun onActivityDestroyed(activity: Activity) {
        listeners.remove(activity)?.let { listener ->
            activity.window?.decorView?.removeOnLayoutChangeListener(listener)
        }
    }

    private fun polish(activity: Activity, root: View) {
        polishHeaderLogo(activity, root)
        polishNavigation(activity, root)
        equaliseStoreCards(activity, root)
    }

    /**
     * Keep the exact existing transparent emblem, but render it a little larger
     * and with slightly stronger saturation/contrast so the gold remains crisp
     * against the warm cream background on lower-density Samsung displays.
     */
    private fun polishHeaderLogo(activity: Activity, view: View) {
        if (view is ImageView) {
            val parent = view.parent as? LinearLayout
            val lp = view.layoutParams
            val old38 = dp(activity, 38)
            val tolerance = dp(activity, 3)
            val isHeaderEmblem = parent?.orientation == LinearLayout.HORIZONTAL &&
                parent.childCount == 3 &&
                lp != null &&
                lp.width in (old38 - tolerance)..(old38 + tolerance) &&
                lp.height in (old38 - tolerance)..(old38 + tolerance)

            if (isHeaderEmblem) {
                val target = dp(activity, 46)
                if (lp.width != target || lp.height != target) {
                    lp.width = target
                    lp.height = target
                    view.layoutParams = lp
                }
                view.scaleType = ImageView.ScaleType.CENTER_INSIDE
                view.setPadding(0, 0, 0, 0)
                view.alpha = 1f

                val saturation = ColorMatrix().apply { setSaturation(1.28f) }
                val contrastScale = 1.10f
                val translate = 255f * (1f - contrastScale) * 0.5f
                val contrast = ColorMatrix(
                    floatArrayOf(
                        contrastScale, 0f, 0f, 0f, translate,
                        0f, contrastScale, 0f, 0f, translate,
                        0f, 0f, contrastScale, 0f, translate,
                        0f, 0f, 0f, 1f, 0f,
                    )
                )
                saturation.postConcat(contrast)
                view.colorFilter = ColorMatrixColorFilter(saturation)
            }
        }
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) polishHeaderLogo(activity, view.getChildAt(i))
        }
    }

    private fun polishNavigation(activity: Activity, view: View) {
        if (view is TextView) {
            val resId = when (view.text?.toString()) {
                "●" -> R.drawable.nav_person
                "▦" -> R.drawable.nav_store
                "▤" -> R.drawable.nav_news
                "♧" -> R.drawable.nav_support
                "▱" -> R.drawable.nav_admin
                else -> (view.tag as? NavIconTag)?.resId
            }
            if (resId != null) {
                if (view.tag !is NavIconTag) {
                    view.tag = NavIconTag(resId)
                    view.text = ""
                    view.compoundDrawablePadding = 0
                }
                val selected = navContainer(view)?.background != null
                val tint = Color.parseColor(if (selected) "#17472B" else "#85867E")
                val icon = activity.getDrawable(resId)?.mutate()
                icon?.setTint(tint)
                val size = dp(activity, 24)
                icon?.setBounds(0, 0, size, size)
                view.setCompoundDrawables(icon, null, null, null)
                view.compoundDrawableTintList = ColorStateList.valueOf(tint)
                view.gravity = android.view.Gravity.CENTER
                view.alpha = if (selected) 1f else 0.82f
            }
        }
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) polishNavigation(activity, view.getChildAt(i))
        }
    }

    private fun navContainer(icon: TextView): LinearLayout? {
        val frame = icon.parent as? FrameLayout ?: return null
        return frame.parent as? LinearLayout
    }

    private fun equaliseStoreCards(activity: Activity, view: View) {
        if (view is LinearLayout && looksLikeStoreTile(view)) {
            val cardHeight = dp(activity, 242)
            val lp = view.layoutParams
            if (lp != null && lp.height != cardHeight) {
                lp.height = cardHeight
                view.layoutParams = lp
            }

            (view.getChildAt(1) as? TextView)?.let { name ->
                name.minHeight = dp(activity, 46)
                name.gravity = android.view.Gravity.CENTER
            }
            (view.getChildAt(2) as? TextView)?.let { category ->
                category.minHeight = dp(activity, 31)
                category.gravity = android.view.Gravity.CENTER
            }
        }
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) equaliseStoreCards(activity, view.getChildAt(i))
        }
    }

    private fun looksLikeStoreTile(view: LinearLayout): Boolean {
        if (view.orientation != LinearLayout.VERTICAL || view.childCount != 4) return false
        if (view.getChildAt(0) !is ImageView) return false
        val name = view.getChildAt(1) as? TextView ?: return false
        val category = view.getChildAt(2) as? TextView ?: return false
        val status = view.getChildAt(3) as? TextView ?: return false
        if (name.text.isNullOrBlank() || category.text.isNullOrBlank()) return false
        val statusText = status.text?.toString().orEmpty()
        return statusText.contains("מותקן") || statusText == "התקנה" || statusText == "עדכן"
    }

    private fun dp(activity: Activity, value: Int): Int =
        (value * activity.resources.displayMetrics.density).toInt()

    private data class NavIconTag(val resId: Int)

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
}
