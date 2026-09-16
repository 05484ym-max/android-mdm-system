package org.mdmopen.dpc

import android.os.Build

/**
 * Runtime Android compatibility policy for one APK across Android 10+.
 *
 * Keep version branching centralized so provisioning/security behavior can evolve
 * without shipping a different APK or QR code per Android release.
 */
object AndroidCompatibility {
    enum class Family {
        ANDROID_10_11,
        ANDROID_12_14,
        ANDROID_15,
        ANDROID_16_PLUS,
    }

    fun family(sdk: Int = Build.VERSION.SDK_INT): Family = when {
        sdk >= 36 -> Family.ANDROID_16_PLUS
        sdk >= 35 -> Family.ANDROID_15
        sdk >= 31 -> Family.ANDROID_12_14
        else -> Family.ANDROID_10_11
    }

    /** Android 12+ setup wizard drives the explicit mode/compliance callbacks. */
    fun usesModernProvisioningCallbacks(sdk: Int = Build.VERSION.SDK_INT): Boolean = sdk >= 31

    /** Android 10/11 finish through the legacy provisioning-complete broadcast path. */
    fun usesLegacyProvisioningCompletion(sdk: Int = Build.VERSION.SDK_INT): Boolean = sdk < 31

    fun label(sdk: Int = Build.VERSION.SDK_INT): String = when (family(sdk)) {
        Family.ANDROID_10_11 -> "android10-11"
        Family.ANDROID_12_14 -> "android12-14"
        Family.ANDROID_15 -> "android15"
        Family.ANDROID_16_PLUS -> "android16+"
    }
}
