package org.mdmopen.dpc

import android.content.Context

data class AdapterSelection(
    val adapterId: String,
    val confidence: Int,
    val profile: DeviceProfile,
)

/**
 * OEM-specific behavior lives behind this interface. Core policy code must not
 * branch directly on manufacturer/model names.
 */
interface DeviceAdapter {
    val id: String
    fun matches(profile: DeviceProfile): Boolean
    fun confidence(profile: DeviceProfile): Int

    /**
     * Human-readable setup hints for the technician/customer. No privileged
     * action is implied by these strings; enforcement still depends on verified
     * runtime capabilities.
     */
    fun setupHints(context: Context, profile: DeviceProfile): List<String> = emptyList()
}

object DeviceAdapterResolver {
    private val adapters: List<DeviceAdapter> = listOf(
        Qin3UltraAdapter,
        QinF22ProAdapter,
        QinF21ProAdapter,
        QinGenericAdapter,
        SamsungOneUiAdapter,
        XiaomiHyperOsAdapter,
        XiaomiMiuiAdapter,
        GenericAospAdapter,
    )

    fun resolve(profile: DeviceProfile): AdapterSelection {
        val selected = adapters
            .asSequence()
            .filter { it.matches(profile) }
            .map { it to it.confidence(profile).coerceIn(0, 100) }
            .maxByOrNull { it.second }
            ?: (GenericAospAdapter to 10)

        return AdapterSelection(
            adapterId = selected.first.id,
            confidence = selected.second,
            profile = profile,
        )
    }
}

object SamsungOneUiAdapter : DeviceAdapter {
    override val id = "samsung.oneui"
    override fun matches(profile: DeviceProfile) = profile.oemSkin == "samsung_oneui"
    override fun confidence(profile: DeviceProfile) = if (matches(profile)) 95 else 0

    override fun setupHints(context: Context, profile: DeviceProfile) = listOf(
        "Verify default Home app",
        "Verify Accessibility remains enabled after reboot",
        "Verify battery/background restrictions for this One UI version",
    )
}

object XiaomiHyperOsAdapter : DeviceAdapter {
    override val id = "xiaomi.hyperos"
    override fun matches(profile: DeviceProfile) = profile.oemSkin == "xiaomi_hyperos"
    override fun confidence(profile: DeviceProfile) = if (matches(profile)) 95 else 0

    override fun setupHints(context: Context, profile: DeviceProfile) = listOf(
        "Verify Autostart permission",
        "Verify battery mode is not killing the protection service",
        "Verify default Home app and Accessibility after reboot",
    )
}

object XiaomiMiuiAdapter : DeviceAdapter {
    override val id = "xiaomi.miui"
    override fun matches(profile: DeviceProfile) = profile.oemSkin == "xiaomi_miui"
    override fun confidence(profile: DeviceProfile) = if (matches(profile)) 94 else 0

    override fun setupHints(context: Context, profile: DeviceProfile) = listOf(
        "Verify Autostart permission",
        "Verify battery mode is not killing the protection service",
        "Verify default Home app and Accessibility after reboot",
    )
}

object QinF21ProAdapter : DeviceAdapter {
    override val id = "qin.f21pro"
    override fun matches(profile: DeviceProfile) = profile.oemSkin == "qin_f21pro"
    override fun confidence(profile: DeviceProfile) = if (matches(profile)) 99 else 0

    override fun setupHints(context: Context, profile: DeviceProfile) = listOf(
        "Record exact build fingerprint/firmware variant before enabling stronger modes",
        "Verify Google services/FCM availability",
        "Never assume root or unlocked bootloader solely from model name",
    )
}

object QinF22ProAdapter : DeviceAdapter {
    override val id = "qin.f22pro"
    override fun matches(profile: DeviceProfile) = profile.oemSkin == "qin_f22pro"
    override fun confidence(profile: DeviceProfile) = if (matches(profile)) 99 else 0

    override fun setupHints(context: Context, profile: DeviceProfile) = listOf(
        "Record exact build fingerprint/firmware variant before enabling stronger modes",
        "Verify Google services/FCM availability",
        "Never assume root or unlocked bootloader solely from model name",
    )
}

object Qin3UltraAdapter : DeviceAdapter {
    override val id = "qin.3ultra"
    override fun matches(profile: DeviceProfile) = profile.oemSkin == "qin_3_ultra"
    override fun confidence(profile: DeviceProfile) = if (matches(profile)) 99 else 0

    override fun setupHints(context: Context, profile: DeviceProfile) = listOf(
        "Record exact stock/custom firmware build before any stronger provisioning",
        "Verify Google services/FCM availability on this firmware variant",
        "Treat bootloader/root/GSI capability as runtime facts, never model defaults",
        "Qin 3 Ultra uses dynamic partitions on known builds; never perform blind partition operations",
    )
}

object QinGenericAdapter : DeviceAdapter {
    override val id = "qin.generic"
    override fun matches(profile: DeviceProfile) = profile.oemSkin == "qin_generic"
    override fun confidence(profile: DeviceProfile) = if (matches(profile)) 80 else 0

    override fun setupHints(context: Context, profile: DeviceProfile) = listOf(
        "Unknown Qin variant: collect build/model/device/product before model-specific provisioning",
        "Use only verified Launcher/Accessibility/Device Admin capabilities until identified",
    )
}

object GenericAospAdapter : DeviceAdapter {
    override val id = "aosp.generic"
    override fun matches(profile: DeviceProfile) = true
    override fun confidence(profile: DeviceProfile) = 10
}
