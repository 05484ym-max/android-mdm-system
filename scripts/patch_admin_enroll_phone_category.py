from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 occurrence, found {count}: {old[:80]!r}')
    p.write_text(s.replace(old, new, 1))

# 1) Enrollment token stays cryptographically strong, but fits mobile and has a copy action.
replace_once('admin-panel/index.html',
"""  .code-box {\n    font-family: monospace; font-size: 1.4rem; letter-spacing: 3px; color: var(--accent);\n    background: var(--accent-tint); border: 1px dashed var(--accent-soft); border-radius: 12px;\n    padding: 14px; text-align: center; margin-top: 12px; direction: ltr;\n  }""",
"""  .code-box {\n    font-family: monospace; font-size: clamp(.98rem, 4.5vw, 1.22rem); letter-spacing: 1px; color: var(--accent);\n    background: var(--accent-tint); border: 1px dashed var(--accent-soft); border-radius: 12px;\n    padding: 14px 12px; text-align: center; margin-top: 12px; direction: ltr;\n    max-width: 100%; overflow-wrap: anywhere; word-break: break-all; line-height: 1.55;\n  }\n  .enroll-code-actions { display:flex; justify-content:center; margin-top:10px; }""")
replace_once('admin-panel/index.html',
"""    <button class=\"renew-btn\" id=\"genCodeBtn\">צור קוד רישום</button>\n    <div id=\"codeBox\" class=\"code-box\" style=\"display:none;\"></div>""",
"""    <button class=\"renew-btn\" id=\"genCodeBtn\">צור קוד רישום</button>\n    <div id=\"codeBox\" class=\"code-box\" style=\"display:none;\"></div>\n    <div class=\"enroll-code-actions\"><button class=\"toggle-btn\" id=\"copyEnrollCodeBtn\" style=\"display:none;\">העתק קוד</button></div>""")
replace_once('admin-panel/index.html',
"""  const data = await res.json();\n  box.textContent = data.token;""",
"""  const data = await res.json();\n  box.textContent = data.token;\n  box.dataset.rawToken = data.token;\n  document.getElementById('copyEnrollCodeBtn').style.display = 'inline-block';""")
replace_once('admin-panel/index.html',
"""document.getElementById('genCodeBtn').addEventListener('click', async () => {""",
"""document.getElementById('copyEnrollCodeBtn').addEventListener('click', async () => {\n  const box = document.getElementById('codeBox');\n  const token = box.dataset.rawToken || box.textContent || '';\n  if (!token) return;\n  try {\n    await navigator.clipboard.writeText(token);\n    const btn = document.getElementById('copyEnrollCodeBtn');\n    const original = btn.textContent;\n    btn.textContent = '✓ הועתק';\n    setTimeout(() => { if (btn.isConnected) btn.textContent = original; }, 1200);\n  } catch (_) {\n    alert('לא ניתן להעתיק אוטומטית. לחץ לחיצה ארוכה על הקוד.');\n  }\n});\n\ndocument.getElementById('genCodeBtn').addEventListener('click', async () => {""")

# 2) A phone/customer number is displayed as a number, not as a hashtag.
index = Path('admin-panel/index.html')
s = index.read_text()
needle = "' · #' + d.customerNumber"
if s.count(needle) != 1:
    raise SystemExit(f'index quick search #: expected 1, found {s.count(needle)}')
s = s.replace(needle, "' · ' + d.customerNumber", 1)
needle2 = "' · #' + escapeHtml(d.customerNumber)"
if s.count(needle2) != 1:
    raise SystemExit(f'index device row #: expected 1, found {s.count(needle2)}')
s = s.replace(needle2, "' · ' + escapeHtml(d.customerNumber)", 1)
index.write_text(s)

