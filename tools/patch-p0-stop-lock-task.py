from pathlib import Path
p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
s = p.read_text(encoding='utf-8')
old = '''            enforcer.disableKiosk()\n            accessibilitySetupWindowOpen = true\n'''
new = '''            try { stopLockTask() } catch (_: Exception) {}\n            enforcer.disableKiosk()\n            accessibilitySetupWindowOpen = true\n'''
if old not in s:
    raise SystemExit('accessibility kiosk-window target not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
