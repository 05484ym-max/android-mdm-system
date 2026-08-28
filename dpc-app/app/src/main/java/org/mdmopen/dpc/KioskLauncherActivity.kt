package org.mdmopen.dpc

import android.app.Activity
import android.app.ActivityManager
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/** Home screen shown on a managed device: only the allowed apps are reachable. */
class KioskLauncherActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        render()
    }

    override fun onResume() {
        super.onResume()
        enterLockTaskIfNeeded()
        render()
    }

    /** This is the home screen - back must not take the user anywhere else. */
    override fun onBackPressed() = Unit

    private fun enterLockTaskIfNeeded() {
        if (!Config.kioskEnabled(this)) return
        val manager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        if (manager.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE) return
        try {
            startLockTask()
        } catch (e: IllegalArgumentException) {
            // Policy has not been applied yet - the next sync will allow lock task.
        }
    }

    private fun render() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor(BG))
            setPadding(48, 96, 48, 48)
        }

        root.addView(TextView(this).apply {
            text = "מכשיר מנוהל"
            textSize = 22f
            setTextColor(Color.parseColor(GOLD_SOFT))
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 48)
            setOnLongClickListener { promptForAdminAccess(); true }
        })

        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        var shown = 0
        // Essential system apps (Settings, dialer, etc.) are always reachable here too -
        // otherwise a customer with nothing approved yet (or not installed) is stuck on
        // an empty screen with no way to do anything.
        val essential = PolicyEnforcer(this).essentialPackages() - packageName
        val candidates = essential + Config.allowedApps(this)
        val entries = candidates.mapNotNull { pkg ->
            val intent = packageManager.getLaunchIntentForPackage(pkg) ?: return@mapNotNull null
            Triple(pkg, intent, appLabel(pkg))
        }.sortedBy { it.third }

        for ((pkg, launchIntent, _) in entries) {
            list.addView(appRow(pkg, launchIntent))
            list.addView(spacer())
            shown++
        }
        if (shown == 0) {
            list.addView(TextView(this).apply {
                text = "אין אפליקציות זמינות"
                textSize = 15f
                setTextColor(Color.parseColor(DIM))
                gravity = Gravity.CENTER
                setPadding(0, 64, 0, 0)
            })
        }

        root.addView(
            ScrollView(this).apply { addView(list) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f),
        )

        setContentView(root)
    }

    private fun appRow(packageName: String, launchIntent: Intent) = TextView(this).apply {
        text = appLabel(packageName)
        textSize = 18f
        setTextColor(Color.parseColor(TEXT))
        setBackgroundColor(Color.parseColor(CARD))
        setPadding(36, 40, 36, 40)
        setOnClickListener {
            try {
                startActivity(launchIntent)
            } catch (e: Exception) {
                Toast.makeText(context, "לא ניתן לפתוח את האפליקציה", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun appLabel(packageName: String): String = try {
        packageManager.getApplicationLabel(
            packageManager.getApplicationInfo(packageName, 0)
        ).toString()
    } catch (e: Exception) {
        packageName
    }

    private fun spacer() = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 16)
    }

    private fun promptForAdminAccess() {
        if (!Config.hasAdminPin(this)) {
            openAdminScreen()
            return
        }
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            hint = "קוד מנהל"
        }
        AlertDialog.Builder(this)
            .setTitle("גישת מנהל")
            .setView(input)
            .setPositiveButton("אישור") { _, _ ->
                if (Config.checkAdminPin(this, input.text.toString())) {
                    openAdminScreen()
                } else {
                    Toast.makeText(this, "קוד שגוי", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("ביטול", null)
            .show()
    }

    private fun openAdminScreen() {
        startActivity(Intent(this, MainActivity::class.java))
    }
}
