from pathlib import Path
import re

# --- Customer DPC: make News & Updates look like chat bubbles ---
p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
s = p.read_text(encoding='utf-8')

# Detail body bubble: keep content/media logic, only change visual container.
old = '''        val detailCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedCardWithBorder()
            setPadding(dp(20), dp(20), dp(20), dp(20))'''
new = '''        val detailCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = flatRounded("#DFF1D8", dp(18).toFloat())
            setPadding(dp(16), dp(14), dp(16), dp(12))'''
if old not in s:
    raise SystemExit('detailCard marker not found')
s = s.replace(old, new, 1)

# Give the opened message a chat-like right-aligned bubble width via margin.
old = '''        contentArea.addView(detailCard)'''
new = '''        contentArea.addView(
            detailCard,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                marginStart = dp(34)
                bottomMargin = dp(14)
            }
        )'''
# Only replace first occurrence after detailCard declaration.
pos = s.find('val detailCard = LinearLayout')
idx = s.find(old, pos)
if idx < 0:
    raise SystemExit('detailCard addView marker not found')
s = s[:idx] + s[idx:].replace(old, new, 1)

# List cards: bubble background + right alignment + narrower visual footprint.
pattern = re.compile(r'''(private fun newsCard\(item: UpdateItem\): LinearLayout \{.*?return LinearLayout\(this\)\.apply \{\n            orientation = LinearLayout\.VERTICAL\n            setPadding\(dp\(18\), dp\(16\), dp\(18\), dp\(16\)\)\n            )background = roundedCardWithBorder\(\)\n            layoutParams = LinearLayout\.LayoutParams\(\n                ViewGroup\.LayoutParams\.MATCH_PARENT, ViewGroup\.LayoutParams\.WRAP_CONTENT\n            \)\.apply \{ bottomMargin = dp\(14\) \}''', re.S)
replacement = r'''\1background = flatRounded("#DFF1D8", dp(18).toFloat())
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                marginStart = dp(34)
                bottomMargin = dp(14)
            }'''
s, n = pattern.subn(replacement, s, count=1)
if n != 1:
    raise SystemExit(f'newsCard visual patch count={n}')

# Make timestamp sit like a chat timestamp at the lower left edge.
news_pos = s.find('private fun newsCard(item: UpdateItem)')
time_pos = s.find('text = formatUpdateDate(item.publishedAt)', news_pos)
if time_pos < 0:
    raise SystemExit('newsCard timestamp not found')
gravity_pos = s.find('gravity = Gravity.RIGHT', time_pos)
if gravity_pos < 0 or gravity_pos > time_pos + 500:
    raise SystemExit('newsCard timestamp gravity not found')
s = s[:gravity_pos] + s[gravity_pos:].replace('gravity = Gravity.RIGHT', 'gravity = Gravity.LEFT', 1)

p.write_text(s, encoding='utf-8')

# --- Admin panel: make media attachment obvious on mobile ---
p = Path('admin-panel/news.js')
s = p.read_text(encoding='utf-8')
needle = '''  let editingId = null;
  let editingItem = null;
  let localPreviewUrl = null;
'''
insert = '''  let editingId = null;
  let editingItem = null;
  let localPreviewUrl = null;

  // Make the media control explicit on small phone screens: the native file
  // input remains in place, but the label and save button clearly say when a
  // photo/video will be sent with the customer update.
  const mediaLabel = document.querySelector('label[for="newsMediaInput"]');
  if (mediaLabel) mediaLabel.textContent = '📎 צרף תמונה או סרטון';
'''
if needle not in s:
    raise SystemExit('news.js state marker not found')
s = s.replace(needle, insert, 1)

# On selection, show filename and make CTA explicit.
needle = '''    localPreviewUrl = URL.createObjectURL(file);
    const type = file.type.startsWith('image/') ? 'IMAGE' : 'VIDEO';
    mediaPreview.innerHTML = mediaMarkup(type, localPreviewUrl);
    mediaPreview.style.display = '';
  });'''
replace = '''    localPreviewUrl = URL.createObjectURL(file);
    const type = file.type.startsWith('image/') ? 'IMAGE' : 'VIDEO';
    mediaPreview.innerHTML = `<div class="news-media-selected">נבחר: ${escapeHtml(file.name)}</div>` + mediaMarkup(type, localPreviewUrl);
    mediaPreview.style.display = '';
    saveBtn.textContent = editingId ? 'עדכן עם המדיה' : 'שלח ללקוחות עם המדיה';
  });'''
if needle not in s:
    raise SystemExit('news.js media change marker not found')
s = s.replace(needle, replace, 1)

# Reset CTA to a clearer customer-facing action.
s = s.replace("    saveBtn.textContent = 'שמור';", "    saveBtn.textContent = 'שלח ללקוחות';", 1)
s = s.replace("    saveBtn.textContent = 'עדכן';", "    saveBtn.textContent = 'עדכן הודעה';", 1)
p.write_text(s, encoding='utf-8')

p = Path('admin-panel/news.css')
s = p.read_text(encoding='utf-8')
s += '''\n/* Prominent attachment control for phone-first admin use. */\n.news-media-field {\n  background: var(--accent-tint);\n  border: 1px dashed var(--accent-soft);\n  border-radius: 14px;\n  padding: 12px;\n}\n.news-media-label { font-size: .95rem; }\n#newsMediaInput { background: #fff; cursor: pointer; }\n.news-media-selected {\n  font-size: .78rem; font-weight: 700; color: var(--accent); margin-bottom: 8px;\n  overflow-wrap: anywhere;\n}\n'''
p.write_text(s, encoding='utf-8')

print('patched news customer bubbles + admin media attachment UI')
