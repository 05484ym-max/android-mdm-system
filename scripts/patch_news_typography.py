from pathlib import Path


def repl(path, old, new, count=1):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:120]!r}')
    s = s.replace(old, new, count)
    p.write_text(s)

# backend/db.js
repl('backend/db.js',
"  bubble_width_percent INTEGER NOT NULL DEFAULT 88 CHECK (bubble_width_percent BETWEEN 55 AND 100),\n",
"  bubble_width_percent INTEGER NOT NULL DEFAULT 88 CHECK (bubble_width_percent BETWEEN 55 AND 100),\n  font_scale_percent INTEGER NOT NULL DEFAULT 100 CHECK (font_scale_percent BETWEEN 80 AND 150),\n  font_family TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (font_family IN ('SYSTEM','ROUNDED','SERIF','MONO')),\n")
repl('backend/db.js',
"ALTER TABLE customer_updates ADD COLUMN IF NOT EXISTS bubble_width_percent INTEGER NOT NULL DEFAULT 88 CHECK (bubble_width_percent BETWEEN 55 AND 100);\n",
"ALTER TABLE customer_updates ADD COLUMN IF NOT EXISTS bubble_width_percent INTEGER NOT NULL DEFAULT 88 CHECK (bubble_width_percent BETWEEN 55 AND 100);\nALTER TABLE customer_updates ADD COLUMN IF NOT EXISTS font_scale_percent INTEGER NOT NULL DEFAULT 100 CHECK (font_scale_percent BETWEEN 80 AND 150);\nALTER TABLE customer_updates ADD COLUMN IF NOT EXISTS font_family TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (font_family IN ('SYSTEM','ROUNDED','SERIF','MONO'));\n")
repl('backend/db.js',
"    bubbleWidthPercent: Number(row.bubble_width_percent || 88),\n",
"    bubbleWidthPercent: Number(row.bubble_width_percent || 88),\n    fontScalePercent: Number(row.font_scale_percent || 100),\n    fontFamily: row.font_family || 'SYSTEM',\n", 1)
repl('backend/db.js',
"  mediaMimeType = null, mediaSizeBytes = null, bubbleWidthPercent = 88,\n",
"  mediaMimeType = null, mediaSizeBytes = null, bubbleWidthPercent = 88,\n  fontScalePercent = 100, fontFamily = 'SYSTEM',\n")
repl('backend/db.js',
"       media_type, media_url, media_storage_key, media_mime_type, media_size_bytes, bubble_width_percent\n",
"       media_type, media_url, media_storage_key, media_mime_type, media_size_bytes, bubble_width_percent, font_scale_percent, font_family\n")
repl('backend/db.js',
"       $6, $7, $8, $9, $10, $11\n",
"       $6, $7, $8, $9, $10, $11, $12, $13\n")
repl('backend/db.js',
"      mediaType, mediaUrl, mediaStorageKey, mediaMimeType, mediaSizeBytes, bubbleWidthPercent,\n",
"      mediaType, mediaUrl, mediaStorageKey, mediaMimeType, mediaSizeBytes, bubbleWidthPercent, fontScalePercent, fontFamily,\n")
repl('backend/db.js',
"    ['bubbleWidthPercent', 'bubble_width_percent'],\n",
"    ['bubbleWidthPercent', 'bubble_width_percent'],\n    ['fontScalePercent', 'font_scale_percent'],\n    ['fontFamily', 'font_family'],\n")
repl('backend/db.js',
"            media_mime_type, media_size_bytes, bubble_width_percent, published_at, created_at\n",
"            media_mime_type, media_size_bytes, bubble_width_percent, font_scale_percent, font_family, published_at, created_at\n")
# second occurrence in device map
needle = "    bubbleWidthPercent: Number(row.bubble_width_percent || 88),\n    // Guaranteed non-null"
repl('backend/db.js', needle,
"    bubbleWidthPercent: Number(row.bubble_width_percent || 88),\n    fontScalePercent: Number(row.font_scale_percent || 100),\n    fontFamily: row.font_family || 'SYSTEM',\n    // Guaranteed non-null")

