package org.mdmopen.dpc

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppAccessDecisionTest {
    private val own = "org.mdmopen.dpc"
    private val essential = setOf("com.android.settings", "com.sec.android.app.launcher")

    @Test
    fun approvedOnlyBlocksAnythingNotApproved() {
        assertFalse(
            AppAccessDecision.shouldBlock(
                "com.example.allowed",
                AppAccessMode.APPROVED_ONLY,
                setOf("com.example.allowed"),
                emptySet(),
                essential,
                own,
            ),
        )
        assertTrue(
            AppAccessDecision.shouldBlock(
                "com.example.other",
                AppAccessMode.APPROVED_ONLY,
                setOf("com.example.allowed"),
                emptySet(),
                essential,
                own,
            ),
        )
    }

    @Test
    fun openModeBlocksOnlyBlacklist() {
        assertTrue(
            AppAccessDecision.shouldBlock(
                "com.example.blocked",
                AppAccessMode.OPEN_WITH_BLACKLIST,
                emptySet(),
                setOf("com.example.blocked"),
                essential,
                own,
            ),
        )
        assertFalse(
            AppAccessDecision.shouldBlock(
                "com.example.free",
                AppAccessMode.OPEN_WITH_BLACKLIST,
                emptySet(),
                setOf("com.example.blocked"),
                essential,
                own,
            ),
        )
    }

    @Test
    fun criticalPackagesCanNeverBeBlacklisted() {
        for (pkg in essential + own) {
            assertFalse(
                AppAccessDecision.shouldBlock(
                    pkg,
                    AppAccessMode.OPEN_WITH_BLACKLIST,
                    emptySet(),
                    essential + pkg,
                    essential,
                    own,
                ),
            )
        }
    }
}
