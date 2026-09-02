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
    private const val KEY_LAST_ID = "last_branded_wallpaper_id" // legacy v8/v9
    private const val KEY_LAST_HOME_ID = "last_branded_home_wallpaper_id"
    private const val KEY_LAST_LOCK_ID = "last_branded_lock_wallpaper_id"
    private const val KEY_RECIPE_VERSION = "recipe_version"
    private const val ORIGINAL_FILE = "wallpaper_original.png" // legacy original
    private const val ORIGINAL_HOME_FILE = "wallpaper_original_home.png"
    private const val ORIGINAL_LOCK_FILE = "wallpaper_original_lock.png"

    // Bump this whenever compositeEmblem()'s sizing or the emblem asset
    // itself changes, so a device already branded under an older recipe
    // gets one clean re-composite from the saved original instead of never
    // updating (same id forever looks "already done") or stamping the new
    // emblem onto its own previous output (see apply() below).
    // v4: emblem_transparent.png redone - removed a stray gray arc artifact
    // left over from a previous crop, smoothed the jagged/aliased edges
    // (premultiplied-alpha blur, so no garbage color could leak through),
    // and shipped at a higher native resolution so on-device compositing
    // downsamples instead of upsampling from the old small source.
    // v5: replaced emblem_transparent.png with a higher-quality 3D metallic
    // gold render supplied directly (not re-extracted from the launcher
    // icon), matching the same content/layout at native ~1167px resolution.
    // v6: shrunk from 42% to 30% of screen width per customer feedback (too
    // big); also switched the branding-state write from apply() to commit()
    // (see below) to fix a real re-branding-every-sync bug, not a sizing one.
    // v7: emblem now drawn at ~43% opacity (watermark-level) instead of
    // solid, so it doesn't visually compete with the customer's own photo.
    // v8: setBitmap() for FLAG_SYSTEM and FLAG_LOCK combined into one call.
    // v9 attempted a generated fallback when the current wallpaper could not
    // be read. That could replace the customer's chosen wallpaper, which is
    // not acceptable.
    // v10 keeps the exact same emblem size/position/opacity, reads the real
    // wallpaper through getWallpaperFile() first (Samsung-friendly), keeps
    // home and lock originals separate, and never invents/replaces a
    // customer's wallpaper just to force the watermark.
    // v11 forces one clean re-apply after the diagnostic builds and verifies
    // that compositing actually changes visible pixels before WallpaperManager
    // is called. Design parameters are intentionally unchanged.
    private const val RECIPE_VERSION = 11

    /**
     * Returns a short, human-readable outcome so the customer's own sync
     * toast can show it - there's no way to pull logcat off a customer's
     * phone, so this is the only diagnostic signal available in practice.
     */
    fun apply(context: Context): String {
        try {
            val dpm = context.getSystemService(DevicePolicyManager::class.java)
            if (!dpm.isDeviceOwnerApp(context.packageName)) return "DO=לא"

            val wm = WallpaperManager.getInstance(context)
            val supported = wm.isWallpaperSupported
            val allowedToSet = wm.isSetWallpaperAllowed
            if (!supported || !allowedToSet) {
                return "Android ${Build.VERSION.RELEASE} · supported=$supported · setAllowed=$allowedToSet"
            }

            val canReadDrawable = wallpaperReadPermissionGranted(context, dpm)
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

            val beforeHomeId = wm.getWallpaperId(WallpaperManager.FLAG_SYSTEM)
            val beforeLockId = wm.getWallpaperId(WallpaperManager.FLAG_LOCK)

            val homeAlreadyBranded = beforeHomeId != -1 &&
                prefs.getInt(KEY_LAST_HOME_ID, prefs.getInt(KEY_LAST_ID, Int.MIN_VALUE)) == beforeHomeId
            val lockAlreadyBranded = beforeLockId != -1 &&
                prefs.getInt(KEY_LAST_LOCK_ID, Int.MIN_VALUE) == beforeLockId
            val sameRecipe = prefs.getInt(KEY_RECIPE_VERSION, -1) == RECIPE_VERSION

            if (homeAlreadyBranded && lockAlreadyBranded && sameRecipe) {
                return "Android ${Build.VERSION.RELEASE} · כבר מעודכן · H=$beforeHomeId L=$beforeLockId"
            }

            val emblem = BitmapFactory.decodeResource(
                context.resources,
                R.drawable.emblem_transparent
            ) ?: return "שגיאה: קובץ הסמל חסר"

            val legacyOriginal = File(context.filesDir, ORIGINAL_FILE)
            val homeOriginalFile = File(context.filesDir, ORIGINAL_HOME_FILE)
            val lockOriginalFile = File(context.filesDir, ORIGINAL_LOCK_FILE)

            var homeSource = "none"
            var lockSource = "none"

            val homeOriginal = when {
                homeAlreadyBranded && homeOriginalFile.exists() -> {
                    homeSource = "saved-home"
                    BitmapFactory.decodeFile(homeOriginalFile.absolutePath)
                }
                homeAlreadyBranded && legacyOriginal.exists() -> {
                    homeSource = "saved-legacy"
                    BitmapFactory.decodeFile(legacyOriginal.absolutePath)
                }
                else -> {
                    val read = readWallpaperBitmap(
                        wm,
                        WallpaperManager.FLAG_SYSTEM,
                        canReadDrawable
                    )
                    homeSource = read.second
                    read.first?.also { saveOriginal(it, homeOriginalFile) }
                }
            } ?: return "Android ${Build.VERSION.RELEASE} · HOME_READ_FAIL · H=$beforeHomeId · perm=$canReadDrawable"

            val lockOriginal = when {
                lockAlreadyBranded && lockOriginalFile.exists() -> {
                    lockSource = "saved-lock"
                    BitmapFactory.decodeFile(lockOriginalFile.absolutePath)
                }
                else -> {
                    val read = readWallpaperBitmap(
                        wm,
                        WallpaperManager.FLAG_LOCK,
                        false
                    )
                    if (read.first != null) {
                        lockSource = read.second
                        read.first!!.also { saveOriginal(it, lockOriginalFile) }
                    } else if (beforeLockId == -1) {
                        lockSource = "shared-home"
                        homeOriginal
                    } else {
                        lockSource = read.second
                        null
                    }
                }
            } ?: return "Android ${Build.VERSION.RELEASE} · LOCK_READ_FAIL · L=$beforeLockId · Hsrc=$homeSource"

            // Do not change design parameters here. compositeEmblem() remains
            // the single source of truth for size, position and opacity.
            val brandedHome = compositeEmblem(homeOriginal, emblem)
            val brandedLock = compositeEmblem(lockOriginal, emblem)

            if (brandedHome.changedPixels == 0 || brandedLock.changedPixels == 0) {
                return "Android ${Build.VERSION.RELEASE} · COMPOSITE_EMPTY H=${brandedHome.changedPixels}/${brandedHome.checkedPixels} L=${brandedLock.changedPixels}/${brandedLock.checkedPixels} · alphaMax=${sampleMaxAlpha(emblem)}"
            }

            wm.setBitmap(brandedHome.bitmap, null, true, WallpaperManager.FLAG_SYSTEM)
            val afterHomeId = wm.getWallpaperId(WallpaperManager.FLAG_SYSTEM)

            wm.setBitmap(brandedLock.bitmap, null, true, WallpaperManager.FLAG_LOCK)
            val afterLockId = wm.getWallpaperId(WallpaperManager.FLAG_LOCK)

            val homeChanged = afterHomeId != -1 && afterHomeId != beforeHomeId
            val lockChanged = afterLockId != -1 && afterLockId != beforeLockId

            if (!homeChanged || !lockChanged) {
                return "Android ${Build.VERSION.RELEASE} · WRITE_FAIL H:$beforeHomeId→$afterHomeId L:$beforeLockId→$afterLockId · src=$homeSource/$lockSource"
            }

            prefs.edit()
                .putInt(KEY_LAST_HOME_ID, afterHomeId)
                .putInt(KEY_LAST_LOCK_ID, afterLockId)
                .putInt(KEY_RECIPE_VERSION, RECIPE_VERSION)
                .commit()

            return "Android ${Build.VERSION.RELEASE} · OK H:$beforeHomeId→$afterHomeId L:$beforeLockId→$afterLockId · src=$homeSource/$lockSource · diff=${brandedHome.changedPixels}/${brandedLock.changedPixels} · alphaMax=${sampleMaxAlpha(emblem)}"
        } catch (e: Exception) {
            Log.w(TAG, "Could not brand the wallpaper", e)
            return "Android ${Build.VERSION.RELEASE} · ${e.javaClass.simpleName}: ${e.message}"
        }
    }

    private fun readWallpaperBitmap(
        wallpaperManager: WallpaperManager,
        flag: Int,
        allowDrawableFallback: Boolean,
    ): Pair<Bitmap?, String> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                wallpaperManager.getWallpaperFile(flag)?.use { pfd ->
                    BitmapFactory.decodeFileDescriptor(pfd.fileDescriptor)?.let {
                        return it to "file"
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not read wallpaper file for flag=$flag", e)
                if (!allowDrawableFallback) return null to e.javaClass.simpleName
            }
        }

        if (flag == WallpaperManager.FLAG_SYSTEM && allowDrawableFallback) {
            try {
                wallpaperManager.drawable?.let { return drawableToBitmap(it) to "drawable" }
            } catch (e: Exception) {
                Log.w(TAG, "Could not read system wallpaper drawable", e)
                return null to e.javaClass.simpleName
            }
        }

        return null to "null"
    }

    private fun saveOriginal(bitmap: Bitmap, file: File) {
        try {
            file.outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not save original wallpaper", e)
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
        if (!anyGranted) Log.w(TAG, "No storage-read permission granted - will try getWallpaperFile() directly")
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

    private data class CompositeResult(
        val bitmap: Bitmap,
        val changedPixels: Int,
        val checkedPixels: Int,
    )

    /** Emblem sized to well under a third of the screen width, centered
     * horizontally, anchored in the upper third rather than filling it. */
    private fun compositeEmblem(background: Bitmap, emblem: Bitmap): CompositeResult {
        val result = background.copy(Bitmap.Config.ARGB_8888, true) ?: background
        val canvas = Canvas(result)

        // DO NOT change these values without explicit customer approval.
        val targetWidth = result.width * 0.30f
        val scale = targetWidth / emblem.width
        val targetHeight = emblem.height * scale

        val left = (result.width - targetWidth) / 2f
        val top = result.height * 0.28f

        val destRect = RectF(left, top, left + targetWidth, top + targetHeight)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        // Watermark-level opacity requested by the customer.
        paint.alpha = 110
        canvas.drawBitmap(emblem, null, destRect, paint)

        // Verify the composition itself, not merely WallpaperManager IDs.
        // This catches a fully-transparent/corrupt emblem or a draw that
        // produced no visible pixel change before we blame Samsung.
        val x = destRect.left.toInt().coerceIn(0, result.width - 1)
        val y = destRect.top.toInt().coerceIn(0, result.height - 1)
        val right = destRect.right.toInt().coerceIn(x + 1, result.width)
        val bottom = destRect.bottom.toInt().coerceIn(y + 1, result.height)
        val width = right - x
        val height = bottom - y
        val count = width * height

        var changed = 0
        if (count > 0) {
            val before = IntArray(count)
            val after = IntArray(count)
            background.getPixels(before, 0, width, x, y, width, height)
            result.getPixels(after, 0, width, x, y, width, height)
            for (i in 0 until count) {
                if (before[i] != after[i]) changed++
            }
        }

        return CompositeResult(result, changed, count)
    }

    private fun sampleMaxAlpha(bitmap: Bitmap): Int {
        if (bitmap.width <= 0 || bitmap.height <= 0) return 0
        val stepX = (bitmap.width / 64).coerceAtLeast(1)
        val stepY = (bitmap.height / 64).coerceAtLeast(1)
        var maxAlpha = 0
        var y = 0
        while (y < bitmap.height) {
            var x = 0
            while (x < bitmap.width) {
                val alpha = android.graphics.Color.alpha(bitmap.getPixel(x, y))
                if (alpha > maxAlpha) maxAlpha = alpha
                if (maxAlpha == 255) return 255
                x += stepX
            }
            y += stepY
        }
        return maxAlpha
    }
}
