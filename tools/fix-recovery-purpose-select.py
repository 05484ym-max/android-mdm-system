from pathlib import Path

p = Path('backend/db.js')
s = p.read_text(encoding='utf-8')
old = '''    `SELECT id, created_at, expires_at, used_at, device_id\n       FROM enrollments\n      ORDER BY created_at DESC\n      LIMIT 50`,'''
new = '''    `SELECT id, created_at, expires_at, used_at, device_id, purpose\n       FROM enrollments\n      ORDER BY created_at DESC\n      LIMIT 50`,'''
if old not in s:
    raise SystemExit('listEnrollments SELECT target not found')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
