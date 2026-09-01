package org.mdmopen.devicelab.technician.protocol

/** USB interface class/subclass/protocol triples that identify transport mode over USB. */
object UsbInterfaceSignature {
    // adb interface: class 0xFF (vendor-specific), subclass 0x42, protocol 0x01
    const val ADB_CLASS = 0xFF
    const val ADB_SUBCLASS = 0x42
    const val ADB_PROTOCOL = 0x01

    // fastboot interface: class 0xFF, subclass 0x42, protocol 0x03
    const val FASTBOOT_CLASS = 0xFF
    const val FASTBOOT_SUBCLASS = 0x42
    const val FASTBOOT_PROTOCOL = 0x03
}

enum class UsbTransportGuess { ADB, FASTBOOT, USB_ONLY_UNKNOWN }

/** Result of an actual (attempted) ADB CNXN handshake over USB, if one was tried. */
enum class AdbHandshakeResult { READY, UNAUTHORIZED, OFFLINE, NOT_ATTEMPTED }

/**
 * Everything the transport layer observed about currently-attached devices, expressed
 * without any android.hardware.usb types so this classification logic can run - and be
 * unit-tested - on a plain JVM. The real UsbTransportManager (Android module) builds one
 * of these from real UsbDevice/UsbInterface objects and a real (or not-yet-attempted)
 * handshake, then calls [ConnectionStateEngine.classify].
 */
data class UsbSnapshot(
    val attachedDeviceCount: Int,
    val permissionGranted: Boolean,
    val transportGuess: UsbTransportGuess?,
    val adbHandshake: AdbHandshakeResult = AdbHandshakeResult.NOT_ATTEMPTED,
    val wirelessAdbConnected: Boolean = false,
    val isRecoveryAdb: Boolean = false,
    val isSideloadAdb: Boolean = false
)

sealed class ConnectionState(val guidanceHe: String) {
    object NoDevice : ConnectionState("חבר מכשיר USB או Wireless ADB.")
    object MultipleDevices : ConnectionState("מחוברים כמה מכשירים בו-זמנית. נתק את כולם חוץ מהמכשיר לסריקה.")
    object UsbOnly : ConnectionState(
        "המכשיר מחובר ב-USB אך ADB אינו פעיל.\nהפעל Developer Options ו-USB Debugging."
    )
    object UnknownUsbMode : ConnectionState("מצב USB לא מוכר. נסה לנתק ולחבר מחדש, או בדוק כבל/פורט אחר.")
    object AdbUnauthorized : ConnectionState("פתח את המכשיר ואשר \"Allow USB debugging\".")
    object AdbOffline : ConnectionState("המכשיר זוהה אך ADB לא מגיב (offline). נתק וחבר מחדש.")
    object AdbReady : ConnectionState("מוכן לסריקה מלאה.")
    object WirelessAdbReady : ConnectionState("מחובר דרך Wireless ADB. מוכן לסריקה מלאה.")
    object FastbootReady : ConnectionState("המכשיר נמצא ב-Fastboot. ניתן לקרוא מידע מוגבל בלבד.")
    object RecoveryAdb : ConnectionState("המכשיר ב-Recovery עם ADB. מידע מוגבל בלבד זמין.")
    object SideloadAdb : ConnectionState("המכשיר ב-Sideload ADB. מידע מוגבל בלבד זמין.")
}

object ConnectionStateEngine {
    fun classify(snapshot: UsbSnapshot): ConnectionState {
        if (snapshot.wirelessAdbConnected && snapshot.attachedDeviceCount == 0) return ConnectionState.WirelessAdbReady
        if (snapshot.attachedDeviceCount == 0) return ConnectionState.NoDevice
        if (snapshot.attachedDeviceCount > 1) return ConnectionState.MultipleDevices
        if (!snapshot.permissionGranted) return ConnectionState.UsbOnly
        if (snapshot.isRecoveryAdb) return ConnectionState.RecoveryAdb
        if (snapshot.isSideloadAdb) return ConnectionState.SideloadAdb

        return when (snapshot.transportGuess) {
            UsbTransportGuess.FASTBOOT -> ConnectionState.FastbootReady
            UsbTransportGuess.ADB -> when (snapshot.adbHandshake) {
                AdbHandshakeResult.READY -> ConnectionState.AdbReady
                AdbHandshakeResult.UNAUTHORIZED -> ConnectionState.AdbUnauthorized
                AdbHandshakeResult.OFFLINE -> ConnectionState.AdbOffline
                AdbHandshakeResult.NOT_ATTEMPTED -> ConnectionState.UsbOnly
            }
            UsbTransportGuess.USB_ONLY_UNKNOWN -> ConnectionState.UnknownUsbMode
            null -> ConnectionState.UsbOnly
        }
    }
}
