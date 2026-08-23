package org.mdmopen.dpc

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(this, DpcDeviceAdminReceiver::class.java)

        val isDeviceOwner = dpm.isDeviceOwnerApp(packageName)
        val isAdminActive = dpm.isAdminActive(admin)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0B0B0C"))
            setPadding(48, 96, 48, 48)
        }

        root.addView(TextView(this).apply {
            text = "MDM DPC"
            textSize = 26f
            setTextColor(Color.parseColor("#E8CF7A"))
            gravity = Gravity.CENTER
        })

        root.addView(statusRow("Device Owner", isDeviceOwner))
        root.addView(statusRow("Device Admin active", isAdminActive))

        root.addView(TextView(this).apply {
            text = "Package: $packageName"
            textSize = 13f
            setTextColor(Color.parseColor("#A9A49A"))
            setPadding(0, 64, 0, 0)
        })

        setContentView(root)
    }

    private fun statusRow(label: String, ok: Boolean): TextView =
        TextView(this).apply {
            text = if (ok) "✓  $label" else "✕  $label"
            textSize = 18f
            setTextColor(Color.parseColor(if (ok) "#7ED957" else "#E05C5C"))
            setPadding(0, 40, 0, 0)
        }
}
