from pathlib import Path

p = Path('admin-panel/index.html')
s = p.read_text(encoding='utf-8')

button_anchor = '''        <button class="cmd-btn" data-cmd="OPEN_DEBUGGING_TEMP">פתח ניפוי באגים זמנית</button>
        <button class="cmd-btn cmd-danger" data-cmd="WIPE">מחיקת מכשיר</button>'''
button_new = '''        <button class="cmd-btn" data-cmd="OPEN_DEBUGGING_TEMP">פתח ניפוי באגים זמנית</button>
        <button class="cmd-btn" id="detailRecoveryCode">קוד שחזור</button>
        <button class="cmd-btn cmd-danger" data-cmd="WIPE">מחיקת מכשיר</button>'''
if button_anchor not in s:
    raise SystemExit('admin recovery button anchor not found')
s = s.replace(button_anchor, button_new, 1)

listener_anchor = "  document.querySelectorAll('#detailContent .cmd-btn').forEach(btn => {"
listener_new = '''  const recoveryBtn = document.getElementById('detailRecoveryCode');
  if (recoveryBtn) {
    recoveryBtn.addEventListener('click', async () => {
      recoveryBtn.disabled = true;
      try {
        const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/recovery-code`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.error || 'יצירת קוד השחזור נכשלה');
          return;
        }
        alert(`קוד שחזור למכשיר ${deviceId}:\n\n${data.token}\n\nהקוד חד-פעמי ותקף ל-30 דקות.`);
      } finally {
        recoveryBtn.disabled = false;
      }
    });
  }

  document.querySelectorAll('#detailContent .cmd-btn[data-cmd]').forEach(btn => {'''
if listener_anchor not in s:
    raise SystemExit('admin command listener anchor not found')
s = s.replace(listener_anchor, listener_new, 1)
p.write_text(s, encoding='utf-8')
