package org.mdmopen.dpc

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class WhatsAppMaskCalibrationLauncherActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!Config.hasAdminPin(this)) {
            Toast.makeText(this, "יש להגדיר קודם קוד מנהל", Toast.LENGTH_LONG).show()
            finish()
            return
        }
        requestAdminPin()
    }

    private fun requestAdminPin() {
        val input = EditText(this).apply {
            hint = "קוד מנהל"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            setSingleLine()
            gravity = Gravity.CENTER
        }
        AlertDialog.Builder(this)
            .setTitle("כיול הסתרת תמונות WhatsApp")
            .setMessage("הזן קוד מנהל כדי להמשיך")
            .setView(input)
            .setCancelable(false)
            .setNegativeButton("ביטול") { _, _ -> finish() }
            .setPositiveButton("המשך", null)
            .create()
            .also { dialog ->
                dialog.setOnShowListener {
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                        if (Config.checkAdminPin(this, input.text.toString())) {
                            dialog.dismiss()
                            setContentView(buildChooser())
                        } else {
                            input.error = "קוד שגוי"
                        }
                    }
                }
                dialog.show()
            }
    }

    private fun buildChooser(): View {
        fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setBackgroundColor(Color.parseColor("#F7F2E8"))
            setPadding(dp(24), dp(42), dp(24), dp(32))
        }
        root.addView(TextView(this).apply {
            text = "כיול הסתרת תמונות WhatsApp"
            textSize = 23f
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#17472B"))
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(TextView(this).apply {
            text = "בחר מסך. WhatsApp ייפתח ומעליו יופיע וילון שאפשר לגרור ולשנות את גודלו."
            textSize = 15f
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#6F746A"))
            setPadding(0, dp(12), 0, dp(22))
        })

        addTargetButton(root, "רשימת צ'אטים", WhatsAppMaskTarget.CHAT_LIST)
        addTargetButton(root, "בחירת אנשי קשר", WhatsAppMaskTarget.CONTACT_PICKER)
        addTargetButton(root, "כותרת צ'אט", WhatsAppMaskTarget.CHAT_HEADER)
        addTargetButton(root, "פרטי איש קשר", WhatsAppMaskTarget.CONTACT_INFO)

        root.addView(Button(this).apply {
            text = "סגור"
            isAllCaps = false
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(18) })
        return root
    }

    private fun addTargetButton(root: LinearLayout, label: String, target: WhatsAppMaskTarget) {
        fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
        root.addView(Button(this).apply {
            text = label
            isAllCaps = false
            textSize = 16f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#245E38"))
            setOnClickListener { launchCalibration(target) }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)).apply { bottomMargin = dp(10) })
    }

    private fun launchCalibration(target: WhatsAppMaskTarget) {
        val whatsapp = packageManager.getLaunchIntentForPackage(WhatsAppGuardService.WHATSAPP_PACKAGE)
        if (whatsapp == null) {
            Toast.makeText(this, "WhatsApp לא מותקן במכשיר", Toast.LENGTH_LONG).show()
            return
        }
        val overlay = Intent(this, WhatsAppMaskCalibrationActivity::class.java).apply {
            putExtra(WhatsAppMaskCalibrationActivity.EXTRA_TARGET, target.name)
        }
        try {
            startActivities(arrayOf(whatsapp, overlay))
        } catch (_: Exception) {
            Toast.makeText(this, "לא ניתן לפתוח את מסך הכיול", Toast.LENGTH_LONG).show()
        }
    }
}
