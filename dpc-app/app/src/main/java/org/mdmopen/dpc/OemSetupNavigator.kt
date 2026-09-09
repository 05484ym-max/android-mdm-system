package org.mdmopen.dpc

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings

/**
 * Runtime-safe OEM setup navigation for the non-Device-Owner path.
 *
 * Proprietary settings screens are never assumed to exist. Every OEM-specific
 * candidate is resolved first; if it is unavailable we fall back to standard
 * Android app/battery settings instead of crashing or pretending the setting
 * was applied.
 */
object OemSetupNavigator {

    fun candidateIntents(context: Context, adapterId: String): List<Intent> {
        val packageName = context.packageName
        val appDetails = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:$packageName"),
        )
        val battery = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)

        val candidates = mutableListOf<Intent>()

        if (adapterId == "xiaomi.miui" || adapterId == "xiaomi.hyperos") {
            // Present on many MIUI/HyperOS builds, but not part of Android API.
            // Keep it best-effort and only expose it when the package manager
            // confirms that this exact build can resolve it.
            candidates += Intent("miui.intent.action.OP_AUTO_START")
        }

        // Samsung One UI and Qin variants do not get a guessed private
        // component here. Standard Android screens are reliable fallbacks and
        // adapters can add build-specific verified candidates later.
        candidates += appDetails
        candidates += battery

        return candidates.filter { intent ->
            runCatching { intent.resolveActivity(context.packageManager) != null }
                .getOrDefault(false)
        }
    }

    fun firstResolvableIntent(context: Context, adapterId: String): Intent? =
        candidateIntents(context, adapterId).firstOrNull()
}
