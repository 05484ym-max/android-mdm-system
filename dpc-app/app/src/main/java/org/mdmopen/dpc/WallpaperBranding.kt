package org.mdmopen.dpc

import android.app.WallpaperManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.util.Log

/**
 * Stamps the transparent "יהודי כשר" emblem onto the customer's own home and
 * lock screen wallpaper - their photo stays visible underneath, the emblem
 * just sits in the upper third rather than covering the screen.
 *
 * Reading the live wallpaper bitmap back from WallpaperManager is one of a
 * few APIs Android has tightened access to over the years for privacy
 * reasons, and Device Owner status doesn't automatically guarantee it still
 * works on every OS version - if it's blocked here, this silently does
 * nothing rather than breaking the sync that called it.
 */
object WallpaperBranding {
    private const val TAG = "WallpaperBranding"
    private const val PREFS = "dpc_wallpaper"
    private const val KEY_LAST_ID = "last_branded_wallpaper_id"

    fun apply(context: Context) {
        try {
            val dpm = context.getSystemService(DevicePolicyManager::class.java)
            if (!dpm.isDeviceOwnerApp(context.packageName)) return

            val wallpaperManager = WallpaperManager.getInstance(context)
            val currentId = wallpaperManager.getWallpaperId(WallpaperManager.FLAG_SYSTEM)
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

            // Already branded this exact wallpaper - re-running would stamp
            // the emblem onto our own previous composite.
            if (currentId != -1 && prefs.getInt(KEY_LAST_ID, Int.MIN_VALUE) == currentId) return

            val drawable = wallpaperManager.drawable ?: return
            val original = drawableToBitmap(drawable)
            val emblem = BitmapFactory.decodeResource(context.resources, R.drawable.emblem_transparent)
                ?: return

            val branded = compositeEmblem(original, emblem)

            wallpaperManager.setBitmap(branded, null, true, WallpaperManager.FLAG_SYSTEM)
            wallpaperManager.setBitmap(branded, null, true, WallpaperManager.FLAG_LOCK)

            val newId = wallpaperManager.getWallpaperId(WallpaperManager.FLAG_SYSTEM)
            prefs.edit().putInt(KEY_LAST_ID, newId).apply()
        } catch (e: Exception) {
            Log.w(TAG, "Could not brand the wallpaper", e)
        }
    }

    private fun drawableToBitmap(drawable: Drawable): Bitmap {
        if (drawable is BitmapDrawable && drawable.bitmap != null) return drawable.bitmap
        val width = drawable.intrinsicWidth.takeIf { it > 0 } ?: 1080
        val height = drawable.intrinsicHeight.takeIf { it > 0 } ?: 1920
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        drawable.setBounds(0, 0, canvas.width, canvas.height)
        drawable.draw(canvas)
        return bitmap
    }

    /** Emblem sized to a little over half the screen width, centered
     * horizontally, anchored in the upper third rather than filling it. */
    private fun compositeEmblem(background: Bitmap, emblem: Bitmap): Bitmap {
        val result = background.copy(Bitmap.Config.ARGB_8888, true) ?: return background
        val canvas = Canvas(result)

        val targetWidth = result.width * 0.55f
        val scale = targetWidth / emblem.width
        val targetHeight = emblem.height * scale

        val left = (result.width - targetWidth) / 2f
        val top = result.height * 0.14f

        val destRect = RectF(left, top, left + targetWidth, top + targetHeight)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        canvas.drawBitmap(emblem, null, destRect, paint)

        return result
    }
}
