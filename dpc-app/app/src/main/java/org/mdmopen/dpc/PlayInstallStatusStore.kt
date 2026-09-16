package org.mdmopen.dpc

import android.content.Context

enum class PlayInstallStage(val hebrewLabel: String, val terminal: Boolean = false) {
    PREPARING("מכין התקנה"),
    OPENING("פותח הורדה"),
    WAITING("מוריד ומתקין"),
    INSTALLING("מתקין"),
    COMPLETED("הושלם", terminal = true),
    FAILED("נכשל", terminal = true),
}

data class PlayInstallUiSnapshot(
    val sessionId: String,
    val packageName: String,
    val displayName: String,
    val stage: PlayInstallStage,
    val message: String?,
    val updatedAt: Long,
)

object PlayInstallStatusStore {
    private const val PREFS = "dpc_play_install_status"
    private const val KEY_SESSION_ID = "session_id"
    private const val KEY_PACKAGE = "package"
    private const val KEY_DISPLAY_NAME = "display_name"
    private const val KEY_STAGE = "stage"
    private const val KEY_MESSAGE = "message"
    private const val KEY_UPDATED_AT = "updated_at"

    @Synchronized
    fun begin(context: Context, sessionId: String, packageName: String, displayName: String) {
        val ok = prefs(context).edit()
            .putString(KEY_SESSION_ID, sessionId)
            .putString(KEY_PACKAGE, packageName)
            .putString(KEY_DISPLAY_NAME, displayName)
            .putString(KEY_STAGE, PlayInstallStage.PREPARING.name)
            .remove(KEY_MESSAGE)
            .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
            .commit()
        check(ok) { "Could not persist Play install UI state" }
    }

    @Synchronized
    fun update(context: Context, sessionId: String, stage: PlayInstallStage, message: String? = null): Boolean {
        val current = snapshot(context) ?: return false
        if (current.sessionId != sessionId || current.stage.terminal) return false
        val editor = prefs(context).edit()
            .putString(KEY_STAGE, stage.name)
            .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
        if (message == null) editor.remove(KEY_MESSAGE) else editor.putString(KEY_MESSAGE, message)
        return editor.commit()
    }

    fun snapshot(context: Context): PlayInstallUiSnapshot? {
        val p = prefs(context)
        val sessionId = p.getString(KEY_SESSION_ID, null) ?: return null
        val packageName = p.getString(KEY_PACKAGE, null)?.takeIf { it.isNotBlank() } ?: return null
        val displayName = p.getString(KEY_DISPLAY_NAME, null)?.takeIf { it.isNotBlank() } ?: packageName
        val stage = runCatching { PlayInstallStage.valueOf(p.getString(KEY_STAGE, PlayInstallStage.PREPARING.name)!!) }
            .getOrDefault(PlayInstallStage.FAILED)
        return PlayInstallUiSnapshot(sessionId, packageName, displayName, stage, p.getString(KEY_MESSAGE, null), p.getLong(KEY_UPDATED_AT, 0L))
    }

    @Synchronized
    fun clear(context: Context, sessionId: String? = null): Boolean {
        val p = prefs(context)
        if (sessionId != null && p.getString(KEY_SESSION_ID, null) != sessionId) return false
        return p.edit().clear().commit()
    }

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