# backend/index.js
repl('backend/index.js',
"const NEWS_BUBBLE_WIDTH_MAX = 100;\n",
"const NEWS_BUBBLE_WIDTH_MAX = 100;\nconst NEWS_FONT_SCALE_DEFAULT = 100;\nconst NEWS_FONT_SCALE_MIN = 80;\nconst NEWS_FONT_SCALE_MAX = 150;\nconst NEWS_FONT_FAMILIES = new Set(['SYSTEM', 'ROUNDED', 'SERIF', 'MONO']);\n")
repl('backend/index.js',
"async function uploadNewsMedia(req, file) {\n",
"function parseNewsFontScale(value, fallback = NEWS_FONT_SCALE_DEFAULT) {\n  if (value === undefined || value === null || value === '') return fallback;\n  const parsed = Number(value);\n  return Number.isInteger(parsed) && parsed >= NEWS_FONT_SCALE_MIN && parsed <= NEWS_FONT_SCALE_MAX ? parsed : null;\n}\n\nfunction parseNewsFontFamily(value, fallback = 'SYSTEM') {\n  if (value === undefined || value === null || value === '') return fallback;\n  const normalized = String(value).trim().toUpperCase();\n  return NEWS_FONT_FAMILIES.has(normalized) ? normalized : null;\n}\n\nasync function uploadNewsMedia(req, file) {\n")
repl('backend/index.js',
"  const bubbleWidthPercent = parseNewsBubbleWidth(req.body && req.body.bubbleWidthPercent);\n",
"  const bubbleWidthPercent = parseNewsBubbleWidth(req.body && req.body.bubbleWidthPercent);\n  const fontScalePercent = parseNewsFontScale(req.body && req.body.fontScalePercent);\n  const fontFamily = parseNewsFontFamily(req.body && req.body.fontFamily);\n")
repl('backend/index.js',
"  if (bubbleWidthPercent === null) {\n    return res.status(400).json({ error: `bubbleWidthPercent must be an integer between ${NEWS_BUBBLE_WIDTH_MIN} and ${NEWS_BUBBLE_WIDTH_MAX}` });\n  }\n",
"  if (bubbleWidthPercent === null) {\n    return res.status(400).json({ error: `bubbleWidthPercent must be an integer between ${NEWS_BUBBLE_WIDTH_MIN} and ${NEWS_BUBBLE_WIDTH_MAX}` });\n  }\n  if (fontScalePercent === null) {\n    return res.status(400).json({ error: `fontScalePercent must be an integer between ${NEWS_FONT_SCALE_MIN} and ${NEWS_FONT_SCALE_MAX}` });\n  }\n  if (fontFamily === null) return res.status(400).json({ error: 'invalid fontFamily' });\n", 1)
repl('backend/index.js',
"      bubbleWidthPercent,\n      ...(media || {}),\n",
"      bubbleWidthPercent,\n      fontScalePercent,\n      fontFamily,\n      ...(media || {}),\n")
repl('backend/index.js',
"    patch.bubbleWidthPercent = bubbleWidthPercent;\n  }\n  const removeMedia = parseNewsBoolean(req.body.removeMedia, false);\n",
"    patch.bubbleWidthPercent = bubbleWidthPercent;\n  }\n  if (req.body.fontScalePercent !== undefined) {\n    const fontScalePercent = parseNewsFontScale(req.body.fontScalePercent);\n    if (fontScalePercent === null) {\n      return res.status(400).json({ error: `fontScalePercent must be an integer between ${NEWS_FONT_SCALE_MIN} and ${NEWS_FONT_SCALE_MAX}` });\n    }\n    patch.fontScalePercent = fontScalePercent;\n  }\n  if (req.body.fontFamily !== undefined) {\n    const fontFamily = parseNewsFontFamily(req.body.fontFamily);\n    if (fontFamily === null) return res.status(400).json({ error: 'invalid fontFamily' });\n    patch.fontFamily = fontFamily;\n  }\n  const removeMedia = parseNewsBoolean(req.body.removeMedia, false);\n")

