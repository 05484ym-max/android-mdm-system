package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings

/**
 * Runtime capability model shared by Device Owner and non-Device-Owner modes.
 *
 * Important: these are observed capabilities, not promises derived only from a
 * device model table. OEM adapters may add guidance/quirks, but policy code must
 * gate privileged actions on these verified facts.
 */
enum class DeviceCapability {
    LAUNCHER,
    DEFAULT_HOME,
    ACCESSIBILITY,
    DEVICE_ADMIN,
    DEVICE_OWNER,
    ROOT,
    PRIV_APP,
}

data class DeviceProfile(
    val manufacturer: String,
    val brand: String,
    val model: String,
    val device: String,
    val product: String,
    val buildDisplay: String,
    val sdkInt: Int,
    val androidRelease: String,
    val oemSkin: String,
    val oemSkinVersion: String?,
    val capabilities: Set<DeviceCapability>,
) {
    fun adapterKey(): String = buildString {
        append(oemSkin.lowercase())
        oemSkinVersion?.takeIf { it.isNotBlank() }?.let {
            append('.')
            append(it.lowercase().replace(' ', '_'))
        }
    }
}

object DeviceCapabilityDetector {

    fun detect(context: Context): DeviceProfile {
        val appContext = context.applicationContext
        val dpm = appContext.getSystemService(DevicePolicyManager::class.java)
        val admin = ComponentName(appContext, DpcDeviceAdminReceiver::class.java)

        val capabilities = linkedSetOf(DeviceCapability.LAUNCHER)

        if (isDefaultHome(appContext)) capabilities += DeviceCapability.DEFAULT_HOME
        if (isAccessibilityEnabled(appContext)) capabilities += DeviceCapability.ACCESSIBILITY
        if (dpm?.isAdminActive(admin) == true) capabilities += DeviceCapability.DEVICE_ADMIN
        if (dpm?.isDeviceOwnerApp(appContext.packageName) == true) capabilities += DeviceCapability.DEVICE_OWNER
        if (hasSuBinary()) capabilities += DeviceCapability.ROOT
        if (isPrivilegedSystemApp(appContext)) capabilities += DeviceCapability.PRIV_APP

        val skin = detectSkin()

        return DeviceProfile(
            manufacturer = Build.MANUFACTURER.orEmpty(),
            brand = Build.BRAND.orEmpty(),
            model = Build.MODEL.orEmpty(),
            device = Build.DEVICE.orEmpty(),
            product = Build.PRODUCT.orEmpty(),
            buildDisplay = Build.DISPLAY.orEmpty(),
            sdkInt = Build.VERSION.SDK_INT,
            androidRelease = Build.VERSION.RELEASE.orEmpty(),
            oemSkin = skin.first,
            oemSkinVersion = skin.second,
            capabilities = capabilities,
        )
    }

    private fun isDefaultHome(context: Context): Boolean {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val resolved = context.packageManager.resolveActivity(intent, 0)
        return resolved?.activityInfo?.packageName == context.packageName
    }

    private fun isAccessibilityEnabled(context: Context): Boolean {
        if (Settings.Secure.getInt(
                context.contentResolver,
                Settings.Secure.ACCESSIBILITY_ENABLED,
                0,
            ) != 1
        ) return false

        val expected = ComponentName(context, WhatsAppGuardService::class.java)
            .flattenToString()
            .lowercase()

        val enabled = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ).orEmpty().lowercase()

        return enabled.split(':').any { it == expected }
    }

    private fun hasSuBinary(): Boolean {
        val candidates = arrayOf(
            "/system/bin/su",
            "/system/xbin/su",
            "/sbin/su",
            "/su/bin/su",
            "/data/adb/magisk",
        )
        return candidates.any { java.io.File(it).exists() }
    }

    private fun isPrivilegedSystemApp(context: Context): Boolean {
        val appInfo = context.applicationInfo
        val source = appInfo.sourceDir.orEmpty()
        return source.startsWith("/system/priv-app/") ||
            source.startsWith("/product/priv-app/") ||
            source.startsWith("/system_ext/priv-app/")
    }

    /**
     * Reads public build identity first and only uses getprop as a best-effort
     * OEM hint. A missing/blocked property must never break enrollment.
     */
    private fun detectSkin(): Pair<String, String?> {
        val identity = OemIdentityClassifier.Identity(
            manufacturer = Build.MANUFACTURER.orEmpty(),
            brand = Build.BRAND.orEmpty(),
            model = Build.MODEL.orEmpty(),
            device = Build.DEVICE.orEmpty(),
            product = Build.PRODUCT.orEmpty(),
            buildDisplay = Build.DISPLAY.orEmpty(),
            androidRelease = Build.VERSION.RELEASE.orEmpty(),
        )

        val oneUi = getProp("ro.build.version.oneui")
            ?: getProp("ro.build.version.sem")
        val hyper = getProp("ro.mi.os.version.name")
        val miui = getProp("ro.miui.ui.version.name")

        return OemIdentityClassifier.classify(
            identity = identity,
            oneUiVersion = oneUi,
            hyperOsVersion = hyper,
            miuiVersion = miui,
        )
    }

    private fun getProp(name: String): String? = try {
        val process = Runtime.getRuntime().exec(arrayOf("getprop", name))
        process.inputStream.bufferedReader().use { it.readLine() }
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
    } catch (_: Throwable) {
        null
    }
}
