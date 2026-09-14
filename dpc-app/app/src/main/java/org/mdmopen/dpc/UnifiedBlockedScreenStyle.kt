package org.mdmopen.dpc

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Space
import android.widget.TextView

object UnifiedBlockedScreenStyle {
    // Match the current "יהודי כשר" app palette.
    private val BG = Color.parseColor("#F2F1E6")
    private val BG_SOFT = Color.parseColor("#E8E9D8")
    private val CARD = Color.parseColor("#FBFAF4")
    private val TEXT = Color.parseColor("#1C1C1C")
    private val MUTED = Color.parseColor("#6F746A")
    private val GREEN = Color.parseColor("#4B6B45")
    private val GREEN_DARK = Color.parseColor("#31482E")
    private val GREEN_OK = Color.parseColor("#328A52")
    private val GREEN_SOFT = Color.parseColor("#DDE7D8")
    private val WHITE = Color.WHITE

    data class Copy(
        val eyebrow: String,
        val title: String,
        val message: String,
        val button: String,
    )

    fun create(
        context: Context,
        copy: Copy,
        onAction: () -> Unit,
    ): View {
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt().coerceAtLeast(1)

        val pageBackground = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(BG, Color.parseColor("#ECEBDD"), BG_SOFT),
        )

        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(32), dp(24), dp(32))
            background = pageBackground
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }

        val brand = TextView(context).apply {
            text = "יהודי"
            textSize = 25f
            setTextColor(GREEN_DARK)
            gravity = Gravity.CENTER
            setPadding(dp(18), dp(8), dp(18), dp(8))
            background = roundedStroke(dp(999), GREEN_SOFT, GREEN, dp(1))
        }
        root.addView(
            brand,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        root.addView(Space(context), LinearLayout.LayoutParams(1, dp(24)))

        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(28), dp(24), dp(24))
            background = roundedStroke(dp(28), CARD, Color.parseColor("#D9DDCF"), dp(1))
            elevation = dp(10).toFloat()
        }

        val badge = TextView(context).apply {
            text = copy.eyebrow
            textSize = 13f
            setTextColor(WHITE)
            gravity = Gravity.CENTER
            setPadding(dp(14), dp(6), dp(14), dp(6))
            background = roundedStroke(dp(999), GREEN, GREEN, 0)
        }
        card.addView(
            badge,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        card.addView(Space(context), LinearLayout.LayoutParams(1, dp(18)))

        val icon = TextView(context).apply {
            text = "✓"
            textSize = 31f
            setTextColor(GREEN_OK)
            gravity = Gravity.CENTER
            background = roundedStroke(dp(999), GREEN_SOFT, Color.TRANSPARENT, 0)
            setPadding(dp(13), dp(6), dp(13), dp(7))
        }
        card.addView(
            icon,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        val title = TextView(context).apply {
            text = copy.title
            textSize = 29f
            setTextColor(TEXT)
            gravity = Gravity.CENTER
            setPadding(0, dp(14), 0, 0)
        }
        card.addView(
            title,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        val message = TextView(context).apply {
            text = copy.message
            textSize = 17f
            setTextColor(MUTED)
            gravity = Gravity.CENTER
            setLineSpacing(0f, 1.18f)
            setPadding(dp(4), dp(14), dp(4), dp(24))
        }
        card.addView(
            message,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        val button = Button(context).apply {
            text = copy.button
            textSize = 16f
            isAllCaps = false
            setTextColor(WHITE)
            gravity = Gravity.CENTER
            background = roundedStroke(dp(16), GREEN, GREEN, 0)
            setOnClickListener { onAction() }
        }
        card.addView(
            button,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(54),
            ),
        )

        val cardParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply {
            marginStart = dp(2)
            marginEnd = dp(2)
        }
        root.addView(card, cardParams)

        root.addView(Space(context), LinearLayout.LayoutParams(1, dp(20)))

        val footer = TextView(context).apply {
            text = "יהודי כשר • הגנה פעילה"
            textSize = 12f
            setTextColor(GREEN_DARK)
            alpha = 0.72f
            gravity = Gravity.CENTER
        }
        root.addView(
            footer,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        return root
    }

    private fun roundedStroke(radius: Int, fill: Int, stroke: Int, strokeWidth: Int): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = radius.toFloat()
            setColor(fill)
            if (strokeWidth > 0) setStroke(strokeWidth, stroke)
        }
}
