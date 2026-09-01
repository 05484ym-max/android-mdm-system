package org.mdmopen.devicelab.technician.protocol

/**
 * Mirrors the field names already accepted by device-lab/lib/normalize.js and produced by
 * device-lab/scanner/scanner.js, so this app's scan payload is a drop-in POST body for the
 * existing POST /api/lab/scans endpoint - no backend changes needed for this client.
 * Read-only by construction: there is no field here, and no code path anywhere in this
 * module or the app module, that writes to the scanned device.
 */
data class DeviceProperties(
    val manufacturer: String? = null,
    val brand: String? = null,
    val model: String? = null,
    val product: String? = null,
    val device: String? = null,
    val board: String? = null,
    val hardware: String? = null,
    val platform: String? = null,
    val cpuAbi: String? = null,
    val androidVersion: String? = null,
    val apiLevel: String? = null,
    val buildFingerprint: String? = null,
    val buildId: String? = null,
    val buildIncremental: String? = null,
    val securityPatch: String? = null,
    val bootloader: String? = null,
    val verifiedBootState: String? = null,
    val flashLocked: String? = null,
    val slotSuffix: String? = null,
    val dynamicPartitions: String? = null
)

data class FastbootEvidence(
    val product: String? = null,
    val unlocked: String? = null,
    val secure: String? = null,
    val currentSlot: String? = null
)

data class UsbEvidence(val vid: String? = null, val pid: String? = null, val mode: String? = null, val raw: String? = null)

data class DeviceEvidence(
    val source: String = "technician-app",
    val hostType: String = "ANDROID",
    val capturedAt: String,
    val adbSerial: String? = null,
    val adbState: String? = null,
    val properties: DeviceProperties = DeviceProperties(),
    val setupWizardPackage: String? = null,
    val deviceOwner: String? = null,
    val provisioningAllowed: Boolean? = null,
    val usb: UsbEvidence = UsbEvidence(),
    val fastboot: FastbootEvidence = FastbootEvidence()
)