# 3) Manual categories: persistent DB table and small helpers.
replace_once('backend/db.js',
"""ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;""",
"""ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;\n\nCREATE TABLE IF NOT EXISTS app_custom_categories (\n  category_key TEXT PRIMARY KEY,\n  label        TEXT NOT NULL,\n  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()\n);\nCREATE UNIQUE INDEX IF NOT EXISTS app_custom_categories_label_unique\n  ON app_custom_categories (lower(label));""")
replace_once('backend/db.js',
"""module.exports = {\n  init,""",
"""async function listCustomAppCategories() {\n  const { rows } = await pool.query(\n    `SELECT category_key, label FROM app_custom_categories ORDER BY lower(label), category_key`\n  );\n  return rows.map(row => ({ key: row.category_key, label: row.label }));\n}\n\nasync function customAppCategoryExists(key) {\n  if (typeof key !== 'string' || !key) return false;\n  const { rowCount } = await pool.query(\n    'SELECT 1 FROM app_custom_categories WHERE category_key = $1 LIMIT 1', [key]\n  );\n  return rowCount > 0;\n}\n\nasync function createCustomAppCategory(key, label) {\n  const { rows } = await pool.query(\n    `INSERT INTO app_custom_categories (category_key, label) VALUES ($1, $2)\n     ON CONFLICT (category_key) DO UPDATE SET label = EXCLUDED.label\n     RETURNING category_key, label`,\n    [key, label]\n  );\n  return { key: rows[0].category_key, label: rows[0].label };\n}\n\nmodule.exports = {\n  init,\n  listCustomAppCategories,\n  customAppCategoryExists,\n  createCustomAppCategory,""")

# Backend categories endpoint and validation.
replace_once('backend/index.js',
"""app.get('/api/apps/categories', requireAdmin, wrap(async (req, res) => {\n  res.json(appCategories.CATEGORIES);\n}));""",
"""async function isKnownAppCategory(key) {\n  return appCategories.isValidCategoryKey(key) || await db.customAppCategoryExists(key);\n}\n\napp.get('/api/apps/categories', requireAdmin, wrap(async (req, res) => {\n  const custom = await db.listCustomAppCategories();\n  res.json([...appCategories.CATEGORIES, ...custom]);\n}));\n\napp.post('/api/apps/categories', requireAdmin, wrap(async (req, res) => {\n  const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';\n  if (!label || label.length > 40) {\n    return res.status(400).json({ error: 'category label must be 1-40 characters' });\n  }\n  const fixedDuplicate = appCategories.CATEGORIES.find(c => c.label.toLocaleLowerCase('he') === label.toLocaleLowerCase('he'));\n  if (fixedDuplicate) return res.json(fixedDuplicate);\n  const key = 'custom_' + sha256(label.toLocaleLowerCase('he')).slice(0, 16);\n  try {\n    res.json(await db.createCustomAppCategory(key, label));\n  } catch (e) {\n    if (e && e.code === '23505') {\n      const existing = (await db.listCustomAppCategories()).find(c => c.label.toLocaleLowerCase('he') === label.toLocaleLowerCase('he'));\n      if (existing) return res.json(existing);\n    }\n    throw e;\n  }\n}));""")
idx = Path('backend/index.js')
s = idx.read_text()
old = "if (!appCategories.isValidCategoryKey(req.body.category)) {"
count = s.count(old)
if count != 2:
    raise SystemExit(f'backend category validators: expected 2, found {count}')
s = s.replace(old, "if (!(await isKnownAppCategory(req.body.category))) {", 2)
idx.write_text(s)

