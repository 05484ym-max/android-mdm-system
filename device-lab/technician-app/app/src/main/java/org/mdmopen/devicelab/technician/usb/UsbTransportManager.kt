package org.mdmopen.devicelab.technician.usb

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import android.app.PendingIntent
import org.mdmopen.devicelab.technician.protocol.AdbHandshakeResult
import org.mdmopen.devicelab.technician.protocol.ConnectionStateEngine
import org.mdmopen.devicelab.technician.protocol.UsbInterfaceSignature
import org.mdmopen.devicelab.technician.protocol.UsbSnapshot
import org.mdmopen.devicelab.technician.protocol.UsbTransportGuess

/**
 * Real UsbManager glue. Deliberately thin: everything that decides WHAT a given set of
 * observations means (ConnectionState) lives in protocol-core and is unit tested there; this
 * class only builds an honest UsbSnapshot from the real android.hardware.usb API surface.
 *
 * MVP scope: manual "Connect" flow only (UsbManager.getDeviceList() on demand), not an
 * auto-launch-on-USB_DEVICE_ATTACHED intent filter. A permissive device_filter.xml that
 * matches "any Android device" is not reliably expressible (device_filter matches on
 * vendor/product id or device-level class, and ADB/Fastboot declare their class at the
 * INTERFACE level, not the device level), so a manual scan-on-demand is the more honest,
 * always-reliable MVP choice; auto-launch is a Phase 2 nicety, not a correctness requirement.
 */
class UsbTransportManager(private val context: Context) {
    private val usbManager: UsbManager
        get() = context.getSystemService(Context.USB_SERVICE) as UsbManager

    private val permissionAction = "${context.packageName}.USB_PERMISSION"

    fun currentDevices(): List<UsbDevice> = usbManager.deviceList.values.toList()

    fun hasPermission(device: UsbDevice): Boolean = usbManager.hasPermission(device)

    /** Shows the system USB-permission dialog; [onResult] fires once, on the main thread. */
    fun requestPermission(device: UsbDevice, onResult: (granted: Boolean) -> Unit) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                if (intent.action != permissionAction) return
                context.unregisterReceiver(this)
                val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                onResult(granted)
            }
        }
        val filter = IntentFilter(permissionAction)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(receiver, filter)
        }
        // requestPermission requires a MUTABLE PendingIntent (API 31+): the system fills in
        // EXTRA_DEVICE / EXTRA_PERMISSION_GRANTED on the intent it delivers back to us.
        val flags = PendingIntent.FLAG_MUTABLE
        val pendingIntent = PendingIntent.getBroadcast(context, 0, Intent(permissionAction), flags)
        usbManager.requestPermission(device, pendingIntent)
    }

    /** Classifies a device's interfaces without opening/claiming anything (read-only inspection). */
    fun classifyTransport(device: UsbDevice): UsbTransportGuess {
        for (i in 0 until device.interfaceCount) {
            val iface = device.getInterface(i)
            if (matches(iface, UsbInterfaceSignature.ADB_CLASS, UsbInterfaceSignature.ADB_SUBCLASS, UsbInterfaceSignature.ADB_PROTOCOL)) {
                return UsbTransportGuess.ADB
            }
            if (matches(iface, UsbInterfaceSignature.FASTBOOT_CLASS, UsbInterfaceSignature.FASTBOOT_SUBCLASS, UsbInterfaceSignature.FASTBOOT_PROTOCOL)) {
                return UsbTransportGuess.FASTBOOT
            }
        }
        return UsbTransportGuess.USB_ONLY_UNKNOWN
    }

    private fun matches(iface: UsbInterface, cls: Int, subclass: Int, protocol: Int): Boolean =
        iface.interfaceClass == cls && iface.interfaceSubclass == subclass && iface.interfaceProtocol == protocol

    /**
     * Builds the pure-logic snapshot for ConnectionStateEngine.classify(). [adbHandshake] is
     * supplied by the caller because attempting a real handshake is a slow, stateful USB I/O
     * operation this class does not perform on its own - see AdbHostConnection (EXPERIMENTAL,
     * unverified against real hardware in this sandbox).
     */
    fun snapshot(adbHandshake: AdbHandshakeResult = AdbHandshakeResult.NOT_ATTEMPTED, wirelessAdbConnected: Boolean = false): UsbSnapshot {
        val devices = currentDevices()
        val single = devices.singleOrNull()
        return UsbSnapshot(
            attachedDeviceCount = devices.size,
            permissionGranted = single?.let { hasPermission(it) } ?: false,
            transportGuess = single?.let { classifyTransport(it) },
            adbHandshake = adbHandshake,
            wirelessAdbConnected = wirelessAdbConnected
        )
    }

    fun currentState(adbHandshake: AdbHandshakeResult = AdbHandshakeResult.NOT_ATTEMPTED) =
        ConnectionStateEngine.classify(snapshot(adbHandshake))
}
