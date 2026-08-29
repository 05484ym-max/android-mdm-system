package org.mdmopen.dpc

import android.Manifest
import android.app.WallpaperManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
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
    // (see wallpaperReadPermissionGranted below), which would have silently
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

    /**
     * Returns a short, human-readable outcome so the customer's own sync
     * toast can show it - there's no way to pull logcat off a customer's
     * phone, so this is the only diagnostic signal available in practice.
     */
    fun apply(context: Context): String {
        try {
            val dpm = context.getSystemService(DevicePolicyManager::class.java)
            if (!dpm.isDeviceOwnerApp(context.packageName)) return "לא Device Owner"

            // WallpaperManager silently hands back a built-in placeholder
            // instead of throwing when read access isn't actually there -
            // branding that placeholder would overwrite the customer's real
            // photo with it. Never proceed without confirming the grant
            // really took effect, rather than hoping it did.
            if (!wallpaperReadPermissionGranted(context, dpm)) return "אין הרשאת קריאת רקע"

            val wallpaperManager = WallpaperManager.getInstance(context)
            val currentId = wallpaperManager.getWallpaperId(WallpaperManager.FLAG_SYSTEM)
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val originalFile = File(context.filesDir, ORIGINAL_FILE)

            val isOurOwnComposite = currentId != -1 &&
                prefs.getInt(KEY_LAST_ID, Int.MIN_VALUE) == currentId

            if (isOurOwnComposite && prefs.getInt(KEY_RECIPE_VERSION, -1) == RECIPE_VERSION) {
                return "כבר מעודכן" // Already branded this exact photo with the current recipe.
            }

            // The live wallpaper is our own previous composite (not the
            // customer's real photo) whenever its id matches what we set -
            // re-source from the saved original so a recipe change re-brands
            // cleanly instead of stamping the new emblem onto the old one.
            val original = if (isOurOwnComposite && originalFile.exists()) {
                BitmapFactory.decodeFile(originalFile.absolutePath)
                    ?: return "שגיאה: לא ניתן לקרוא את הרקע השמור"
            } else {
                val drawable = wallpaperManager.drawable ?: return "שגיאה: אין ציור רקע"
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
                ?: return "שגיאה: קובץ הסמל חסר"

            val branded = compositeEmblem(original, emblem)

            wallpaperManager.setBitmap(branded, null, true, WallpaperManager.FLAG_SYSTEM)
            wallpaperManager.setBitmap(branded, null, true, WallpaperManager.FLAG_LOCK)

            val newId = wallpaperManager.getWallpaperId(WallpaperManager.FLAG_SYSTEM)
            prefs.edit()
                .putInt(KEY_LAST_ID, newId)
                .putInt(KEY_RECIPE_VERSION, RECIPE_VERSION)
                .apply()
            return "עודכן בהצלחה"
        } catch (e: Exception) {
            Log.w(TAG, "Could not brand the wallpaper", e)
            return "שגיאה: ${e.message}"
        }
    }

    /**
     * WallpaperManager.getDrawable() hands back a built-in placeholder instead of
     * the customer's actual wallpaper unless the caller holds a storage-read
     * permission - a long-standing, largely undocumented privacy restriction that
     * predates Android 13's split of READ_EXTERNAL_STORAGE into granular media
     * permissions. WallpaperManager's internal check is old framework code that
     * may still specifically look for READ_EXTERNAL_STORAGE regardless of target
     * SDK, so that one is always requested - READ_MEDIA_IMAGES is requested too
     * on 33+ in case a newer OS build does check it instead. Neither is ever
     * prompted for; a Device Owner can grant either silently. setPermissionGrantState()
     * can fail without throwing (wrong protection level, OEM policy, app state),
     * so each grant's actual resulting state gets checked instead of assumed.
     */
    private fun wallpaperReadPermissionGranted(context: Context, dpm: DevicePolicyManager): Boolean {
        val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)
        val permissions = mutableListOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions += Manifest.permission.READ_MEDIA_IMAGES
        }

        var anyGranted = false
        for (permission in permissions) {
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
            val granted = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
            if (!granted) Log.w(TAG, "$permission still not granted after requesting it")
            anyGranted = anyGranted || granted
        }
        if (!anyGranted) Log.w(TAG, "No storage-read permission granted - skipping wallpaper branding")
        return anyGranted
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
