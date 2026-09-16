from pathlib import Path


def edit(path, old, new, count=1):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    found = text.count(old)
    if found < count:
        raise SystemExit(f'{path}: expected at least {count} occurrence(s), found {found}: {old[:100]!r}')
    text = text.replace(old, new, count)
    p.write_text(text, encoding='utf-8')

# ---------- PostgreSQL persistence ----------
edit('backend/db.js',
'''  media_size_bytes  BIGINT,\n  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),''',
'''  media_size_bytes  BIGINT,\n  bubble_width_percent INTEGER NOT NULL DEFAULT 88 CHECK (bubble_width_percent BETWEEN 55 AND 100),\n  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),''')
edit('backend/db.js',
'''ALTER TABLE customer_updates ADD COLUMN IF NOT EXISTS media_size_bytes BIGINT;''',
'''ALTER TABLE customer_updates ADD COLUMN IF NOT EXISTS media_size_bytes BIGINT;\nALTER TABLE customer_updates ADD COLUMN IF NOT EXISTS bubble_width_percent INTEGER NOT NULL DEFAULT 88 CHECK (bubble_width_percent BETWEEN 55 AND 100);''')
edit('backend/db.js',
'''    mediaSizeBytes: row.media_size_bytes == null ? null : Number(row.media_size_bytes),\n    createdAt:''',
'''    mediaSizeBytes: row.media_size_bytes == null ? null : Number(row.media_size_bytes),\n    bubbleWidthPercent: Number(row.bubble_width_percent || 88),\n    createdAt:''')
edit('backend/db.js',
'''  mediaMimeType = null, mediaSizeBytes = null,\n}) {''',
'''  mediaMimeType = null, mediaSizeBytes = null, bubbleWidthPercent = 88,\n}) {''')
edit('backend/db.js',
'''       media_type, media_url, media_storage_key, media_mime_type, media_size_bytes\n     )''',
'''       media_type, media_url, media_storage_key, media_mime_type, media_size_bytes, bubble_width_percent\n     )''')
edit('backend/db.js',
'''       $6, $7, $8, $9, $10\n     )''',
'''       $6, $7, $8, $9, $10, $11\n     )''')
edit('backend/db.js',
'''      mediaType, mediaUrl, mediaStorageKey, mediaMimeType, mediaSizeBytes,\n    ],''',
'''      mediaType, mediaUrl, mediaStorageKey, mediaMimeType, mediaSizeBytes, bubbleWidthPercent,\n    ],''')
edit('backend/db.js',
'''    ['mediaSizeBytes', 'media_size_bytes'],\n  ]) {''',
'''    ['mediaSizeBytes', 'media_size_bytes'],\n    ['bubbleWidthPercent', 'bubble_width_percent'],\n  ]) {''')
edit('backend/db.js',
'''    `SELECT id, title, body, pinned, media_type, media_url,\n            media_mime_type, media_size_bytes, published_at, created_at''',
'''    `SELECT id, title, body, pinned, media_type, media_url,\n            media_mime_type, media_size_bytes, bubble_width_percent, published_at, created_at''')
# Second mediaSizeBytes mapper is device-facing; first was admin mapper above.
edit('backend/db.js',
'''    mediaSizeBytes: row.media_size_bytes == null ? null : Number(row.media_size_bytes),\n    // Guaranteed non-null for a published row''',
'''    mediaSizeBytes: row.media_size_bytes == null ? null : Number(row.media_size_bytes),\n    bubbleWidthPercent: Number(row.bubble_width_percent || 88),\n    // Guaranteed non-null for a published row''')

