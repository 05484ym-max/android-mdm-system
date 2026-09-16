package org.mdmopen.dpc

import android.content.Context
import java.util.UUID

/**
 * Persists the one package that is allowed to be newly installed while the
 * temporarily-revealed Google Play window is open.
 *
 * The global Android install restriction has to be lifted briefly for Play to
 * install anything. This guard closes that gap by giving the Play window a
 * single package-scoped session. PackageInstallGuardReceiver observes newly
 * added packages and immediately quarantines anything that is not this target.
 */
object PlayInstallGuard {
    private const val PREFS = "dpc_play_install_guard"
    private const val KEY_SESSION_ID = "session_id"
    private const val KEY_TARGET_PACKAGE = "target_package"
    private const val KEY_EXPIRES_AT = "expires_at"

    data class Session(
        val id: String,
        val targetPackage: String,
        val expiresAt: Long,
    )

    @Synchronized
    fun begin(context: Context, targetPackage: String, expiresAt: Long): Session {
        val current = activeSession(context)
        check(current == null) { "A Google Play install session is already active" }

        val session = Session(UUID.randomUUID().toString(), targetPackage, expiresAt)
        val persisted = prefs(context).edit()
            .putString(KEY_SESSION_ID, session.id)
            .putString(KEY_TARGET_PACKAGE, session.targetPackage)
            .putLong(KEY_EXPIRES_AT, session.expiresAt)
            .commit()
        check(persisted) { "Could not persist Google Play install guard" }
        return session
    }

    fun activeSession(context: Context): Session? {
        val p = prefs(context)
        val id = p.getString(KEY_SESSION_ID, null) ?: return null
        val target = p.getString(KEY_TARGET_PACKAGE, null)?.takeIf { it.isNotBlank() } ?: return null
        val expiresAt = p.getLong(KEY_EXPIRES_AT, 0L)
        if (expiresAt <= System.currentTimeMillis()) {
            clear(context, id)
            return null
        }
        return Session(id, target, expiresAt)
    }

    fun isActive(context: Context, sessionId: String): Boolean =
        activeSession(context)?.id == sessionId

    @Synchronized
    fun finish(context: Context, sessionId: String): Boolean {
        val current = activeSession(context) ?: return false
        if (current.id != sessionId) return false
        return clear(context, sessionId)
    }

    @Synchronized
    fun abortCurrent(context: Context): Session? {
        val current = activeSession(context) ?: return null
        return if (clear(context, current.id)) current else null
    }

    @Synchronized
    fun clear(context: Context, sessionId: String): Boolean {
        val p = prefs(context)
        if (p.getString(KEY_SESSION_ID, null) != sessionId) return false
        return p.edit()
            .remove(KEY_SESSION_ID)
            .remove(KEY_TARGET_PACKAGE)
            .remove(KEY_EXPIRES_AT)
            .commit()
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
