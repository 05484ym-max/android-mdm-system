from pathlib import Path

p = Path('admin-panel/index.html')
s = p.read_text(encoding='utf-8')

head_marker = '<title>יהודי כשר — לוח בקרה</title>\n'
head_insert = '''<title>יהודי כשר — לוח בקרה</title>\n<link rel="manifest" href="/manifest.webmanifest" />\n<meta name="theme-color" content="#173D20" />\n<meta name="mobile-web-app-capable" content="yes" />\n<meta name="apple-mobile-web-app-capable" content="yes" />\n<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />\n<meta name="apple-mobile-web-app-title" content="יהודי כשר ניהול" />\n<link rel="icon" href="/admin-icon.svg" type="image/svg+xml" />\n<link rel="apple-touch-icon" href="/admin-icon.svg" />\n'''
if 'rel="manifest"' not in s:
    if head_marker not in s:
        raise SystemExit('title marker not found')
    s = s.replace(head_marker, head_insert, 1)

script = '<script src="/pwa.js" defer></script>\n'
if '/pwa.js' not in s:
    if '</body>' not in s:
        raise SystemExit('body closing tag not found')
    s = s.replace('</body>', script + '</body>', 1)

p.write_text(s, encoding='utf-8')