# ---------- Backend validation/API ----------
edit('backend/index.js',
'''const UPDATE_LIST_LIMIT_FOR_DEVICE = 50;''',
'''const UPDATE_LIST_LIMIT_FOR_DEVICE = 50;\nconst NEWS_BUBBLE_WIDTH_DEFAULT = 88;\nconst NEWS_BUBBLE_WIDTH_MIN = 55;\nconst NEWS_BUBBLE_WIDTH_MAX = 100;''')
edit('backend/index.js',
'''function parseNewsBoolean(value, fallback) {\n  if (value === undefined) return fallback;\n  if (typeof value === 'boolean') return value;\n  if (value === 'true') return true;\n  if (value === 'false') return false;\n  return null;\n}\n''',
'''function parseNewsBoolean(value, fallback) {\n  if (value === undefined) return fallback;\n  if (typeof value === 'boolean') return value;\n  if (value === 'true') return true;\n  if (value === 'false') return false;\n  return null;\n}\n\nfunction parseNewsBubbleWidth(value, fallback = NEWS_BUBBLE_WIDTH_DEFAULT) {\n  if (value === undefined || value === null || value === '') return fallback;\n  const parsed = Number(value);\n  return Number.isInteger(parsed) && parsed >= NEWS_BUBBLE_WIDTH_MIN && parsed <= NEWS_BUBBLE_WIDTH_MAX\n    ? parsed\n    : null;\n}\n''')
edit('backend/index.js',
'''  const pinned = parseNewsBoolean(req.body && req.body.pinned, false);\n  const published = parseNewsBoolean(req.body && req.body.published, false);''',
'''  const pinned = parseNewsBoolean(req.body && req.body.pinned, false);\n  const published = parseNewsBoolean(req.body && req.body.published, false);\n  const bubbleWidthPercent = parseNewsBubbleWidth(req.body && req.body.bubbleWidthPercent);''')
edit('backend/index.js',
'''  if (published === null) return res.status(400).json({ error: 'published must be a boolean' });\n\n  let media = null;''',
'''  if (published === null) return res.status(400).json({ error: 'published must be a boolean' });\n  if (bubbleWidthPercent === null) {\n    return res.status(400).json({ error: `bubbleWidthPercent must be an integer between ${NEWS_BUBBLE_WIDTH_MIN} and ${NEWS_BUBBLE_WIDTH_MAX}` });\n  }\n\n  let media = null;''')
edit('backend/index.js',
'''      pinned,\n      published,\n      ...(media || {}),''',
'''      pinned,\n      published,\n      bubbleWidthPercent,\n      ...(media || {}),''')
edit('backend/index.js',
'''  if (req.body.pinned !== undefined) {\n    const pinned = parseNewsBoolean(req.body.pinned, false);\n    if (pinned === null) return res.status(400).json({ error: 'pinned must be a boolean' });\n    patch.pinned = pinned;\n  }\n  const removeMedia''',
'''  if (req.body.pinned !== undefined) {\n    const pinned = parseNewsBoolean(req.body.pinned, false);\n    if (pinned === null) return res.status(400).json({ error: 'pinned must be a boolean' });\n    patch.pinned = pinned;\n  }\n  if (req.body.bubbleWidthPercent !== undefined) {\n    const bubbleWidthPercent = parseNewsBubbleWidth(req.body.bubbleWidthPercent);\n    if (bubbleWidthPercent === null) {\n      return res.status(400).json({ error: `bubbleWidthPercent must be an integer between ${NEWS_BUBBLE_WIDTH_MIN} and ${NEWS_BUBBLE_WIDTH_MAX}` });\n    }\n    patch.bubbleWidthPercent = bubbleWidthPercent;\n  }\n  const removeMedia''')

# ---------- Admin panel controls ----------
edit('admin-panel/index.html',
'''    <textarea class="login-input news-textarea" id="newsBodyInput" placeholder="תוכן ההודעה (טקסט רגיל בלבד)" maxlength="20000"></textarea>''',
'''    <textarea class="login-input news-textarea" id="newsBodyInput" placeholder="תוכן ההודעה (טקסט רגיל בלבד)" maxlength="20000"></textarea>\n    <div class="news-width-field">\n      <label for="newsBubbleWidthInput" class="news-media-label">רוחב בועת ההודעה</label>\n      <div class="news-width-controls">\n        <input type="range" id="newsBubbleWidthInput" min="55" max="100" step="1" value="88" />\n        <input type="number" class="login-input news-width-number" id="newsBubbleWidthNumber" min="55" max="100" step="1" value="88" inputmode="numeric" />\n        <span class="news-width-percent">%</span>\n      </div>\n      <div class="news-media-help">55%–100% · ברירת מחדל 88%. התמונה או הסרטון יתאימו אוטומטית לרוחב הבועה.</div>\n    </div>''')

