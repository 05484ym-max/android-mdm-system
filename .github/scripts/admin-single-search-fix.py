from pathlib import Path
import re

p = Path('admin-panel/index.html')
s = p.read_text()

replacements = [
    ('    <input class="search-input" id="deviceSearch" placeholder="חיפוש לפי מספר לקוח, שם או מזהה מכשיר..." />\n', ''),
    ("  renderDeviceList(filterDevices(document.getElementById('deviceSearch').value));", "  renderDeviceList(filterDevices(document.getElementById('quickCustomerSearch').value));"),
    ("document.getElementById('quickCustomerSearch').addEventListener('input', renderQuickCustomerSearch);", """document.getElementById('quickCustomerSearch').addEventListener('input', () => {
  renderQuickCustomerSearch();
  renderDeviceList(filterDevices(document.getElementById('quickCustomerSearch').value));
});"""),
    ('    gap: 14px; margin-bottom: 24px;', '    gap: 12px; margin-bottom: 18px;'),
    ('    border-radius: 20px; padding: 18px; text-align: center;', '    border-radius: 20px; padding: 14px; text-align: center;'),
    ('    position: relative; max-width: 720px; margin: 0 auto 18px;', '    position: relative; max-width: 720px; margin: 0 auto 14px;'),
    ('    border-radius: 20px; padding: 14px 16px;', '    border-radius: 20px; padding: 12px 14px;'),
]
for old, new in replacements:
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'anchor count {count}: {old[:60]!r}')
    s = s.replace(old, new, 1)

old_devices_css = '''  .devices-section {
    background: var(--card-bg); border: 1px solid var(--card-border);
    border-radius: 20px; padding: 18px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.03);
  }'''
if s.count(old_devices_css) != 1:
    raise SystemExit('devices-section css anchor mismatch')
s = s.replace(old_devices_css, old_devices_css.replace('padding: 18px;', 'padding: 16px;'), 1)

pattern = re.compile(r"\ndocument\.getElementById\('deviceSearch'\)\.addEventListener\('input', \(\) => \{.*?\n\}\);\n", re.S)
s, n = pattern.subn('\n', s, count=1)
if n != 1:
    raise SystemExit(f'deviceSearch listener removals={n}')
if 'deviceSearch' in s:
    raise SystemExit('deviceSearch references remain')

p.write_text(s)
