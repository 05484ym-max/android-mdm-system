package org.mdmopen.dpc

/** Pure OEM classification so precedence rules can be unit-tested without Android Build mocks. */
object OemIdentityClassifier {
    data class Identity(
        val manufacturer: String,
        val brand: String,
        val model: String,
        val device: String,
        val product: String,
        val buildDisplay: String,
        val androidRelease: String,
    )

    fun classify(
        identity: Identity,
        oneUiVersion: String? = null,
        hyperOsVersion: String? = null,
        miuiVersion: String? = null,
    ): Pair<String, String?> {
        val manufacturer = identity.manufacturer.lowercase()
        val brand = identity.brand.lowercase()
        val model = identity.model.lowercase()
        val device = identity.device.lowercase()
        val product = identity.product.lowercase()
        val buildDisplay = identity.buildDisplay.lowercase()
        val qinIdentity = listOf(manufacturer, brand, model, device, product, buildDisplay).joinToString(" ")

        // Qin identity is intentionally evaluated before Xiaomi. Several Qin
        // firmwares identify manufacturer/brand as Xiaomi even though model,
        // device or product clearly identifies the Qin family.
        val qinLike = manufacturer.contains("qin") || brand.contains("qin") ||
            qinIdentity.contains("duoqin") || qinIdentity.contains("f21") ||
            qinIdentity.contains("f22") || qinIdentity.contains("qin3") ||
            qinIdentity.contains("q3u")
        if (qinLike) {
            val family = when {
                qinIdentity.contains("qin3 ultra") || qinIdentity.contains("qin3ultra") ||
                    qinIdentity.contains("q3u") -> "qin_3_ultra"
                qinIdentity.contains("f22") -> "qin_f22pro"
                qinIdentity.contains("f21") -> "qin_f21pro"
                else -> "qin_generic"
            }
            return family to identity.androidRelease
        }

        if (manufacturer == "samsung" || brand == "samsung") {
            return "samsung_oneui" to oneUiVersion
        }

        if (manufacturer == "xiaomi" || brand in setOf("xiaomi", "redmi", "poco")) {
            if (!hyperOsVersion.isNullOrBlank()) return "xiaomi_hyperos" to hyperOsVersion
            return "xiaomi_miui" to miuiVersion
        }

        return "aosp_generic" to null
    }
}