# admin-panel/index.html
repl('admin-panel/index.html',
"    <div class=\"news-media-field\">\n",
"    <div class=\"news-typography-field\">\n      <label for=\"newsFontScaleInput\" class=\"news-media-label\">גודל גופן</label>\n      <div class=\"news-width-controls\">\n        <input type=\"range\" id=\"newsFontScaleInput\" min=\"80\" max=\"150\" step=\"5\" value=\"100\" />\n        <input type=\"number\" class=\"login-input news-width-number\" id=\"newsFontScaleNumber\" min=\"80\" max=\"150\" step=\"5\" value=\"100\" inputmode=\"numeric\" />\n        <span class=\"news-width-percent\">%</span>\n      </div>\n      <label for=\"newsFontFamilyInput\" class=\"news-media-label\" style=\"margin-top:10px\">סגנון גופן</label>\n      <select id=\"newsFontFamilyInput\" class=\"login-input\">\n        <option value=\"SYSTEM\">רגיל</option>\n        <option value=\"ROUNDED\">מעוגל</option>\n        <option value=\"SERIF\">קלאסי</option>\n        <option value=\"MONO\">מונוספייס</option>\n      </select>\n      <div class=\"news-media-help\">השינוי מוצג מיד בתצוגה המקדימה ונשמר לכל הודעה.</div>\n    </div>\n    <div class=\"news-media-field\">\n", 1)

