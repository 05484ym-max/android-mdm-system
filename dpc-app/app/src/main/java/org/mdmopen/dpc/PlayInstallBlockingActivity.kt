package org.mdmopen.dpc

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import kotlin.concurrent.thread

class PlayInstallBlockingActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var iconView: ImageView
    private lateinit var titleView: TextView
    private lateinit var statusView: TextView
    private lateinit var detailView: TextView
    private lateinit var progress: ProgressBar
    private var finishedAt: Long? = null
    private var loadedPackage: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enterImmersiveMode()
        setContentView(buildUi())
        render()
        handler.post(poll)
    }

    override fun onResume() {
        super.onResume()
        enterImmersiveMode()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val snapshot = PlayInstallStatusStore.snapshot(this)
        if (snapshot == null || snapshot.stage.terminal) super.onBackPressed()
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        val snapshot = PlayInstallStatusStore.snapshot(this)
        if (snapshot != null && !snapshot.stage.terminal) {
            handler.postDelayed({
                runCatching {
                    startActivity(intent.addFlags(android.content.Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
                }
            }, 120L)
        }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private val poll = object : Runnable {
        override fun run() {
            render()
            if (!isFinishing) handler.postDelayed(this, 250L)
        }
    }

    private fun render() {
        val snapshot = PlayInstallStatusStore.snapshot(this) ?: run { finish(); return }
        titleView.text = snapshot.displayName
        statusView.text = snapshot.stage.hebrewLabel
        detailView.text = snapshot.message ?: when (snapshot.stage) {
            PlayInstallStage.PREPARING -> "מכינים את ההתקנה המאובטחת"
            PlayInstallStage.OPENING -> "פותחים את ההורדה המאושרת"
            PlayInstallStage.WAITING -> "Google Play מוריד ומתקין ברקע"
            PlayInstallStage.INSTALLING -> "ההתקנה מתבצעת כעת"
            PlayInstallStage.COMPLETED -> "האפליקציה הותקנה בהצלחה"
            PlayInstallStage.FAILED -> "ההתקנה נסגרה בצורה מאובטחת"
        }
        progress.visibility = if (snapshot.stage.terminal) View.INVISIBLE else View.VISIBLE
        if (snapshot.stage.terminal) {
            if (finishedAt == null) finishedAt = System.currentTimeMillis()
            if (System.currentTimeMillis() - finishedAt!! >= TERMINAL_HOLD_MS) {
                PlayInstallStatusStore.clear(this, snapshot.sessionId)
                finish()
            }
        } else finishedAt = null
        loadIconIfPossible(snapshot.packageName)
    }

    private fun loadIconIfPossible(packageName: String) {
        if (loadedPackage == packageName) return
        loadedPackage = packageName
        thread(name = "play-install-icon", isDaemon = true) {
            val drawable = runCatching { packageManager.getApplicationIcon(packageName) }.getOrNull()
            runOnUiThread {
                if (drawable != null) iconView.setImageDrawable(drawable) else iconView.setImageResource(R.mipmap.ic_launcher)
            }
        }
    }

    private fun buildUi(): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(dp(28), dp(28), dp(28), dp(28))
        setBackgroundColor(Color.parseColor("#F7F2E8"))
        addView(LinearLayout(this@PlayInstallBlockingActivity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(34), dp(28), dp(34))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#FFFDFC"))
                cornerRadius = dp(26).toFloat()
                setStroke(dp(1), Color.parseColor("#E8E1D4"))
            }
            elevation = dp(8).toFloat()
            iconView = ImageView(this@PlayInstallBlockingActivity).apply {
                scaleType = ImageView.ScaleType.CENTER_INSIDE
                setImageResource(R.mipmap.ic_launcher)
            }
            addView(iconView, LinearLayout.LayoutParams(dp(84), dp(84)))
            titleView = TextView(this@PlayInstallBlockingActivity).apply {
                textSize = 22f
                typeface = Typeface.create("sans-serif", Typeface.BOLD)
                setTextColor(Color.parseColor("#1C231D"))
                gravity = Gravity.CENTER
                setPadding(0, dp(20), 0, 0)
            }
            addView(titleView)
            statusView = TextView(this@PlayInstallBlockingActivity).apply {
                textSize = 17f
                typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
                setTextColor(Color.parseColor("#245E38"))
                gravity = Gravity.CENTER
                setPadding(0, dp(12), 0, 0)
            }
            addView(statusView)
            progress = ProgressBar(this@PlayInstallBlockingActivity, null, android.R.attr.progressBarStyleHorizontal).apply {
                isIndeterminate = true
            }
            addView(progress, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(8)).apply { topMargin = dp(24) })
            detailView = TextView(this@PlayInstallBlockingActivity).apply {
                textSize = 13.5f
                setTextColor(Color.parseColor("#85867E"))
                gravity = Gravity.CENTER
                setPadding(0, dp(18), 0, 0)
            }
            addView(detailView)
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    }

    private fun enterImmersiveMode() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object { private const val TERMINAL_HOLD_MS = 1_200L }
}
