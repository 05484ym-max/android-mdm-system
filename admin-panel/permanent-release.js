(function(){
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
