from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'missing marker in {path}: {old[:120]!r}')
    p.write_text(s.replace(old, new, 1))

# 1) Make release fail-safe: recover hidden apps + DNS before relinquishing DO.
path = 'dpc-app/app/src/main/java/org/mdmopen/dpc/PolicyEnforcer.kt'
old = '''    fun releaseDeviceOwner() {
        check(isDeviceOwner()) { "Not device owner" }

        // Remove kiosk controls first.
        disableKiosk()

        // Remove restrictions we applied.
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_UNINSTALL_APPS)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)

        // Release Device Owner ownership.
        dpm.clearDeviceOwnerApp(context.packageName)
    }
'''
new = '''    fun releaseDeviceOwner() {
        check(isDeviceOwner()) { "Not device owner" }

        // A permanent release must never strand apps hidden by an older policy.
        // Reuse the same hardened recovery used by reversible FULL_OPEN first.
        val recovery = applyFullOpen()
        check(recovery.failed.isEmpty()) {
            "Cannot safely release device owner; failed to recover: ${recovery.failed.joinToString(",")}" 
        }

        // Remove managed private-DNS state while Device Owner privileges still exist.
        // If this fails, abort instead of relinquishing ownership and leaving filtering behind.
        try {
            AdBlockDns.disable(context)
        } catch (e: Exception) {
            throw IllegalStateException("Cannot safely disable managed DNS before release", e)
        }

        disableKiosk()
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_UNINSTALL_APPS)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)
        try {
            dpm.setUninstallBlocked(admin, context.packageName, false)
        } catch (_: Exception) {
            // Device Owner itself is protected by Android until ownership is cleared anyway.
        }

        // Irreversible: after this point remote management cannot be restored without enrollment.
        dpm.clearDeviceOwnerApp(context.packageName)
    }
'''
replace_once(path, old, new)

# 2) After relinquishing DO, ask Android to uninstall this DPC. A normal Android
# uninstall confirmation may still be required; we deliberately never fake success.
path = 'dpc-app/app/src/main/java/org/mdmopen/dpc/CommandExecutor.kt'
replace_once(path,
'''import android.content.ComponentName
import android.content.Context
''',
'''import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
''')
replace_once(path,
'''        "RELEASE_DEVICE_OWNER" -> {
            PolicyEnforcer(context).releaseDeviceOwner()
            "ניהול המכשיר הוסר בהצלחה"
        }
''',
'''        "RELEASE_DEVICE_OWNER" -> {
            PolicyEnforcer(context).releaseDeviceOwner()
            if (requestSelfUninstall()) {
                "ניהול המכשיר הוסר; Android פתח את תהליך מחיקת אפליקציית הניהול"
            } else {
                "ניהול המכשיר הוסר; לא ניתן היה לפתוח אוטומטית את מסך מחיקת אפליקציית הניהול"
            }
        }
''')
replace_once(path,
'''    /** Best-effort - a failed report must never crash the command loop itself;
''',
'''    private fun requestSelfUninstall(): Boolean = try {
        val intent = Intent(Intent.ACTION_DELETE, Uri.parse("package:${context.packageName}")).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        true
    } catch (_: Exception) {
        false
    }

    /** Best-effort - a failed report must never crash the command loop itself;
''')

# 3) Server-side re-auth for irreversible release, same principle as WIPE.
path = 'backend/index.js'
replace_once(path,
'''  // WIPE is irreversible, so a valid admin session alone isn't enough - a
  // stolen/left-open session must not be able to wipe a device on its own.
  // Re-checked here, independent of req.body.params, so it can never end up
  // stored on the queued command or forwarded to the device.
  if (command === 'WIPE') {
''',
'''  // WIPE and RELEASE_DEVICE_OWNER are irreversible, so a valid admin session
  // alone is not enough. Re-authenticate with the admin password server-side.
  // The password is never stored in command params or forwarded to the device.
  if (command === 'WIPE' || command === 'RELEASE_DEVICE_OWNER') {
''')

# 4) Add dedicated danger-zone UI loaded on both device row and customer cards.
path = 'admin-panel/index.html'
replace_once(path,
'''<link rel="stylesheet" href="full-open.css" />
''',
'''<link rel="stylesheet" href="full-open.css" />
<link rel="stylesheet" href="permanent-release.css" />
''')
replace_once(path,
'''          <button class="open-detail-btn" data-release-device="${id}">הסר חסימה מרחוק</button>
''',
'''          <button class="open-detail-btn" data-release-device="${id}">שחרור מכשיר לצמיתות</button>
''')
replace_once(path,
'''<script src="full-open.js"></script>
''',
'''<script src="full-open.js"></script>
<script src="permanent-release.js"></script>
''')