edit('admin-panel/news.js',
'''  const removeMediaInput = document.getElementById('newsRemoveMediaInput');\n  if (!listEl || !titleInput || !bodyInput || !pinnedInput || !publishedInput || !saveBtn || !cancelEditBtn || !formTitle || !formError || !mediaInput || !mediaPreview || !removeMediaRow || !removeMediaInput) return;''',
'''  const removeMediaInput = document.getElementById('newsRemoveMediaInput');\n  const bubbleWidthInput = document.getElementById('newsBubbleWidthInput');\n  const bubbleWidthNumber = document.getElementById('newsBubbleWidthNumber');\n  if (!listEl || !titleInput || !bodyInput || !pinnedInput || !publishedInput || !saveBtn || !cancelEditBtn || !formTitle || !formError || !mediaInput || !mediaPreview || !removeMediaRow || !removeMediaInput || !bubbleWidthInput || !bubbleWidthNumber) return;''')
edit('admin-panel/news.js',
'''  const mediaLabel = document.querySelector('label[for="newsMediaInput"]');\n  if (mediaLabel) mediaLabel.textContent = '📎 צרף תמונה או סרטון';''',
'''  const mediaLabel = document.querySelector('label[for="newsMediaInput"]');\n  if (mediaLabel) mediaLabel.textContent = '📎 צרף תמונה או סרטון';\n  const clampBubbleWidth = value => Math.max(55, Math.min(100, Number.parseInt(value, 10) || 88));\n  function applyBubblePreviewWidth(value) {\n    const width = clampBubbleWidth(value);\n    mediaPreview.style.width = `${width}%`;\n    mediaPreview.style.marginInlineStart = 'auto';\n  }\n  function setBubbleWidth(value) {\n    const width = clampBubbleWidth(value);\n    bubbleWidthInput.value = String(width);\n    bubbleWidthNumber.value = String(width);\n    applyBubblePreviewWidth(width);\n  }''')
edit('admin-panel/news.js',
'''    titleInput.value = ''; bodyInput.value = ''; pinnedInput.checked = false; publishedInput.checked = false; publishedInput.disabled = false;''',
'''    titleInput.value = ''; bodyInput.value = ''; pinnedInput.checked = false; publishedInput.checked = false; publishedInput.disabled = false; setBubbleWidth(88);''')
edit('admin-panel/news.js',
'''    titleInput.value = item.title; bodyInput.value = item.body; pinnedInput.checked = item.pinned; publishedInput.checked = item.published; publishedInput.disabled = true;''',
'''    titleInput.value = item.title; bodyInput.value = item.body; pinnedInput.checked = item.pinned; publishedInput.checked = item.published; publishedInput.disabled = true; setBubbleWidth(item.bubbleWidthPercent || 88);''')
edit('admin-panel/news.js',
'''  cancelEditBtn.addEventListener('click', resetForm);''',
'''  cancelEditBtn.addEventListener('click', resetForm);\n  bubbleWidthInput.addEventListener('input', () => setBubbleWidth(bubbleWidthInput.value));\n  bubbleWidthNumber.addEventListener('input', () => {\n    const numeric = Number.parseInt(bubbleWidthNumber.value, 10);\n    if (Number.isInteger(numeric) && numeric >= 55 && numeric <= 100) {\n      bubbleWidthInput.value = String(numeric);\n      applyBubblePreviewWidth(numeric);\n    }\n  });\n  bubbleWidthNumber.addEventListener('change', () => setBubbleWidth(bubbleWidthNumber.value));''')
edit('admin-panel/news.js',
'''    const form = new FormData(); form.append('title', title); form.append('body', body); form.append('pinned', String(pinnedInput.checked));''',
'''    const form = new FormData(); form.append('title', title); form.append('body', body); form.append('pinned', String(pinnedInput.checked)); form.append('bubbleWidthPercent', String(clampBubbleWidth(bubbleWidthNumber.value)));''')
edit('admin-panel/news.js',
'''  refreshBtn?.addEventListener('click', loadNews);\n})();''',
'''  refreshBtn?.addEventListener('click', loadNews);\n  setBubbleWidth(88);\n})();''')

with Path('admin-panel/news.css').open('a', encoding='utf-8') as f:
    f.write('''\n\n/* Per-message news bubble width control. */\n.news-width-field {\n  margin: 10px 0 12px; padding: 12px; border: 1px solid var(--card-border);\n  border-radius: 14px; background: var(--bg);\n}\n.news-width-controls { display:flex; align-items:center; gap:10px; direction:ltr; }\n#newsBubbleWidthInput { flex:1; min-width:120px; accent-color:var(--accent); }\n.news-width-number { width:82px; margin:0; text-align:center; direction:ltr; }\n.news-width-percent { font-weight:800; color:var(--accent); }\n''')

# ---------- Android API/cache/model ----------
edit('dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt',
'''    val mediaMimeType: String? = null,\n    val mediaSizeBytes: Long? = null,\n)''',
'''    val mediaMimeType: String? = null,\n    val mediaSizeBytes: Long? = null,\n    val bubbleWidthPercent: Int = 88,\n)''')
edit('dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt',
'''                mediaMimeType = if (item.isNull("mediaMimeType")) null else item.optString("mediaMimeType", null),\n                mediaSizeBytes = if (item.isNull("mediaSizeBytes")) null else item.optLong("mediaSizeBytes"),\n            )''',
'''                mediaMimeType = if (item.isNull("mediaMimeType")) null else item.optString("mediaMimeType", null),\n                mediaSizeBytes = if (item.isNull("mediaSizeBytes")) null else item.optLong("mediaSizeBytes"),\n                bubbleWidthPercent = item.optInt("bubbleWidthPercent", 88).coerceIn(55, 100),\n            )''')

