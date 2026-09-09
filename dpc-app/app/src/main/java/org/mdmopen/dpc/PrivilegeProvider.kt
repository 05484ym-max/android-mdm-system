package org.mdmopen.dpc

/**
 * Privilege source is intentionally separate from OEM behavior. A Samsung,
 * Xiaomi or Qin device can reach different privilege states depending on how
 * it was provisioned; the OEM adapter must never imply privileges by itself.
 */
enum class PrivilegeProviderType {
    NONE,
    ACCESSIBILITY_ADMIN,
    DEVICE_OWNER,
    ROOT_SYSTEMLESS,
    PRIV_APP,
}

data class PrivilegeProviderSelection(
    val type: PrivilegeProviderType,
    val verified: Boolean,
    val capabilities: Set<DeviceCapability>,
)

object PrivilegeProviderResolver {
    fun resolve(profile: DeviceProfile): PrivilegeProviderSelection {
        val capabilities = profile.capabilities

        val type = when {
            DeviceCapability.PRIV_APP in capabilities -> PrivilegeProviderType.PRIV_APP
            DeviceCapability.DEVICE_OWNER in capabilities -> PrivilegeProviderType.DEVICE_OWNER
            DeviceCapability.ROOT in capabilities -> PrivilegeProviderType.ROOT_SYSTEMLESS
            DeviceCapability.DEVICE_ADMIN in capabilities ||
                DeviceCapability.ACCESSIBILITY in capabilities -> PrivilegeProviderType.ACCESSIBILITY_ADMIN
            else -> PrivilegeProviderType.NONE
        }

        // ROOT is only an observed root capability, not proof that our app has
        // already been installed systemlessly. Therefore ROOT_SYSTEMLESS is a
        // candidate provider, not a verified enforcement state.
        val verified = when (type) {
            PrivilegeProviderType.PRIV_APP -> DeviceCapability.PRIV_APP in capabilities
            PrivilegeProviderType.DEVICE_OWNER -> DeviceCapability.DEVICE_OWNER in capabilities
            PrivilegeProviderType.ACCESSIBILITY_ADMIN ->
                DeviceCapability.DEVICE_ADMIN in capabilities ||
                    DeviceCapability.ACCESSIBILITY in capabilities
            PrivilegeProviderType.ROOT_SYSTEMLESS -> false
            PrivilegeProviderType.NONE -> true
        }

        return PrivilegeProviderSelection(
            type = type,
            verified = verified,
            capabilities = capabilities,
        )
    }
}