Path('admin-panel/permanent-release.css').write_text(r'''
.permanent-release-card{border:1px solid rgba(179,67,44,.35);background:#fff7f4;border-radius:16px;padding:14px;margin:14px 0}.permanent-release-card.compact{margin:12px 0}.permanent-release-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.permanent-release-head strong{color:#8f2f1f;font-size:1rem}.permanent-release-badge{background:#fde6df;color:#9d3422;border-radius:999px;padding:4px 9px;font-size:.72rem;font-weight:800}.permanent-release-note{margin-top:8px;color:#6d4b45;font-size:.8rem;line-height:1.5}.permanent-release-actions{margin-top:10px}.permanent-release-btn{border:1px solid rgba(179,67,44,.6)!important;color:#a73825!important;background:#fff!important;font-weight:800!important}.permanent-release-btn:disabled{opacity:.55}
'''.strip()+"\n")

Path('admin-panel/permanent-release.js').write_text(r'''(function(){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function releaseDevice(deviceId, button){
    if(!confirm(`שחרור לצמיתות של המכשיר ${deviceId}?\nכל ההגבלות והסינון יוסרו ולא תהיה יותר שליטה מרחוק.`)) return;
    if(!confirm('אישור אחרון: Device Owner יוסר. כדי לנהל שוב את המכשיר יהיה צורך ברישום מחדש. להמשיך?')) return;
    const adminPassword=prompt('הקלד את סיסמת המנהל כדי לאשר שחרור לצמיתות:');
    if(adminPassword===null) return;
    if(!adminPassword){ alert('נדרשת סיסמת מנהל.'); return; }
    if(button){ button.disabled=true; button.dataset.releaseOldText=button.textContent; button.textContent='משחרר...'; }
    try{
      const res=await fetch(`/api/devices/${encodeURIComponent(deviceId)}/commands`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({command:'RELEASE_DEVICE_OWNER',params:{},adminPassword})
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok){ alert(body.error||'שליחת פקודת השחרור נכשלה'); return; }
      alert('פקודת השחרור לצמיתות נשלחה. המכשיר יחזיר את האפליקציות, יסיר את הסינון ואת Device Owner, ולאחר מכן Android ינסה לפתוח את מחיקת אפליקציית הניהול. ייתכן ש-Android ידרוש אישור מחיקה על המכשיר.');
      if(typeof window.loadDevices==='function') await window.loadDevices();
    }catch(_){ alert('שגיאת תקשורת בשליחת פקודת השחרור'); }
    finally{ if(button&&button.isConnected){ button.disabled=false; button.textContent=button.dataset.releaseOldText||'שחרור מכשיר לצמיתות'; } }
  }

  function cardHtml(id,compact){ return `<div class="permanent-release-card${compact?' compact':''}" data-permanent-release-card="${esc(id)}"><div class="permanent-release-head"><div><strong>שחרור מכשיר לצמיתות</strong></div><span class="permanent-release-badge">בלתי הפיך</span></div><div class="permanent-release-note">משחרר את כל האפליקציות והסינון, מסיר Device Owner ומתחיל את הסרת אפליקציית הניהול. לאחר הסרת Device Owner אי אפשר להחזיר ניהול מרחוק בלי רישום מחדש.</div><div class="permanent-release-actions"><button type="button" class="toggle-btn permanent-release-btn" data-permanent-release-submit>שחרר ומחק ניהול</button></div></div>`; }
  function bind(card){ if(!card||card.dataset.bound==='1')return; card.dataset.bound='1'; const id=card.getAttribute('data-permanent-release-card'); card.querySelector('[data-permanent-release-submit]')?.addEventListener('click',e=>releaseDevice(id,e.currentTarget)); }
  function mountUnified(){ const panel=document.getElementById('unifiedCustomerProfile'); if(!panel||panel.style.display==='none'||panel.querySelector('[data-permanent-release-card]'))return; const manage=panel.querySelector('.unified-profile-actions'); const btn=panel.querySelector('[data-unified-manage]'); const id=btn&&btn.getAttribute('data-unified-manage'); if(!id)return; const h=document.createElement('div'); h.innerHTML=cardHtml(id,true); const card=h.firstElementChild; manage?manage.insertAdjacentElement('beforebegin',card):panel.appendChild(card); bind(card); }
  function mountDetail(){ const detail=document.getElementById('detailContent'); if(!detail||!detail.children.length||detail.querySelector('[data-permanent-release-card]'))return; const id=window.__currentDetailDeviceId||null; if(!id)return; const h=document.createElement('div'); h.innerHTML=`<div class="detail-section"><h3>אזור מסוכן</h3>${cardHtml(id,false)}</div>`; const section=h.firstElementChild; detail.appendChild(section); bind(section.querySelector('[data-permanent-release-card]')); }
  function remount(){mountUnified();mountDetail();}

  // Supersede the legacy row handler in capture phase so it cannot send an
  // irreversible RELEASE without password re-authentication.
  document.addEventListener('click',e=>{ const btn=e.target.closest&&e.target.closest('[data-release-device]'); if(!btn)return; e.preventDefault(); e.stopImmediatePropagation(); releaseDevice(btn.getAttribute('data-release-device'),btn); },true);
  new MutationObserver(remount).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',remount); setTimeout(remount,0);
  window.releaseDevicePermanently=releaseDevice;
})();
''')

print('permanent release patch applied')