# 4) Cleaner catalog add surface + manual category controls.
replace_once('admin-panel/index.html',
"""    <div class=\"add-app-row\" id=\"appImportActions\" style=\"margin-top:10px;\">\n      <button class=\"add-app-btn\" id=\"openPlaySearchBtn\">חפש ב-Google Play</button>\n      <button class=\"add-app-btn\" id=\"openApkUploadBtn\">העלה APK</button>\n    </div>\n    <div class=\"add-app-row\" id=\"addAppToCatalogRow\">\n      <input class=\"package-input\" id=\"newAppName\" placeholder=\"שם האפליקציה (לדוגמה: וויז)\" />\n      <input class=\"package-input\" id=\"newAppPackage\" placeholder=\"com.waze\" />\n      <button class=\"add-app-btn\" id=\"addAppToCatalogBtn\">הוסף לקטלוג</button>\n    </div>""",
"""    <div class=\"catalog-add-card\" id=\"catalogAddCard\">\n      <div class=\"catalog-add-title\">הוספת אפליקציה</div>\n      <div class=\"catalog-add-hint\">בחר חיפוש ב-Google Play, העלאת APK, או הוספה ידנית לפי package.</div>\n      <div class=\"add-app-row catalog-primary-actions\" id=\"appImportActions\">\n        <button class=\"add-app-btn\" id=\"openPlaySearchBtn\">חפש ב-Google Play</button>\n        <button class=\"add-app-btn secondary-action\" id=\"openApkUploadBtn\">העלה APK</button>\n      </div>\n      <div class=\"add-app-row catalog-manual-row\" id=\"addAppToCatalogRow\">\n        <input class=\"package-input\" id=\"newAppName\" placeholder=\"שם האפליקציה\" />\n        <input class=\"package-input\" id=\"newAppPackage\" placeholder=\"com.example.app\" />\n        <button class=\"add-app-btn\" id=\"addAppToCatalogBtn\">הוסף ידנית</button>\n      </div>\n      <div class=\"catalog-category-create\" id=\"catalogCategoryCreate\">\n        <input class=\"package-input\" id=\"newCategoryLabel\" maxlength=\"40\" placeholder=\"קטגוריה חדשה (למשל: תפילה)\" />\n        <button class=\"toggle-btn\" id=\"addCategoryBtn\">הוסף קטגוריה</button>\n        <span class=\"catalog-category-status\" id=\"categoryCreateStatus\"></span>\n      </div>\n    </div>""")
replace_once('admin-panel/index.html',
"""document.getElementById('addAppToCatalogBtn').addEventListener('click', async () => {""",
"""document.getElementById('addCategoryBtn').addEventListener('click', async () => {\n  const input = document.getElementById('newCategoryLabel');\n  const status = document.getElementById('categoryCreateStatus');\n  const label = input.value.trim();\n  if (!label) { status.textContent = 'נא להזין שם קטגוריה'; return; }\n  const btn = document.getElementById('addCategoryBtn');\n  btn.disabled = true; status.textContent = 'שומר...';\n  try {\n    const res = await fetch('/api/apps/categories', {\n      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label })\n    });\n    const body = await res.json().catch(() => ({}));\n    if (!res.ok) throw new Error(body.error || 'הוספת הקטגוריה נכשלה');\n    input.value = ''; status.textContent = '✓ הקטגוריה נוספה';\n    await loadCategories();\n  } catch (e) { status.textContent = e.message || 'שגיאת תקשורת'; }\n  finally { btn.disabled = false; }\n});\n\ndocument.getElementById('addAppToCatalogBtn').addEventListener('click', async () => {""")

# Keep category create/add card visible only in global mode, same as the existing add actions.
replace_once('admin-panel/index.html',
"""    document.getElementById('appImportActions').style.display = catalogMode === 'all' ? 'flex' : 'none';""",
"""    document.getElementById('appImportActions').style.display = catalogMode === 'all' ? 'flex' : 'none';\n    document.getElementById('catalogAddCard').style.display = catalogMode === 'all' ? 'block' : 'none';""")

# CSS polish using current palette.
p = Path('admin-panel/panel-polish.css')
s = p.read_text()
s += """

/* Catalog add surface: one clear card instead of scattered controls. */
.catalog-add-card {
  background: var(--bg); border: 1px solid var(--card-border); border-radius: 16px;
  padding: 14px; margin: 10px 0 16px;
}
.catalog-add-title { font-weight: 800; color: var(--text); margin-bottom: 4px; }
.catalog-add-hint { color: var(--text-dim); font-size: .78rem; margin-bottom: 12px; line-height: 1.45; }
.catalog-primary-actions, .catalog-manual-row, .catalog-category-create { display:flex; gap:8px; flex-wrap:wrap; }
.catalog-primary-actions .add-app-btn { flex:1 1 150px; }
.catalog-primary-actions .secondary-action { background: var(--accent-soft); }
.catalog-manual-row .package-input { flex:1 1 170px; }
.catalog-category-create { margin-top:10px; padding-top:10px; border-top:1px solid var(--card-border); align-items:center; }
.catalog-category-create .package-input { flex:1 1 180px; }
.catalog-category-status { color:var(--text-dim); font-size:.76rem; flex-basis:100%; }
@media (max-width:520px) {
  .catalog-manual-row .add-app-btn, .catalog-category-create .toggle-btn { width:100%; }
}
"""
p.write_text(s)

# Contract audit for the new critical UI/API paths.
p = Path('backend/test-admin-panel-functional-audit.js')
s = p.read_text()
anchor = "includes(appImportUi, '/api/apps/play-search', 'Play search UI call');"
if anchor not in s:
    raise SystemExit('audit anchor missing')
s = s.replace(anchor, anchor + "\nincludes(panelHtml, 'copyEnrollCodeBtn', 'enrollment token copy control');\nincludes(panelHtml, 'newCategoryLabel', 'manual category input');\nincludes(panelHtml, \"fetch('/api/apps/categories'\", 'manual category API call');\nincludes(index, \"app.post('/api/apps/categories'\", 'manual category backend route');", 1)
p.write_text(s)

print('patch_admin_enroll_phone_category.py: OK')
