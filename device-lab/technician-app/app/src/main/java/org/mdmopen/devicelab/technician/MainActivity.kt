package org.mdmopen.devicelab.technician

import android.app.Activity
import android.graphics.Color
import android.hardware.usb.UsbManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import org.mdmopen.devicelab.technician.adb.AdbHostConnection
import org.mdmopen.devicelab.technician.adb.KeystoreAdbAuthSigner
import org.mdmopen.devicelab.technician.fastboot.FastbootHostConnection
import org.mdmopen.devicelab.technician.net.DeviceLabApiClient
import org.mdmopen.devicelab.technician.net.TechnicianAuth
import org.mdmopen.devicelab.technician.protocol.ConnectionState
import org.mdmopen.devicelab.technician.protocol.DeviceEvidence
import org.mdmopen.devicelab.technician.protocol.DeviceProperties
import org.mdmopen.devicelab.technician.protocol.FastbootEvidence
import org.mdmopen.devicelab.technician.protocol.UsbEvidence
import org.mdmopen.devicelab.technician.protocol.UsbTransportGuess
import org.mdmopen.devicelab.technician.scan.ScanRepository
import org.mdmopen.devicelab.technician.usb.UsbTransportManager
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

/**
 * RTL, Hebrew, single-screen MVP UI. Programmatic Views (no XML layouts / AppCompat), matching
 * the existing dpc-app module's own convention. Functionality first: this favors a simple,
 * always-correct polling loop over a more elaborate reactive USB event pipeline that could not
 * be tested here anyway.
 */
class MainActivity : Activity() {
    private lateinit var usbTransportManager: UsbTransportManager
    private lateinit var scanRepository: ScanRepository
    private lateinit var apiClient: DeviceLabApiClient
    private lateinit var stateLabel: TextView
    private lateinit var guidanceLabel: TextView
    private lateinit var resultArea: LinearLayout
    private val mainHandler = Handler(Looper.getMainLooper())
    private var polling = false
    private val ioExecutor = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        usbTransportManager = UsbTransportManager(this)
        scanRepository = ScanRepository(this)
        // Base URL and technician login flow are out of scope for this MVP pass (see report);
        // a real deployment must not ship a hardcoded backend origin or a bearer token this
        // way. Wired to localhost only so the client compiles as a complete, callable unit.
        apiClient = DeviceLabApiClient("http://10.0.2.2:3100", TechnicianAuth(this))

