package org.mdmopen.dpc

import android.content.Context
import android.content.res.Configuration
import android.graphics.Rect
import kotlin.math.max
import kotlin.math.min

enum class WhatsAppMaskTarget(val storageKey: String) {
    CHAT_LIST("chat_list"),
    CONTACT_PICKER("contact_picker"),
    CHAT_HEADER("chat_header"),
    CONTACT_INFO("contact_info"),
}

data class NormalizedMaskRect(
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float,
) {
    fun normalized(): NormalizedMaskRect {
        val cl = left.coerceIn(0f, 1f)
        val ct = top.coerceIn(0f, 1f)
        val cr = right.coerceIn(0f, 1f)
        val cb = bottom.coerceIn(0f, 1f)
        return NormalizedMaskRect(min(cl, cr), min(ct, cb), max(cl, cr), max(ct, cb))
    }

    fun isUsable(): Boolean = right - left >= 0.02f && bottom - top >= 0.02f

    fun toScreenRect(screen: Rect): Rect {
        val n = normalized()
        return Rect(
            screen.left + (screen.width() * n.left).toInt(),
            screen.top + (screen.height() * n.top).toInt(),
            screen.left + (screen.width() * n.right).toInt(),
            screen.top + (screen.height() * n.bottom).toInt(),
        )
    }
}

object WhatsAppMaskCalibrationStore {
    private const val PREFS = "whatsapp_mask_calibration_v1"

    fun targetFor(screen: WhatsAppScreen): WhatsAppMaskTarget? = when (screen) {
        WhatsAppScreen.CHAT_LIST -> WhatsAppMaskTarget.CHAT_LIST
        WhatsAppScreen.CONTACT_PICKER -> WhatsAppMaskTarget.CONTACT_PICKER
        WhatsAppScreen.CHAT -> WhatsAppMaskTarget.CHAT_HEADER
        WhatsAppScreen.CONTACT_INFO -> WhatsAppMaskTarget.CONTACT_INFO
        WhatsAppScreen.UPDATES,
        WhatsAppScreen.UNKNOWN -> null
    }

    fun get(context: Context, target: WhatsAppMaskTarget): NormalizedMaskRect? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val prefix = keyPrefix(context, target)
        if (!prefs.getBoolean("${prefix}_enabled", false)) return null
        val rect = NormalizedMaskRect(
            prefs.getFloat("${prefix}_left", 0f),
            prefs.getFloat("${prefix}_top", 0f),
            prefs.getFloat("${prefix}_right", 0f),
            prefs.getFloat("${prefix}_bottom", 0f),
        ).normalized()
        return rect.takeIf(NormalizedMaskRect::isUsable)
    }

    fun save(context: Context, target: WhatsAppMaskTarget, rect: NormalizedMaskRect) {
        val n = rect.normalized()
        if (!n.isUsable()) return
        val prefix = keyPrefix(context, target)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("${prefix}_enabled", true)
            .putFloat("${prefix}_left", n.left)
            .putFloat("${prefix}_top", n.top)
            .putFloat("${prefix}_right", n.right)
            .putFloat("${prefix}_bottom", n.bottom)
            .apply()
    }

    fun clear(context: Context, target: WhatsAppMaskTarget) {
        val prefix = keyPrefix(context, target)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove("${prefix}_enabled")
            .remove("${prefix}_left")
            .remove("${prefix}_top")
            .remove("${prefix}_right")
            .remove("${prefix}_bottom")
            .apply()
    }

    fun defaultRect(target: WhatsAppMaskTarget): NormalizedMaskRect = when (target) {
        WhatsAppMaskTarget.CHAT_LIST -> NormalizedMaskRect(0.82f, 0.10f, 0.985f, 0.92f)
        WhatsAppMaskTarget.CONTACT_PICKER -> NormalizedMaskRect(0.82f, 0.13f, 0.985f, 0.91f)
        WhatsAppMaskTarget.CHAT_HEADER -> NormalizedMaskRect(0.78f, 0.02f, 0.96f, 0.14f)
        WhatsAppMaskTarget.CONTACT_INFO -> NormalizedMaskRect(0.24f, 0.07f, 0.76f, 0.35f)
    }

    private fun keyPrefix(context: Context, target: WhatsAppMaskTarget): String {
        val orientation = if (context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) {
            "landscape"
        } else {
            "portrait"
        }
        return "${target.storageKey}_$orientation"
    }
}
