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
    private val NAVY = Color.rgb(9, 28, 53)
    private val NAVY_CARD = Color.rgb(17, 48, 83)
    private val NAVY_CARD_DEEP = Color.rgb(12, 38, 69)
    private val GOLD = Color.rgb(214, 176, 67)
    private val GOLD_SOFT = Color.rgb(236, 208, 122)
    private val WHITE = Color.rgb(248, 250, 252)
    private val MUTED = Color.rgb(197, 211, 228)

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

        val background = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(Color.rgb(7, 23, 44), NAVY, Color.rgb(13, 42, 76)),
        )

        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(32), dp(24), dp(32))
            this.background = background
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }

        val brand = TextView(context).apply {
            text = "יהודי"
            textSize = 26f
            setTextColor(GOLD_SOFT)
            gravity = Gravity.CENTER
            setPadding(dp(18), dp(8), dp(18), dp(8))
            background = roundedStroke(dp(999), Color.TRANSPARENT, GOLD, dp(1))
        }
        root.addView(
            brand,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        root.addView(Space(context), LinearLayout.LayoutParams(1, dp(26)))

        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(28), dp(24), dp(24))
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(NAVY_CARD, NAVY_CARD_DEEP),
            ).apply { cornerRadius = dp(28).toFloat() }
            elevation = dp(10).toFloat()
        }

        val badge = TextView(context).apply {
            text = copy.eyebrow
            textSize = 13f
            setTextColor(NAVY)
            gravity = Gravity.CENTER
            setPadding(dp(14), dp(6), dp(14), dp(6))
            background = roundedStroke(dp(999), GOLD, GOLD, 0)
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
            text = "✦"
            textSize = 34f
            setTextColor(GOLD_SOFT)
            gravity = Gravity.CENTER
        }
        card.addView(
            icon,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )

        val title = TextView(context).apply {
            text = copy.title
            textSize = 29f
            setTextColor(WHITE)
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, 0)
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
            setTextColor(NAVY)
            gravity = Gravity.CENTER
            background = roundedStroke(dp(16), GOLD, GOLD, 0)
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

        root.addView(Space(context), LinearLayout.LayoutParams(1, dp(22)))

        val footer = TextView(context).apply {
            text = "יהודי כשר • הגנה פעילה"
            textSize = 12f
            setTextColor(Color.rgb(146, 171, 200))
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
