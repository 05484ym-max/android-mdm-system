package org.mdmopen.dpc

/**
 * In-memory-only proof that MainActivity's admin screen was reached through
 * CustomerActivity's own PIN check (or initial PIN setup), not through an
 * externally supplied Intent extra. Nothing outside this process can set or
 * forge this - unlike a boolean Intent extra, which any caller holding the
 * component name (Launcher, adb, another app) can set regardless of
 * MainActivity's android:exported value.
 */
object AdminAccess {
    @Volatile
    private var granted = false

    fun grant() {
        granted = true
    }

    /** Single-use: reading it immediately revokes it again. */
    fun consume(): Boolean {
        val result = granted
        granted = false
        return result
    }
}
