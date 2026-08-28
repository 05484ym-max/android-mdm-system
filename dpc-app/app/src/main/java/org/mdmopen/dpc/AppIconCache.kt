package org.mdmopen.dpc

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import java.io.File

/**
 * Caches each approved app's real icon to disk the moment it's seen
 * installed, so the store still has a real icon to show after the customer
 * uninstalls it - without this, the tile would fall back straight to the
 * catalog's iconUrl, which the server doesn't always manage to scrape
 * (see the earlier icon-scraping robustness work in the admin panel), and
 * the icon would look like it just vanished the moment the app was removed.
 */
object AppIconCache {
    private const val DIR = "app_icon_cache"

    fun save(context: Context, packageName: String, drawable: Drawable) {
        try {
            val bitmap = drawableToBitmap(drawable)
            val dir = File(context.filesDir, DIR).apply { mkdirs() }
            File(dir, "$packageName.png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        } catch (_: Exception) {
            // Best-effort - a missed cache write just means no fallback later.
        }
    }

    fun get(context: Context, packageName: String): Bitmap? {
        val file = File(File(context.filesDir, DIR), "$packageName.png")
        if (!file.exists()) return null
        return try {
            BitmapFactory.decodeFile(file.absolutePath)
        } catch (_: Exception) {
            null
        }
    }

    private fun drawableToBitmap(drawable: Drawable): Bitmap {
        val width = drawable.intrinsicWidth.takeIf { it > 0 } ?: 96
        val height = drawable.intrinsicHeight.takeIf { it > 0 } ?: 96
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        drawable.setBounds(0, 0, canvas.width, canvas.height)
        drawable.draw(canvas)
        return bitmap
    }
}
