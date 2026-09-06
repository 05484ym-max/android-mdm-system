from pathlib import Path
import re

path = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
text = path.read_text(encoding='utf-8')

support_re = re.compile(
    r'    private fun renderSupportTickets\(container: LinearLayout, tickets: List<SupportTicket>\) \{.*?(?=\n    private fun )',
    re.S,
)
new_support = r'''    private fun renderSupportTickets(container: LinearLayout, tickets: List<SupportTicket>) {
        container.removeAllViews()
        if (tickets.isEmpty()) {
            container.addView(TextView(this).apply {
                text = "עדיין לא נשלחו פניות"
                textSize = 14f
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.CENTER
                setPadding(0, dp(24), 0, dp(24))
            })
            return
        }

        tickets.forEach { ticket ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = flatRounded(CARD, dp(18).toFloat())
                setPadding(dp(14), dp(14), dp(14), dp(14))
            }

            val statusText = when (ticket.status) {
                "RESOLVED" -> "טופל"
                "IN_PROGRESS" -> "בטיפול"
                else -> "חדש"
            }
            card.addView(TextView(this).apply {
                text = "${ticket.subject}  ·  $statusText"
                textSize = 15f
                typeface = heavyFont
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.RIGHT
            })

            val chat = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = flatRounded("#F5F4ED", dp(16).toFloat())
                setPadding(dp(10), dp(10), dp(10), dp(10))
            }

            fun addBubble(message: String, sender: String, whenIso: String, mine: Boolean) {
                val row = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = if (mine) Gravity.RIGHT else Gravity.LEFT
                }
                val bubble = TextView(this).apply {
                    text = "$sender\n$message\n${formatUpdateDate(whenIso)}"
                    textSize = 13.5f
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                    background = flatRounded(if (mine) "#DFF1D8" else "#FFFFFF", dp(16).toFloat())
                    setPadding(dp(12), dp(9), dp(12), dp(8))
                }
                row.addView(
                    bubble,
                    LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.84f)
                )
                chat.addView(
                    row,
                    LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = dp(8)
                    }
                )
            }

            addBubble(ticket.message, "אתם", ticket.createdAt, true)
            ticket.adminReply?.takeIf { it.isNotBlank() }?.let {
                addBubble(it, "תמיכה — יהודי כשר", ticket.updatedAt, false)
            }

            card.addView(
                chat,
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(12)
                }
            )
            container.addView(
                card,
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(12)
                }
            )
        }
    }
'''
text, count = support_re.subn(new_support, text, count=1)
if count != 1:
    raise SystemExit(f'expected one renderSupportTickets function, replaced {count}')

media_re = re.compile(
    r'    private fun loadNewsImageSafely\(url: String\): Bitmap\? \{.*?(?=\n    private fun )',
    re.S,
)
new_loader = r'''    private fun loadNewsImageSafely(url: String): Bitmap? {
        val conn = (URL(url).openConnection() as? HttpURLConnection) ?: return null
        return try {
            conn.connectTimeout = 20_000
            conn.readTimeout = 60_000
            conn.instanceFollowRedirects = true
            conn.setRequestProperty("Accept", "image/*")
            conn.setRequestProperty("User-Agent", "YehudiKasher-Android")
            val code = conn.responseCode
            if (code !in 200..299) return null
            val declared = conn.contentLengthLong
            if (declared > 10L * 1024L * 1024L) return null
            val bytes = conn.inputStream.use { input ->
                val out = ByteArrayOutputStream()
                val buffer = ByteArray(16 * 1024)
                var total = 0
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    total += read
                    if (total > 10 * 1024 * 1024) return null
                    out.write(buffer, 0, read)
                }
                out.toByteArray()
            }
            if (bytes.isEmpty()) null else BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (_: Exception) {
            null
        } finally {
            conn.disconnect()
        }
    }
'''
text, count = media_re.subn(new_loader, text, count=1)
if count != 1:
    raise SystemExit(f'expected one loadNewsImageSafely function, replaced {count}')

# Ensure a remote news image has visible space while it loads; previously the
# empty ImageView could collapse to zero height until decoding completed.
news_re = re.compile(
    r'(private fun addNewsMedia\(container: LinearLayout, item: UpdateItem, detail: Boolean\) \{.*?)(?=\n    private fun )',
    re.S,
)
m = news_re.search(text)
if not m:
    raise SystemExit('addNewsMedia function not found')
block = m.group(1)
needle = 'adjustViewBounds = true\n                    scaleType = ImageView.ScaleType.FIT_CENTER'
if needle not in block:
    raise SystemExit('news ImageView marker not found')
block = block.replace(
    needle,
    'adjustViewBounds = true\n                    minimumHeight = dp(if (detail) 260 else 170)\n                    scaleType = ImageView.ScaleType.FIT_CENTER',
    1,
)
text = text[:m.start(1)] + block + text[m.end(1):]

path.write_text(text, encoding='utf-8')
print('patched CustomerActivity.kt: support chat bubbles + resilient news images')
