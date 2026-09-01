package org.mdmopen.devicelab.technician.fastboot

import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import org.mdmopen.devicelab.technician.protocol.FastbootProtocol
import org.mdmopen.devicelab.technician.protocol.UsbInterfaceSignature

/**
 * EXPERIMENTAL / UNVERIFIED against real hardware in this sandbox (no device available) -
 * same caveat as AdbHostConnection, though this protocol is much simpler (plain text
 * request/response, no crypto, no stream multiplexing) and therefore lower-risk.
 *
 * Read-only by construction: getVar() is the only public method. There is no flash, erase,
 * boot, reboot, or unlock method anywhere in this class, and none should ever be added
 * without a separate, explicit, much more carefully gated feature.
 */
class FastbootHostConnection private constructor(
    private val connection: UsbDeviceConnection,
    private val iface: UsbInterface,
    private val bulkIn: UsbEndpoint,
    private val bulkOut: UsbEndpoint
) : AutoCloseable {

    /** Reads a single fastboot variable, e.g. "product", "unlocked", "secure", "current-slot". */
    fun getVar(name: String, timeoutMs: Int = 4000): String? {
        val command = FastbootProtocol.getVarCommand(name)
        val sent = connection.bulkTransfer(bulkOut, command, command.size, timeoutMs)
        if (sent != command.size) return null

        // A real device may send one or more INFO lines before the final OKAY/FAIL; bounded
        // so a misbehaving/unexpected device can't spin this loop forever.
        repeat(16) {
            val buf = ByteArray(64)
            val read = connection.bulkTransfer(bulkIn, buf, buf.size, timeoutMs)
            if (read <= 0) return null
            when (val response = FastbootProtocol.parseResponse(buf.copyOfRange(0, read))) {
                is FastbootProtocol.Response.Okay -> return response.value
                is FastbootProtocol.Response.Fail -> return null
                is FastbootProtocol.Response.Info -> Unit // keep reading
                is FastbootProtocol.Response.Data -> return null // not handled; this app never transfers data
                is FastbootProtocol.Response.Malformed -> return null
            }
        }
        return null
    }

    override fun close() {
        connection.releaseInterface(iface)
        connection.close()
    }

    companion object {
        fun open(usbManager: UsbManager, device: UsbDevice): FastbootHostConnection? {
            for (i in 0 until device.interfaceCount) {
                val iface = device.getInterface(i)
                val isFastboot = iface.interfaceClass == UsbInterfaceSignature.FASTBOOT_CLASS &&
                    iface.interfaceSubclass == UsbInterfaceSignature.FASTBOOT_SUBCLASS &&
                    iface.interfaceProtocol == UsbInterfaceSignature.FASTBOOT_PROTOCOL
                if (!isFastboot) continue

                var bulkIn: UsbEndpoint? = null
                var bulkOut: UsbEndpoint? = null
                for (e in 0 until iface.endpointCount) {
                    val endpoint = iface.getEndpoint(e)
                    if (endpoint.type != UsbConstants.USB_ENDPOINT_XFER_BULK) continue
                    if (endpoint.direction == UsbConstants.USB_DIR_IN) bulkIn = endpoint else bulkOut = endpoint
                }
                if (bulkIn == null || bulkOut == null) continue

                val connection = usbManager.openDevice(device) ?: return null
                if (!connection.claimInterface(iface, true)) {
                    connection.close()
                    return null
                }
                return FastbootHostConnection(connection, iface, bulkIn, bulkOut)
            }
            return null
        }
    }
}