# admin-panel/news.js
repl('admin-panel/news.js',
"  const bubbleWidthNumber = document.getElementById('newsBubbleWidthNumber');\n  const mediaField = mediaInput && mediaInput.closest('.news-media-field');\n",
"  const bubbleWidthNumber = document.getElementById('newsBubbleWidthNumber');\n  const fontScaleInput = document.getElementById('newsFontScaleInput');\n  const fontScaleNumber = document.getElementById('newsFontScaleNumber');\n  const fontFamilyInput = document.getElementById('newsFontFamilyInput');\n  const mediaField = mediaInput && mediaInput.closest('.news-media-field');\n")
repl('admin-panel/news.js',
"  if (!listEl || !titleInput || !bodyInput || !pinnedInput || !publishedInput || !saveBtn || !cancelEditBtn || !formTitle || !formError || !mediaInput || !mediaPreview || !removeMediaRow || !removeMediaInput || !bubbleWidthInput || !bubbleWidthNumber) return;\n",
"  if (!listEl || !titleInput || !bodyInput || !pinnedInput || !publishedInput || !saveBtn || !cancelEditBtn || !formTitle || !formError || !mediaInput || !mediaPreview || !removeMediaRow || !removeMediaInput || !bubbleWidthInput || !bubbleWidthNumber || !fontScaleInput || !fontScaleNumber || !fontFamilyInput) return;\n")
repl('admin-panel/news.js',
"  const clampBubbleWidth = value => Math.max(55, Math.min(100, Number.parseInt(value, 10) || 88));\n",
"  const clampBubbleWidth = value => Math.max(55, Math.min(100, Number.parseInt(value, 10) || 88));\n  const clampFontScale = value => Math.max(80, Math.min(150, Number.parseInt(value, 10) || 100));\n  const fontCss = value => ({ SYSTEM: 'inherit', ROUNDED: 'ui-rounded, Arial, sans-serif', SERIF: 'Georgia, Times New Roman, serif', MONO: 'ui-monospace, Consolas, monospace' }[value] || 'inherit');\n")
repl('admin-panel/news.js',
"    liveBubble.style.width = `${clampBubbleWidth(bubbleWidthNumber.value)}%`;\n",
"    liveBubble.style.width = `${clampBubbleWidth(bubbleWidthNumber.value)}%`;\n    const fontScale = clampFontScale(fontScaleNumber.value) / 100;\n    liveTitle.style.fontSize = `${0.98 * fontScale}rem`;\n    liveBody.style.fontSize = `${0.88 * fontScale}rem`;\n    liveBubble.style.fontFamily = fontCss(fontFamilyInput.value);\n")
repl('admin-panel/news.js',
"  function requireLogin() { const el = document.getElementById('loginScreen'); if (el) el.style.display = 'flex'; }\n",
"  function setTypography(scale, family) {\n    const safeScale = clampFontScale(scale);\n    fontScaleInput.value = String(safeScale);\n    fontScaleNumber.value = String(safeScale);\n    fontFamilyInput.value = ['SYSTEM','ROUNDED','SERIF','MONO'].includes(String(family || '').toUpperCase()) ? String(family).toUpperCase() : 'SYSTEM';\n    renderLivePreview();\n  }\n\n  function requireLogin() { const el = document.getElementById('loginScreen'); if (el) el.style.display = 'flex'; }\n")
repl('admin-panel/news.js',
"    titleInput.value = ''; bodyInput.value = ''; pinnedInput.checked = false; publishedInput.checked = false; publishedInput.disabled = false; setBubbleWidth(88);\n",
"    titleInput.value = ''; bodyInput.value = ''; pinnedInput.checked = false; publishedInput.checked = false; publishedInput.disabled = false; setBubbleWidth(88); setTypography(100, 'SYSTEM');\n")
repl('admin-panel/news.js',
"    titleInput.value = item.title; bodyInput.value = item.body; pinnedInput.checked = item.pinned; publishedInput.checked = item.published; publishedInput.disabled = true; setBubbleWidth(item.bubbleWidthPercent || 88);\n",
"    titleInput.value = item.title; bodyInput.value = item.body; pinnedInput.checked = item.pinned; publishedInput.checked = item.published; publishedInput.disabled = true; setBubbleWidth(item.bubbleWidthPercent || 88); setTypography(item.fontScalePercent || 100, item.fontFamily || 'SYSTEM');\n")
repl('admin-panel/news.js',
"  bubbleWidthNumber.addEventListener('change', () => setBubbleWidth(bubbleWidthNumber.value));\n  titleInput.addEventListener('input', renderLivePreview);\n",
"  bubbleWidthNumber.addEventListener('change', () => setBubbleWidth(bubbleWidthNumber.value));\n  fontScaleInput.addEventListener('input', () => setTypography(fontScaleInput.value, fontFamilyInput.value));\n  fontScaleNumber.addEventListener('input', () => {\n    const numeric = Number.parseInt(fontScaleNumber.value, 10);\n    if (Number.isInteger(numeric) && numeric >= 80 && numeric <= 150) { fontScaleInput.value = String(numeric); renderLivePreview(); }\n  });\n  fontScaleNumber.addEventListener('change', () => setTypography(fontScaleNumber.value, fontFamilyInput.value));\n  fontFamilyInput.addEventListener('change', renderLivePreview);\n  titleInput.addEventListener('input', renderLivePreview);\n")
repl('admin-panel/news.js',
"    const form = new FormData(); form.append('title', title); form.append('body', body); form.append('pinned', String(pinnedInput.checked)); form.append('bubbleWidthPercent', String(clampBubbleWidth(bubbleWidthNumber.value)));\n",
"    const form = new FormData(); form.append('title', title); form.append('body', body); form.append('pinned', String(pinnedInput.checked)); form.append('bubbleWidthPercent', String(clampBubbleWidth(bubbleWidthNumber.value))); form.append('fontScalePercent', String(clampFontScale(fontScaleNumber.value))); form.append('fontFamily', fontFamilyInput.value);\n")
repl('admin-panel/news.js',
"  setBubbleWidth(88);\n  renderLivePreview();\n",
"  setBubbleWidth(88);\n  setTypography(100, 'SYSTEM');\n  renderLivePreview();\n")

# admin-panel/news.css
p = Path('admin-panel/news.css')
c = p.read_text()
c += """

/* Per-message news typography controls. */
.news-typography-field {
  margin:10px 0 12px; padding:12px; border:1px solid var(--card-border);
  border-radius:14px; background:var(--bg);
}
#newsFontScaleInput { flex:1; min-width:120px; accent-color:var(--accent); }
#newsFontFamilyInput { margin-bottom:0; }
"""
p.write_text(c)