edit('dpc-app/app/src/main/java/org/mdmopen/dpc/Config.kt',
'''                mediaMimeType = if (item.isNull("mediaMimeType")) null else item.optString("mediaMimeType", null),\n                mediaSizeBytes = if (item.isNull("mediaSizeBytes")) null else item.optLong("mediaSizeBytes"),\n            )\n        }\n    }\n\n    fun setNewsCache''',
'''                mediaMimeType = if (item.isNull("mediaMimeType")) null else item.optString("mediaMimeType", null),\n                mediaSizeBytes = if (item.isNull("mediaSizeBytes")) null else item.optLong("mediaSizeBytes"),\n                bubbleWidthPercent = item.optInt("bubbleWidthPercent", 88).coerceIn(55, 100),\n            )\n        }\n    }\n\n    fun setNewsCache''')
edit('dpc-app/app/src/main/java/org/mdmopen/dpc/Config.kt',
'''                    .put("mediaMimeType", item.mediaMimeType)\n                    .put("mediaSizeBytes", item.mediaSizeBytes)''',
'''                    .put("mediaMimeType", item.mediaMimeType)\n                    .put("mediaSizeBytes", item.mediaSizeBytes)\n                    .put("bubbleWidthPercent", item.bubbleWidthPercent)''')

# ---------- Android rendering ----------
edit('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt',
'''        addNewsMedia(detailCard, item, true)\n        contentArea.addView(detailCard)''',
'''        addNewsMedia(detailCard, item, true)\n        contentArea.addView(detailCard, newsBubbleLayoutParams(item, bottomMarginDp = 0))''')
edit('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt',
'''            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(11) }''',
'''            layoutParams = newsBubbleLayoutParams(item, bottomMarginDp = 11)''')
edit('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt',
'''    private fun addNewsMedia(container: LinearLayout, item: UpdateItem, detail: Boolean) {''',
'''    private fun newsBubbleLayoutParams(item: UpdateItem, bottomMarginDp: Int): LinearLayout.LayoutParams {\n        val percent = item.bubbleWidthPercent.coerceIn(55, 100)\n        val availableWidth = (resources.displayMetrics.widthPixels - contentArea.paddingLeft - contentArea.paddingRight)\n            .coerceAtLeast(dp(220))\n        val width = (availableWidth * (percent / 100f)).toInt().coerceAtLeast(dp(180))\n        return LinearLayout.LayoutParams(width, ViewGroup.LayoutParams.WRAP_CONTENT).apply {\n            gravity = Gravity.RIGHT\n            bottomMargin = dp(bottomMarginDp)\n        }\n    }\n\n    private fun addNewsMedia(container: LinearLayout, item: UpdateItem, detail: Boolean) {''')

# ---------- Static regression test wired into npm test ----------
Path('backend/test-news-bubble-width-static.js').write_text(r'''const fs = require('fs');
const assert = require('assert');
const read = p => fs.readFileSync(p, 'utf8');

const index = read('index.js');
const db = read('db.js');
const admin = read('../admin-panel/news.js');
const html = read('../admin-panel/index.html');
const api = read('../dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt');
const config = read('../dpc-app/app/src/main/java/org/mdmopen/dpc/Config.kt');
const activity = read('../dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt');

assert(index.includes('NEWS_BUBBLE_WIDTH_MIN = 55'));
assert(index.includes('NEWS_BUBBLE_WIDTH_MAX = 100'));
assert(index.includes('patch.bubbleWidthPercent = bubbleWidthPercent'));
assert(db.includes('bubble_width_percent INTEGER NOT NULL DEFAULT 88'));
assert(db.includes("['bubbleWidthPercent', 'bubble_width_percent']"));
assert(html.includes('id="newsBubbleWidthInput"'));
assert(html.includes('id="newsBubbleWidthNumber"'));
assert(admin.includes("form.append('bubbleWidthPercent'"));
assert(api.includes('val bubbleWidthPercent: Int = 88'));
assert(config.includes('.put("bubbleWidthPercent", item.bubbleWidthPercent)'));
assert(activity.includes('newsBubbleLayoutParams(item'));
assert(activity.includes('percent = item.bubbleWidthPercent.coerceIn(55, 100)'));
console.log('news bubble width wiring: ok');
''', encoding='utf-8')

edit('backend/package.json',
'''node --check push.js\"''',
'''node --check push.js && node test-news-bubble-width-static.js\"''')

print('news bubble width patch applied successfully')
