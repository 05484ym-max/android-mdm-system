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
 * two-column store card geometry, removing duplicate store cards, and sharpening
 * the transparent gold header emblem.
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
        dedupeStoreCards(activity, root)
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
            // Every app tile gets the exact same outer height, regardless of
            // app-name length or whether its status is Install/Installed/Update.
            val cardHeight = dp(activity, 242)
            val lp = view.layoutParams
            if (lp != null && lp.height != cardHeight) {
                lp.height = cardHeight
                view.layoutParams = lp
            }
            view.minimumHeight = cardHeight

            (view.getChildAt(1) as? TextView)?.let { name ->
                name.minHeight = dp(activity, 46)
                name.minLines = 2
                name.maxLines = 2
                name.ellipsize = android.text.TextUtils.TruncateAt.END
                name.gravity = android.view.Gravity.CENTER
            }
            (view.getChildAt(2) as? TextView)?.let { category ->
                category.minHeight = dp(activity, 31)
                category.maxLines = 1
                category.ellipsize = android.text.TextUtils.TruncateAt.END
                category.gravity = android.view.Gravity.CENTER
            }
        }
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) equaliseStoreCards(activity, view.getChildAt(i))
        }
    }

    /**
     * CustomerActivity intentionally renders recommended/update sections and then
     * the full catalog, which can make the same app appear twice. This pass finds
     * the store list container, keeps the first visible instance of each app, and
     * rebuilds one compact two-column grid from the unique cards. The card itself
     * is reused, so install/update click behavior and state remain exactly intact.
     */
    private fun dedupeStoreCards(activity: Activity, view: View) {
        if (view is LinearLayout && looksLikeStoreListContainer(view)) {
            rebuildUniqueStoreGrid(activity, view)
            return
        }
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) dedupeStoreCards(activity, view.getChildAt(i))
        }
    }

    private fun looksLikeStoreListContainer(view: LinearLayout): Boolean {
        if (view.orientation != LinearLayout.VERTICAL || view.childCount == 0) return false
        var tileCount = 0
        for (i in 0 until view.childCount) {
            val child = view.getChildAt(i) as? LinearLayout ?: continue
            if (child.orientation != LinearLayout.HORIZONTAL) continue
            for (j in 0 until child.childCount) {
                val tile = child.getChildAt(j) as? LinearLayout ?: continue
                if (looksLikeStoreTile(tile)) tileCount += 1
            }
        }
        return tileCount >= 2
    }

    private fun rebuildUniqueStoreGrid(activity: Activity, container: LinearLayout) {
        val unique = LinkedHashMap<String, LinearLayout>()
        for (i in 0 until container.childCount) {
            val row = container.getChildAt(i) as? LinearLayout ?: continue
            if (row.orientation != LinearLayout.HORIZONTAL) continue
            for (j in 0 until row.childCount) {
                val tile = row.getChildAt(j) as? LinearLayout ?: continue
                if (!looksLikeStoreTile(tile)) continue
                val key = storeTileKey(tile)
                unique.putIfAbsent(key, tile)
            }
        }

        val currentTileCount = countStoreTiles(container)
        if (unique.isEmpty() || unique.size == currentTileCount) return

        // Detach cards before clearing their old rows. We deliberately remove
        // the recommendation/update section headings too, so every app has one
        // canonical card and there are no blank holes left by duplicate removal.
        unique.values.forEach { tile ->
            (tile.parent as? ViewGroup)?.removeView(tile)
        }
        container.removeAllViews()

        unique.values.toList().chunked(2).forEach { pair ->
            val row = LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.TOP
            }
            pair.forEachIndexed { index, tile ->
                row.addView(tile, LinearLayout.LayoutParams(0, dp(activity, 242), 1f).apply {
                    if (index == 0) marginEnd = dp(activity, 6) else marginStart = dp(activity, 6)
                })
            }
            if (pair.size == 1) {
                row.addView(View(activity), LinearLayout.LayoutParams(0, 0, 1f))
            }
            container.addView(
                row,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { bottomMargin = dp(activity, 13) },
            )
        }
    }

    private fun countStoreTiles(container: LinearLayout): Int {
        var count = 0
        for (i in 0 until container.childCount) {
            val row = container.getChildAt(i) as? LinearLayout ?: continue
            for (j in 0 until row.childCount) {
                val tile = row.getChildAt(j) as? LinearLayout ?: continue
                if (looksLikeStoreTile(tile)) count += 1
            }
        }
        return count
    }

    private fun storeTileKey(tile: LinearLayout): String {
        val name = (tile.getChildAt(1) as? TextView)?.text?.toString()?.trim().orEmpty()
        val category = (tile.getChildAt(2) as? TextView)?.text?.toString()?.trim().orEmpty()
        return "$name\u0000$category"
    }

    private fun looksLikeStoreTile(view: LinearLayout): Boolean {
        if (view.orientation != LinearLayout.VERTICAL || view.childCount != 4) return false
        if (view.getChildAt(0) !is ImageView) return false
        val name = view.getChildAt(1) as? TextView ?: return false
        val category = view.getChildAt(2) as? TextView ?: return false
        val status = view.getChildAt(3) as? TextView ?: return false
        if (name.text.isNullOrBlank() || category.text.isNullOrBlank()) return false
        val statusText = status.text?.toString().orEmpty()
        return statusText == "התקנה" ||
            statusText.contains("מותקן") ||
            statusText.contains("עדכון")
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
