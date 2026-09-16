package org.mdmopen.dpc

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayInstallStageTest {
    @Test
    fun onlyTerminalStatesEndBlockingUi() {
        assertFalse(PlayInstallStage.PREPARING.terminal)
        assertFalse(PlayInstallStage.OPENING.terminal)
        assertFalse(PlayInstallStage.WAITING.terminal)
        assertFalse(PlayInstallStage.INSTALLING.terminal)
        assertTrue(PlayInstallStage.COMPLETED.terminal)
        assertTrue(PlayInstallStage.FAILED.terminal)
    }

    @Test
    fun customerStatusesAreExplicitAndDoNotInventPercentages() {
        assertEquals("מכין התקנה", PlayInstallStage.PREPARING.hebrewLabel)
        assertEquals("פותח הורדה", PlayInstallStage.OPENING.hebrewLabel)
        assertEquals("מוריד ומתקין", PlayInstallStage.WAITING.hebrewLabel)
        assertEquals("מתקין", PlayInstallStage.INSTALLING.hebrewLabel)
        assertEquals("הושלם", PlayInstallStage.COMPLETED.hebrewLabel)
        assertEquals("נכשל", PlayInstallStage.FAILED.hebrewLabel)
    }
}
