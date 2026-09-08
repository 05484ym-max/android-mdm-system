package org.mdmopen.dpc

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WhatsAppGuardTextPolicyTest {
    @Test
    fun enabled_is_false_when_all_switches_are_off() {
        assertFalse(WhatsAppGuardPolicy().enabled)
    }

    @Test
    fun enabled_is_true_for_each_individual_guard() {
        assertTrue(WhatsAppGuardPolicy(blockStatuses = true).enabled)
        assertTrue(WhatsAppGuardPolicy(blockChannels = true).enabled)
        assertTrue(WhatsAppGuardPolicy(hideProfilePhotos = true).enabled)
    }

    @Test
    fun statuses_and_channels_can_be_enabled_independently() {
        val statusesOnly = WhatsAppGuardPolicy(blockStatuses = true, blockChannels = false)
        val channelsOnly = WhatsAppGuardPolicy(blockStatuses = false, blockChannels = true)
        assertTrue(statusesOnly.blockStatuses)
        assertFalse(statusesOnly.blockChannels)
        assertFalse(channelsOnly.blockStatuses)
        assertTrue(channelsOnly.blockChannels)
    }
}
