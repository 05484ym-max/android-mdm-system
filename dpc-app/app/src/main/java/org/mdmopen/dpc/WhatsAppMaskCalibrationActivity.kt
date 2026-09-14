package org.mdmopen.dpc

import android.app.Activity
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

class WhatsAppMaskCalibrationActivity : Activity() {
    private lateinit var target: WhatsAppMaskTarget
    private lateinit var editor: MaskEditorView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        target = runCatching {
            WhatsAppMaskTarget.valueOf(intent.getStringExtra(EXTRA_TARGET).orEmpty())
        }.getOrElse {
            finish()
            return
        }

        window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        window.addFlags(
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        )
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION

        val initial = WhatsAppMaskCalibrationStore.get(this, target)
            ?: WhatsAppMaskCalibrationStore.defaultRect(target)
        setContentView(buildUi(initial))
    }

    private fun buildUi(initial: NormalizedMaskRect): View {
        val root = FrameLayout(this)
        editor = MaskEditorView(this, initial)
        root.addView(editor, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        ))

        val topCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(14), dp(10), dp(14), dp(10))
            setBackgroundColor(Color.argb(232, 247, 242, 232))
            addView(TextView(this@WhatsAppMaskCalibrationActivity).apply {
                text = "כיול: ${targetLabel(target)}"
                textSize = 17f
                gravity = Gravity.CENTER
                setTextColor(Color.parseColor("#17472B"))
            })
            addView(TextView(this@WhatsAppMaskCalibrationActivity).apply {
                text = "גרור את הווילון. גרירה בתוך האזור מזיזה אותו; גרירה ליד הקצוות משנה את הגודל."
                textSize = 12.5f
                gravity = Gravity.CENTER
                setTextColor(Color.parseColor("#515A50"))
            })
        }
        root.addView(topCard, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP,
        ).apply {
            leftMargin = dp(12); rightMargin = dp(12); topMargin = dp(28)
        })

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(10), dp(10), dp(10), dp(10))
            setBackgroundColor(Color.argb(238, 247, 242, 232))
        }

        actions.addView(actionButton("ביטול", false) { finish() }, buttonParams())
        actions.addView(actionButton("איפוס", false) {
            WhatsAppMaskCalibrationStore.clear(this, target)
            editor.setNormalizedRect(WhatsAppMaskCalibrationStore.defaultRect(target))
            Toast.makeText(this, "הכיול אופס. ניתן לגרור מחדש ולשמור", Toast.LENGTH_SHORT).show()
        }, buttonParams())
        actions.addView(actionButton("שמור", true) {
            val rect = editor.getNormalizedRect()
            if (!rect.isUsable()) {
                Toast.makeText(this, "האזור קטן מדי", Toast.LENGTH_SHORT).show()
                return@actionButton
            }
            WhatsAppMaskCalibrationStore.save(this, target, rect)
            Toast.makeText(this, "הכיול נשמר", Toast.LENGTH_SHORT).show()
            finish()
        }, buttonParams())

        root.addView(actions, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(76),
            Gravity.BOTTOM,
        ).apply {
            leftMargin = dp(12); rightMargin = dp(12); bottomMargin = dp(18)
        })
        return root
    }

    private fun actionButton(text: String, primary: Boolean, action: () -> Unit) = Button(this).apply {
        this.text = text
        isAllCaps = false
        textSize = 15f
        setTextColor(if (primary) Color.WHITE else Color.parseColor("#17472B"))
        setBackgroundColor(Color.parseColor(if (primary) "#245E38" else "#E4EAD3"))
        setOnClickListener { action() }
    }

    private fun buttonParams() = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f).apply {
        marginStart = dp(4); marginEnd = dp(4)
    }

    private fun targetLabel(target: WhatsAppMaskTarget): String = when (target) {
        WhatsAppMaskTarget.CHAT_LIST -> "רשימת צ'אטים"
        WhatsAppMaskTarget.CONTACT_PICKER -> "בחירת אנשי קשר"
        WhatsAppMaskTarget.CHAT_HEADER -> "כותרת צ'אט"
        WhatsAppMaskTarget.CONTACT_INFO -> "פרטי איש קשר"
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt().coerceAtLeast(1)

    companion object {
        const val EXTRA_TARGET = "target"
    }
}