# Android API/cache
repl('dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt',
"    val bubbleWidthPercent: Int = 88,\n",
"    val bubbleWidthPercent: Int = 88,\n    val fontScalePercent: Int = 100,\n    val fontFamily: String = \"SYSTEM\",\n")
repl('dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt',
"                bubbleWidthPercent = item.optInt(\"bubbleWidthPercent\", 88).coerceIn(55, 100),\n",
"                bubbleWidthPercent = item.optInt(\"bubbleWidthPercent\", 88).coerceIn(55, 100),\n                fontScalePercent = item.optInt(\"fontScalePercent\", 100).coerceIn(80, 150),\n                fontFamily = item.optString(\"fontFamily\", \"SYSTEM\"),\n")
repl('dpc-app/app/src/main/java/org/mdmopen/dpc/Config.kt',
"                bubbleWidthPercent = item.optInt(\"bubbleWidthPercent\", 88).coerceIn(55, 100),\n",
"                bubbleWidthPercent = item.optInt(\"bubbleWidthPercent\", 88).coerceIn(55, 100),\n                fontScalePercent = item.optInt(\"fontScalePercent\", 100).coerceIn(80, 150),\n                fontFamily = item.optString(\"fontFamily\", \"SYSTEM\"),\n")
repl('dpc-app/app/src/main/java/org/mdmopen/dpc/Config.kt',
"                    .put(\"bubbleWidthPercent\", item.bubbleWidthPercent)\n",
"                    .put(\"bubbleWidthPercent\", item.bubbleWidthPercent)\n                    .put(\"fontScalePercent\", item.fontScalePercent)\n                    .put(\"fontFamily\", item.fontFamily)\n")

# Android rendering helpers and usage
repl('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt',
"            textSize = 19f\n            typeface = heavyFont\n",
"            textSize = newsTextSize(19f, item)\n            typeface = newsTypeface(item, bold = true)\n", 1)
repl('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt',
"                textSize = 14.5f\n                typeface = mediumFont\n",
"                textSize = newsTextSize(14.5f, item)\n                typeface = newsTypeface(item, bold = false)\n", 1)
repl('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt',
"                    textSize = 15f\n                    typeface = heavyFont\n",
"                    textSize = newsTextSize(15f, item)\n                    typeface = newsTypeface(item, bold = true)\n", 1)
repl('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt',
"                textSize = 13f\n                typeface = mediumFont\n                setTextColor(Color.parseColor(MUTED))\n                gravity = Gravity.RIGHT\n                maxLines = 3\n",
"                textSize = newsTextSize(13f, item)\n                typeface = newsTypeface(item, bold = false)\n                setTextColor(Color.parseColor(MUTED))\n                gravity = Gravity.RIGHT\n                maxLines = 3\n", 1)
repl('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt',
"    private fun newsBubbleLayoutParams(item: UpdateItem, bottomMarginDp: Int): LinearLayout.LayoutParams {\n",
"    private fun newsTextSize(baseSp: Float, item: UpdateItem): Float =\n        baseSp * (item.fontScalePercent.coerceIn(80, 150) / 100f)\n\n    private fun newsTypeface(item: UpdateItem, bold: Boolean): Typeface {\n        val family = when (item.fontFamily.uppercase()) {\n            \"ROUNDED\" -> \"sans-serif-rounded\"\n            \"SERIF\" -> \"serif\"\n            \"MONO\" -> \"monospace\"\n            else -> \"sans-serif\"\n        }\n        return Typeface.create(family, if (bold) Typeface.BOLD else Typeface.NORMAL)\n    }\n\n    private fun newsBubbleLayoutParams(item: UpdateItem, bottomMarginDp: Int): LinearLayout.LayoutParams {\n")

# tests
p = Path('backend/test-news-live-preview-static.js')
t = p.read_text()
t += """
assert(js.includes('newsFontScaleInput'));
assert(js.includes('fontFamilyInput'));
assert(js.includes("form.append('fontScalePercent'"));
assert(js.includes("form.append('fontFamily'"));
"""
p.write_text(t)

p = Path('backend/test-news-bubble-width-static.js')
t = p.read_text()
t += """
assert(db.includes('font_scale_percent INTEGER NOT NULL DEFAULT 100'));
assert(db.includes("font_family TEXT NOT NULL DEFAULT 'SYSTEM'"));
assert(api.includes('val fontScalePercent: Int = 100'));
assert(api.includes('val fontFamily: String = "SYSTEM"'));
assert(config.includes('.put("fontScalePercent", item.fontScalePercent)'));
assert(activity.includes('private fun newsTypeface(item: UpdateItem'));
assert(activity.includes('private fun newsTextSize(baseSp: Float, item: UpdateItem)'));
"""
p.write_text(t)