        setContentView(buildUi())
        startPolling()
    }

    override fun onDestroy() {
        polling = false
        mainHandler.removeCallbacksAndMessages(null)
        ioExecutor.shutdownNow()
        super.onDestroy()
    }

    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(32, 48, 32, 32)
        }
        val title = TextView(this).apply {
            text = "מעבדת מכשירים"
            textSize = 24f
            gravity = Gravity.END
            setPadding(0, 0, 0, 24)
        }
        val connectCard = TextView(this).apply {
            text = "חבר מכשיר"
            textSize = 18f
            gravity = Gravity.END
            setPadding(24, 24, 24, 24)
            setBackgroundColor(Color.parseColor("#F0F0F0"))
        }
        stateLabel = TextView(this).apply {
            textSize = 16f
            gravity = Gravity.END
            setPadding(0, 24, 0, 8)
        }
        guidanceLabel = TextView(this).apply {
            textSize = 14f
            gravity = Gravity.END
            setPadding(0, 0, 0, 24)
        }
        val scanButton = Button(this).apply {
            text = "סרוק מכשיר"
            setOnClickListener { onScanClicked() }
        }
        resultArea = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, 24, 0, 0)
        }

        root.addView(title)
        root.addView(connectCard)
        root.addView(stateLabel)
        root.addView(guidanceLabel)
        root.addView(scanButton)
        root.addView(resultArea)
        return ScrollView(this).apply { addView(root) }
    }

    private fun startPolling() {
        polling = true
        val tick = object : Runnable {
            override fun run() {
                if (!polling) return
                refreshState()
                mainHandler.postDelayed(this, 1500)
            }
        }
        mainHandler.post(tick)
    }

    private fun refreshState() {
        val devices = usbTransportManager.currentDevices()
        val single = devices.singleOrNull()
        val state = usbTransportManager.currentState()
        if (single != null && !usbTransportManager.hasPermission(single)) {
            stateLabel.text = "🟠 נדרשת הרשאת USB"
            guidanceLabel.text = "לחץ סרוק מכשיר ואשר את הרשאת ה-USB."
        } else if (single != null && usbTransportManager.hasPermission(single) &&
            usbTransportManager.classifyTransport(single) == UsbTransportGuess.ADB
        ) {
            stateLabel.text = "🟡 ADB זוהה"
            guidanceLabel.text = "לחץ סרוק מכשיר כדי לבצע אימות ADB וקריאת מידע."
        } else {
            stateLabel.text = statusLine(state)
            guidanceLabel.text = state.guidanceHe
        }
    }

    private fun statusLine(state: ConnectionState): String = when (state) {
        ConnectionState.NoDevice -> "🔴 לא זוהה מכשיר"
        ConnectionState.MultipleDevices -> "⚠ כמה מכשירים מחוברים"
        ConnectionState.UsbOnly -> "🟠 USB מחובר ללא ADB"
        ConnectionState.UnknownUsbMode -> "⚠ מצב USB לא מוכר"
        ConnectionState.AdbUnauthorized -> "🟠 נדרש אישור USB Debugging"
        ConnectionState.AdbOffline -> "🟠 ADB לא מגיב"
        ConnectionState.AdbReady -> "✅ מוכן לסריקה"
        ConnectionState.WirelessAdbReady -> "✅ Wireless ADB מחובר"
        ConnectionState.FastbootReady -> "🟡 Fastboot"
        ConnectionState.RecoveryAdb -> "🟡 Recovery ADB"
        ConnectionState.SideloadAdb -> "🟡 Sideload ADB"
        else -> "⚠ מצב לא ידוע"
    }

    private fun onScanClicked() {
        val devices = usbTransportManager.currentDevices()
        val device = devices.singleOrNull()
        if (device == null) {
            Toast.makeText(this, "חבר מכשיר יחיד לסריקה", Toast.LENGTH_SHORT).show()
            return
        }
        if (!usbTransportManager.hasPermission(device)) {
            usbTransportManager.requestPermission(device) { granted ->
                Toast.makeText(this, if (granted) "הרשאת USB אושרה - לחץ סרוק שוב" else "הרשאת USB נדחתה", Toast.LENGTH_SHORT).show()
            }
            return
        }

        stateLabel.text = "⏳ סורק..."
        guidanceLabel.text = "קורא מידע מהמכשיר. אין לנתק את הכבל."
        ioExecutor.execute {
            val usbManager = getSystemService(USB_SERVICE) as UsbManager
            val transport = usbTransportManager.classifyTransport(device)
            val evidence = when (transport) {
                UsbTransportGuess.ADB -> scanViaAdb(usbManager, device)
                UsbTransportGuess.FASTBOOT -> scanViaFastboot(usbManager, device)
                else -> null
            }
            if (evidence == null) {
                runOnUiThread {
                    Toast.makeText(this, "לא ניתן היה לסרוק את המכשיר במצב הנוכחי", Toast.LENGTH_SHORT).show()
                    refreshState()
                }
            } else {
                submitOrQueue(evidence)
            }
        }
    }

    private fun scanViaAdb(usbManager: UsbManager, device: android.hardware.usb.UsbDevice): DeviceEvidence? {
        val signer = KeystoreAdbAuthSigner.getOrCreate()
        val connection = AdbHostConnection.open(usbManager, device, signer) ?: return null
        connection.use {
            val handshake = it.handshake()
            if (handshake !is AdbHostConnection.HandshakeResult.Ready) return null

            fun getprop(name: String) = it.shell("getprop $name")?.trim()?.takeIf { v -> v.isNotEmpty() }
            val props = DeviceProperties(
                manufacturer = getprop("ro.product.manufacturer"), brand = getprop("ro.product.brand"),
                model = getprop("ro.product.model"), product = getprop("ro.product.name"),
                device = getprop("ro.product.device"), board = getprop("ro.product.board"),
                hardware = getprop("ro.hardware"), platform = getprop("ro.board.platform"),
                cpuAbi = getprop("ro.product.cpu.abi"), androidVersion = getprop("ro.build.version.release"),
                apiLevel = getprop("ro.build.version.sdk"), buildFingerprint = getprop("ro.build.fingerprint"),
                buildId = getprop("ro.build.id"), buildIncremental = getprop("ro.build.version.incremental"),
                securityPatch = getprop("ro.build.version.security_patch"), bootloader = getprop("ro.bootloader"),
                verifiedBootState = getprop("ro.boot.verifiedbootstate"), flashLocked = getprop("ro.boot.flash.locked"),
                slotSuffix = getprop("ro.boot.slot_suffix"), dynamicPartitions = getprop("ro.boot.dynamic_partitions")
            )
            val ownersRaw = it.shell("dpm list owners")
            return DeviceEvidence(
                capturedAt = isoNow(),
                properties = props,
                deviceOwner = ownersRaw,
                usb = UsbEvidence(
                    vid = String.format("%04x", device.vendorId), pid = String.format("%04x", device.productId)
                )
            )
        }
    }

    private fun scanViaFastboot(usbManager: UsbManager, device: android.hardware.usb.UsbDevice): DeviceEvidence? {
        val connection = FastbootHostConnection.open(usbManager, device) ?: return null
        connection.use {
            val fastboot = FastbootEvidence(
                product = it.getVar("product"), unlocked = it.getVar("unlocked"),
                secure = it.getVar("secure"), currentSlot = it.getVar("current-slot")
            )
            return DeviceEvidence(
                capturedAt = isoNow(),
                fastboot = fastboot,
                usb = UsbEvidence(
                    vid = String.format("%04x", device.vendorId), pid = String.format("%04x", device.productId)
                )
            )
        }
    }

    /** Called on ioExecutor only: local file I/O + network I/O never block the UI thread. */
    private fun submitOrQueue(evidence: DeviceEvidence) {
        val evidenceJson = apiClient.evidenceToJson(evidence)
        val entry = scanRepository.saveOffline(evidence, evidenceJson)
        val result = apiClient.submitScan(evidence)

        runOnUiThread {
            when (result) {
                is DeviceLabApiClient.Result.Success -> {
                    scanRepository.markSynced(entry.localId, result.scanId, result.bodyJson.optJSONObject("decision"))
                    renderResult(result.bodyJson)
                }
                is DeviceLabApiClient.Result.HttpError -> {
                    Toast.makeText(this, "השרת דחה את הסריקה (${result.status})", Toast.LENGTH_LONG).show()
                }
                is DeviceLabApiClient.Result.NetworkError -> {
                    Toast.makeText(this, "אין חיבור - הסריקה נשמרה מקומית וממתינה לסנכרון", Toast.LENGTH_LONG).show()
                }
            }
            refreshState()
        }
    }

    private fun renderResult(bodyJson: JSONObject) {
        resultArea.removeAllViews()
        val decision = bodyJson.optJSONObject("decision")
        val status = decision?.optString("status") ?: "UNKNOWN_BUILD"
        val confidence = decision?.optString("confidence") ?: "LOW"
        val line = TextView(this).apply {
            text = "${statusBadge(status)}   ($confidence)"
            textSize = 16f
            gravity = Gravity.END
        }
        resultArea.addView(line)
    }

    private fun statusBadge(status: String): String = when (status) {
        "SUPPORTED_NO_FLASH" -> "✅ מוכן ל-MDM"
        "SUPPORTED_NEEDS_PROVISIONING" -> "🟠 דורש Provisioning"
        "SUPPORTED_NEEDS_FLASH" -> "🟡 דורש צריבה"
        "UNKNOWN_BUILD" -> "⚠ ROM לא מוכר"
        "FLASH_BLOCKED", "UNSUPPORTED" -> "⛔ לא לצרוב כרגע"
        else -> "⚠ לא ידוע"
    }

    private fun isoNow(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())
}