private class MaskEditorView(
    context: android.content.Context,
    initial: NormalizedMaskRect,
) : View(context) {
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(118, 36, 94, 56)
        style = Paint.Style.FILL
    }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#17472B")
        style = Paint.Style.STROKE
        strokeWidth = dp(3).toFloat()
    }
    private val handlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#BFA15B")
        style = Paint.Style.FILL
    }
    private val shadePaint = Paint().apply {
        color = Color.argb(32, 0, 0, 0)
        style = Paint.Style.FILL
    }

    private var normalized = initial.normalized()
    private val rect = RectF()
    private var lastX = 0f
    private var lastY = 0f
    private var dragMode = DragMode.NONE

    private enum class DragMode { NONE, MOVE, LEFT, RIGHT, TOP, BOTTOM, TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        applyNormalized()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), shadePaint)
        canvas.drawRoundRect(rect, dp(12).toFloat(), dp(12).toFloat(), fillPaint)
        canvas.drawRoundRect(rect, dp(12).toFloat(), dp(12).toFloat(), borderPaint)
        val r = dp(8).toFloat()
        for ((x, y) in handles()) canvas.drawCircle(x, y, r, handlePaint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                dragMode = hitTest(event.x, event.y)
                lastX = event.x
                lastY = event.y
                return dragMode != DragMode.NONE
            }
            MotionEvent.ACTION_MOVE -> {
                if (dragMode == DragMode.NONE) return false
                val dx = event.x - lastX
                val dy = event.y - lastY
                adjust(dx, dy)
                lastX = event.x
                lastY = event.y
                invalidate()
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (dragMode != DragMode.NONE) {
                    normalized = currentNormalized()
                    dragMode = DragMode.NONE
                    invalidate()
                    return true
                }
            }
        }
        return false
    }

    fun getNormalizedRect(): NormalizedMaskRect = currentNormalized()

    fun setNormalizedRect(value: NormalizedMaskRect) {
        normalized = value.normalized()
        applyNormalized()
        invalidate()
    }

    private fun applyNormalized() {
        if (width <= 0 || height <= 0) return
        rect.set(
            normalized.left * width,
            normalized.top * height,
            normalized.right * width,
            normalized.bottom * height,
        )
        enforceBounds()
    }

    private fun currentNormalized(): NormalizedMaskRect {
        if (width <= 0 || height <= 0) return normalized
        return NormalizedMaskRect(
            rect.left / width,
            rect.top / height,
            rect.right / width,
            rect.bottom / height,
        ).normalized()
    }

    private fun hitTest(x: Float, y: Float): DragMode {
        val hit = dp(28).toFloat()
        val nearLeft = abs(x - rect.left) <= hit
        val nearRight = abs(x - rect.right) <= hit
        val nearTop = abs(y - rect.top) <= hit
        val nearBottom = abs(y - rect.bottom) <= hit
        if (nearLeft && nearTop) return DragMode.TOP_LEFT
        if (nearRight && nearTop) return DragMode.TOP_RIGHT
        if (nearLeft && nearBottom) return DragMode.BOTTOM_LEFT
        if (nearRight && nearBottom) return DragMode.BOTTOM_RIGHT
        if (nearLeft && y in (rect.top - hit)..(rect.bottom + hit)) return DragMode.LEFT
        if (nearRight && y in (rect.top - hit)..(rect.bottom + hit)) return DragMode.RIGHT
        if (nearTop && x in (rect.left - hit)..(rect.right + hit)) return DragMode.TOP
        if (nearBottom && x in (rect.left - hit)..(rect.right + hit)) return DragMode.BOTTOM
        if (rect.contains(x, y)) return DragMode.MOVE
        return DragMode.NONE
    }

    private fun adjust(dx: Float, dy: Float) {
        when (dragMode) {
            DragMode.MOVE -> rect.offset(dx, dy)
            DragMode.LEFT -> rect.left += dx
            DragMode.RIGHT -> rect.right += dx
            DragMode.TOP -> rect.top += dy
            DragMode.BOTTOM -> rect.bottom += dy
            DragMode.TOP_LEFT -> { rect.left += dx; rect.top += dy }
            DragMode.TOP_RIGHT -> { rect.right += dx; rect.top += dy }
            DragMode.BOTTOM_LEFT -> { rect.left += dx; rect.bottom += dy }
            DragMode.BOTTOM_RIGHT -> { rect.right += dx; rect.bottom += dy }
            DragMode.NONE -> Unit
        }
        enforceBounds()
    }

    private fun enforceBounds() {
        val minSize = dp(34).toFloat()
        if (rect.width() < minSize) {
            if (dragMode == DragMode.LEFT || dragMode == DragMode.TOP_LEFT || dragMode == DragMode.BOTTOM_LEFT) {
                rect.left = rect.right - minSize
            } else {
                rect.right = rect.left + minSize
            }
        }
        if (rect.height() < minSize) {
            if (dragMode == DragMode.TOP || dragMode == DragMode.TOP_LEFT || dragMode == DragMode.TOP_RIGHT) {
                rect.top = rect.bottom - minSize
            } else {
                rect.bottom = rect.top + minSize
            }
        }

        if (dragMode == DragMode.MOVE) {
            if (rect.left < 0f) rect.offset(-rect.left, 0f)
            if (rect.right > width) rect.offset(width - rect.right, 0f)
            if (rect.top < 0f) rect.offset(0f, -rect.top)
            if (rect.bottom > height) rect.offset(0f, height - rect.bottom)
        } else {
            rect.left = rect.left.coerceIn(0f, width.toFloat())
            rect.right = rect.right.coerceIn(0f, width.toFloat())
            rect.top = rect.top.coerceIn(0f, height.toFloat())
            rect.bottom = rect.bottom.coerceIn(0f, height.toFloat())
            if (rect.width() < minSize) rect.right = min(width.toFloat(), rect.left + minSize)
            if (rect.height() < minSize) rect.bottom = min(height.toFloat(), rect.top + minSize)
        }
    }

    private fun handles(): List<Pair<Float, Float>> = listOf(
        rect.left to rect.top,
        rect.right to rect.top,
        rect.left to rect.bottom,
        rect.right to rect.bottom,
        rect.centerX() to rect.top,
        rect.centerX() to rect.bottom,
        rect.left to rect.centerY(),
        rect.right to rect.centerY(),
    )

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt().coerceAtLeast(1)
}
