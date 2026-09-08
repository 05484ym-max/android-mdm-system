package org.mdmopen.dpc

import org.junit.Assert.assertEquals
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

    @Test
    fun matcher_recognizes_hebrew_and_english_sections() {
        assertTrue(WhatsAppGuardTerms.isStatus("סטטוס", null))
        assertTrue(WhatsAppGuardTerms.isStatus("Status", null))
        assertTrue(WhatsAppGuardTerms.isChannel("ערוצים", null))
        assertTrue(WhatsAppGuardTerms.isChannel("Channels", null))
        assertTrue(WhatsAppGuardTerms.isUpdates("עדכונים", null))
        assertTrue(WhatsAppGuardTerms.isUpdates("Updates", null))
    }

    @Test
    fun matcher_uses_view_ids_as_language_independent_fallback() {
        assertTrue(WhatsAppGuardTerms.isStatus(null, "com.whatsapp:id/status_list"))
        assertTrue(WhatsAppGuardTerms.isChannel(null, "com.whatsapp:id/channel_header"))
        assertTrue(WhatsAppGuardTerms.isUpdates(null, "com.whatsapp:id/status_tab"))
    }

    @Test
    fun matcher_does_not_confuse_unrelated_content() {
        assertFalse(WhatsAppGuardTerms.isStatus("צ'אטים", "com.whatsapp:id/chat_list"))
        assertFalse(WhatsAppGuardTerms.isChannel("הגדרות", "com.whatsapp:id/settings"))
        assertFalse(WhatsAppGuardTerms.isUpdates("שיחה חדשה", "com.whatsapp:id/new_chat"))
    }

    @Test
    fun guard_decision_allows_only_first_time_setup_to_remain_open() {
        assertEquals(
            WhatsAppGuardDecision.FIRST_SETUP_PENDING,
            WhatsAppGuardProtection.decide(policyEnabled = true, accessibilityEnabled = false, wasProtected = false),
        )
        assertEquals(
            WhatsAppGuardDecision.ACCESSIBILITY_LOST_BLOCK,
            WhatsAppGuardProtection.decide(policyEnabled = true, accessibilityEnabled = false, wasProtected = true),
        )
    }

    @Test
    fun guard_decision_protected_and_admin_disabled_paths_are_explicit() {
        assertEquals(
            WhatsAppGuardDecision.PROTECTED,
            WhatsAppGuardProtection.decide(policyEnabled = true, accessibilityEnabled = true, wasProtected = true),
        )
        assertEquals(
            WhatsAppGuardDecision.DISABLED,
            WhatsAppGuardProtection.decide(policyEnabled = false, accessibilityEnabled = false, wasProtected = true),
        )
    }
}
