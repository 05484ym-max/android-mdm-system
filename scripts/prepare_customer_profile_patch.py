from pathlib import Path

p = Path('scripts/patch_customer_profile.py')
s = p.read_text()
marker = 'def rx(path, pattern, repl, label, flags=re.S):'
helper = '''def repn(path, old, new, label, expected):
    p = Path(path)
    s = p.read_text()
    c = s.count(old)
    if c != expected:
        raise SystemExit(f'{label}: expected {expected} matches, got {c}')
    p.write_text(s.replace(old, new))


'''
if marker not in s:
    raise SystemExit('rx marker missing')
s = s.replace(marker, helper + marker, 1)
needle = "rep('backend/db.js', '''    customerName: row.customer_name,\n    customerNumber: row.customer_number,''',"
if s.count(needle) != 1:
    raise SystemExit(f'db mapping call marker count={s.count(needle)}')
s = s.replace(needle, "repn('backend/db.js', '''    customerName: row.customer_name,\n    customerNumber: row.customer_number,''',", 1)
tail = "'toDevice profile mapping')"
pos = s.find(tail, s.find("repn('backend/db.js'"))
if pos < 0:
    raise SystemExit('db mapping call tail missing')
s = s[:pos] + "'customer profile mappings', 2)" + s[pos + len(tail):]
old_rx = 'out, n = re.subn(pattern, repl, s, count=1, flags=flags)'
new_rx = 'out, n = re.subn(pattern, lambda _m: repl, s, count=1, flags=flags)'
if s.count(old_rx) != 1:
    raise SystemExit(f'rx replacement marker count={s.count(old_rx)}')
s = s.replace(old_rx, new_rx, 1)
p.write_text(s)
print('prepare_customer_profile_patch.py: OK')
