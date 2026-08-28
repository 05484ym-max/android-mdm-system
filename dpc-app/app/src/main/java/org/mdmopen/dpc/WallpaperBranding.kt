package org.mdmopen.dpc

import android.Manifest
import android.app.WallpaperManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.util.Log
import java.io.File

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
    // Renamed from "dpc_wallpaper" - a prior attempt could have recorded an
    // "already branded" id despite never actually reading the real wallpaper
    // (see grantWallpaperReadPermission below), which would have silently
    // blocked every retry since. A fresh prefs file forces one clean re-try.
    private const val PREFS = "dpc_wallpaper_v2"
    private const val KEY_LAST_ID = "last_branded_wallpaper_id"
    private const val KEY_RECIPE_VERSION = "recipe_version"
    private const val ORIGINAL_FILE = "wallpaper_original.png"

    // Bump this whenever compositeEmblem()'s sizing or the emblem asset
    // itself changes, so a device already branded under an older recipe
    // gets one clean re-composite from the saved original instead of never
    // updating (same id forever looks "already done") or stamping the new
    // emblem onto its own previous output (see apply() below).
    private const val RECIPE_VERSION = 2

    fun apply(context: Context) {
        try {
            val dpm = context.getSystemService(DevicePolicyManager::class.java)
            if (!dpm.isDeviceOwnerApp(context.packageName)) return

            grantWallpaperReadPermission(context, dpm)

            val wallpaperManager = WallpaperManager.getInstance(context)
            val currentId = wallpaperManager.getWallpaperId(WallpaperManager.FLAG_SYSTEM)
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val originalFile = File(context.filesDir, ORIGINAL_FILE)

            val isOurOwnComposite = currentId != -1 &&
                prefs.getInt(KEY_LAST_ID, Int.MIN_VALUE) == currentId

            if (isOurOwnComposite && prefs.getInt(KEY_RECIPE_VERSION, -1) == RECIPE_VERSION) {
                return // Already branded this exact photo with the current recipe.
            }

            // The live wallpaper is our own previous composite (not the
            // customer's real photo) whenever its id matches what we set -
            // re-source from the saved original so a recipe change re-brands
            // cleanly instead of stamping the new emblem onto the old one.
            val original = if (isOurOwnComposite && originalFile.exists()) {
                BitmapFactory.decodeFile(originalFile.absolutePath) ?: return
            } else {
                val drawable = wallpaperManager.drawable ?: return
                val fresh = drawableToBitmap(drawable)
                try {
                    context.openFileOutput(ORIGINAL_FILE, Context.MODE_PRIVATE).use {
                        fresh.compress(Bitmap.CompressFormat.PNG, 100, it)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Could not save the original wallpaper", e)
                }
                fresh
            }

            val emblem = BitmapFactory.decodeResource(context.resources, R.drawable.emblem_transparent)
                ?: return

            val branded = compositeEmblem(original, emblem)

            wallpaperManager.setBitmap(branded, null, true, WallpaperManager.FLAG_SYSTEM)
            wallpaperManager.setBitmap(branded, null, true, WallpaperManager.FLAG_LOCK)

            val newId = wallpaperManager.getWallpaperId(WallpaperManager.FLAG_SYSTEM)
            prefs.edit()
                .putInt(KEY_LAST_ID, newId)
                .putInt(KEY_RECIPE_VERSION, RECIPE_VERSION)
                .apply()
        } catch (e: Exception) {
            Log.w(TAG, "Could not brand the wallpaper", e)
        }
    }

    /**
     * WallpaperManager.getDrawable() hands back a built-in placeholder instead of
     * the customer's actual wallpaper unless the caller holds a storage-read
     * permission - a long-standing, largely undocumented privacy restriction.
     * Neither permission is ever prompted for; a Device Owner can grant either
     * silently, which is the only reason declaring them in the manifest is safe
     * here (no user-facing runtime prompt ever appears).
     */
    private fun grantWallpaperReadPermission(context: Context, dpm: DevicePolicyManager) {
        val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)
        val permission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_IMAGES
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
        try {
            dpm.setPermissionGrantState(
                admin,
                context.packageName,
                permission,
                DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED
            )
        } catch (e: Exception) {
            Log.w(TAG, "Could not grant $permission", e)
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

    /** Emblem sized to well under half the screen width, centered
     * horizontally, anchored in the upper third rather than filling it. */
    private fun compositeEmblem(background: Bitmap, emblem: Bitmap): Bitmap {
        val result = background.copy(Bitmap.Config.ARGB_8888, true) ?: return background
        val canvas = Canvas(result)

        val targetWidth = result.width * 0.42f
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
