// Device diagnostics and verified repair actions.
(function () {
  'use strict';
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const STATUS_LABEL = { ok: 'תקין', warning: 'דורש תשומת לב', critical: 'קריטי', unknown: 'ממתין לנתונים' };
  const SEVERITY_LABEL = { critical: 'קריטי', warning: 'אזהרה', info: 'מידע' };
  const DNS_MODE_LABEL = { OFF: 'כבוי', OPPORTUNISTIC: 'Opportunistic', PROVIDER_HOSTNAME: 'Strict (מסונן)', UNKNOWN: 'לא ידוע', ERROR: 'שגיאת קריאה' };
  const DNS_FAIL_SAFE_LABEL = { NORMAL: 'תקין', DEGRADED: 'מנוטר (כשלים חלקיים)', ROLLED_BACK: 'בוצע rollback', RECOVERING: 'בתהליך התאוששות' };
  const DNS_NETWORK_LABEL = { WIFI: 'Wi-Fi', CELLULAR: 'סלולרי', OTHER: 'אחר', NONE: 'אין חיבור' };
  const TECH_LABEL = {
    lastUpdateVersion: 'גרסת עדכון שנכשלה', lastUpdateError: 'פרטי שגיאה', currentVersionCode: 'גרסה נוכחית',
    registeredAt: 'תאריך רישום', lastSeenAt: 'נראה לאחרונה (מדויק)', lastSyncAt: 'סנכרון אחרון (מדויק)',
    freeStorageBytes: 'שטח פנוי (בייטים)', batteryLevel: 'אחוז סוללה', deviceOwnerLostAt: 'Device Owner אבד בתאריך',
    criticalAfterHours: 'סף קריטי (שעות)'
  };
  const RETRY_ACTIONS = {
    SYNC_STALE: { action: 'retry-sync', label: 'נסה סנכרון מחדש' },
    UPDATE_FAILED: { action: 'retry-update', label: 'נסה עדכון מחדש' }
  };

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function loginRequired() {
    const modal = document.getElementById('diagnosticsModal');
    const login = document.getElementById('loginScreen');
    if (modal) modal.style.display = 'none';
    if (login) login.style.display = 'flex';
  }
  function fmtRelative(iso) {
    if (!iso) return 'מעולם לא';
    const time = new Date(iso).getTime();
    if (!Number.isFinite(time)) return 'אין נתון';
    const diff = Math.max(0, Date.now() - time);
    if (diff < HOUR_MS) return 'לפני פחות משעה';
    if (diff < DAY_MS) return `לפני ${Math.floor(diff / HOUR_MS)} שעות`;
    return `לפני ${Math.floor(diff / DAY_MS)} ימים`;
  }
  function technicalDetailsHtml(details) {
    const keys = Object.keys(details || {}).filter(k => details[k] != null && details[k] !== '');
    if (!keys.length) return '';
    return '<div class="diag-fault-tech">' + keys.map(k => `<div class="diag-fault-row"><span class="k">${esc(TECH_LABEL[k] || k)}: </span>${esc(details[k])}</div>`).join('') + '</div>';
  }
  function fixBadgeHtml(f) {
    if (f.remoteFixAvailable === true) return '<span class="diag-fix-badge remote">ניתן לתיקון מרחוק</span>';
    if (f.physicalAccessRequired === true) return '<span class="diag-fix-badge physical">נדרשת גישה למכשיר</span>';
    return '<span class="diag-fix-badge neutral">אין פעולה נדרשת כרגע</span>';
  }
  function retryActionBlock(deviceId, code) {
    const cfg = RETRY_ACTIONS[code];
    if (!cfg) return '';
    return `<div class="diag-retry-row"><button class="diag-retry-btn" data-device-id="${esc(deviceId)}" data-action="${esc(cfg.action)}">${esc(cfg.label)}</button><span class="diag-retry-status"></span></div>`;
  }
  function faultCard(f, deviceId) {
    return `<div class="diag-fault-card severity-${esc(f.severity)}">
      <div class="diag-fault-header"><span class="diag-severity-badge ${esc(f.severity)}">${esc(SEVERITY_LABEL[f.severity] || f.severity)}</span><span class="diag-fault-title">${esc(f.title)}</span>${fixBadgeHtml(f)}</div>
      <div class="diag-fault-desc">${esc(f.description)}</div>
      <div class="diag-fault-row"><span class="k">סיבה סבירה: </span>${esc(f.likelyCause)}</div>
      <div class="diag-fault-row"><span class="k">מה לעשות עכשיו: </span>${esc(f.recommendedAction)}</div>
      ${technicalDetailsHtml(f.technicalDetails)}${retryActionBlock(deviceId, f.code)}</div>`;
  }

  async function handleRetryAction(btn) {
    const deviceId = btn.dataset.deviceId;
    const action = btn.dataset.action;
    const statusEl = btn.parentElement.querySelector('.diag-retry-status');
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = 'שולח...';
    statusEl.textContent = ''; statusEl.className = 'diag-retry-status';
    try {
      const res = await fetch(`/api/health/devices/${encodeURIComponent(deviceId)}/actions/${encodeURIComponent(action)}`, { method: 'POST' });
      if (res.status === 401) { loginRequired(); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'שגיאה בשליחת הבקשה');
      statusEl.textContent = body.status === 'sent' ? (body.message || 'הבקשה נשלחה למכשיר') : (body.message || 'לא ניתן היה לשלוח את הבקשה');
      statusEl.classList.add(body.status === 'sent' ? 'sent' : 'info');
    } catch (e) {
      statusEl.textContent = e && e.message ? e.message : 'שגיאת תקשורת - נסה שוב';
      statusEl.classList.add('error');
    } finally {
      btn.disabled = false; btn.textContent = old;
    }
  }

  function dnsSectionHtml(deviceId, h, providerFilters) {
    const requested = h.dnsFilteringRequested == null ? 'אין נתון' : (h.dnsFilteringRequested ? 'הפעלה' : 'כיבוי');
    const actual = h.dnsFilteringActual == null ? 'אין נתון' : (h.dnsFilteringActual ? 'פעיל (Strict)' : 'לא פעיל');
    const pending = h.dnsFilteringRequested != null && h.dnsFilteringActual != null && Boolean(h.dnsFilteringRequested) !== Boolean(h.dnsFilteringActual);
    const rollback = h.lastRollbackAt ? `${esc(fmtRelative(h.lastRollbackAt))}${h.dnsFailureReason ? ' - ' + esc(h.dnsFailureReason) : ''}` : 'לא היה';
    const title = providerFilters ? 'סינון DNS (חוסם תוכן)' : 'סינון DNS (הצפנה בלבד - הספק אינו חוסם תוכן)';
    return `<div class="diag-section"><h3>${esc(title)}</h3>
      <div class="diag-header-grid">
        <div class="diag-field"><span class="k">רצוי: </span><span class="v">${esc(requested)}${pending ? ' (ממתין לאישור מהמכשיר)' : ''}</span></div>
        <div class="diag-field"><span class="k">בפועל: </span><span class="v">${esc(actual)}</span></div>
        <div class="diag-field"><span class="k">מצב: </span><span class="v">${esc(DNS_MODE_LABEL[h.dnsMode] || h.dnsMode || 'אין נתון')}</span></div>
        <div class="diag-field"><span class="k">ספק רצוי: </span><span class="v">${esc(h.dnsDesiredProviderHost || '—')}</span></div>
        <div class="diag-field"><span class="k">ספק בפועל: </span><span class="v">${esc(h.dnsActualProviderHost || '—')}</span></div>
        <div class="diag-field"><span class="k">רשת: </span><span class="v">${esc(DNS_NETWORK_LABEL[h.currentNetworkType] || h.currentNetworkType || 'אין נתון')}</span></div>
        <div class="diag-field"><span class="k">DNS תקין: </span><span class="v">${h.dnsResolutionOk == null ? 'אין נתון' : (h.dnsResolutionOk ? 'כן' : 'לא')}</span></div>
        <div class="diag-field"><span class="k">DoT זמין: </span><span class="v">${h.dotProviderReachable == null ? 'אין נתון' : (h.dotProviderReachable ? 'כן' : 'לא')}</span></div>
        <div class="diag-field"><span class="k">Fail-safe: </span><span class="v">${esc(DNS_FAIL_SAFE_LABEL[h.dnsFailSafeState] || h.dnsFailSafeState || 'אין נתון')}</span></div>
        <div class="diag-field"><span class="k">בדיקה אחרונה: </span><span class="v">${h.lastDnsCheckAt ? esc(fmtRelative(h.lastDnsCheckAt)) : 'טרם נבדק'}</span></div>
        <div class="diag-field"><span class="k">rollback אחרון: </span><span class="v">${rollback}</span></div>
      </div>
      <div class="diag-retry-row">
        <button class="diag-retry-btn" data-device-id="${esc(deviceId)}" data-dns-command="ENABLE_DNS_FILTERING">הפעל סינון</button>
        <button class="diag-retry-btn" data-device-id="${esc(deviceId)}" data-dns-command="DISABLE_DNS_FILTERING">כבה סינון</button>
        <button class="diag-retry-btn" data-device-id="${esc(deviceId)}" data-action="retry-sync">רענן סטטוס</button><span class="diag-retry-status"></span>
      </div>
      <div class="diag-retry-row"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" data-allow-toggle-device-id="${esc(deviceId)}" ${h.allowCustomerDnsToggle ? 'checked' : ''}/><span class="diag-field k">לאפשר ללקוח לשלוט בעצמו במתג ה-DNS באפליקציה</span></label></div>
    </div>`;
  }

  async function handleDnsCommand(btn) {
    const deviceId = btn.dataset.deviceId;
    const command = btn.dataset.dnsCommand;
    const statusEl = btn.parentElement.querySelector('.diag-retry-status');
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = 'שולח...';
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/commands`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ command }) });
      if (res.status === 401) { loginRequired(); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'שגיאה בשליחת הפקודה');
      statusEl.textContent = 'הפקודה נשלחה — הסטטוס יתעדכן לאחר שהמכשיר יסנכרן וידווח מצב בפועל';
      statusEl.className = 'diag-retry-status sent';
    } catch (e) {
      statusEl.textContent = e && e.message ? e.message : 'שגיאת תקשורת';
      statusEl.className = 'diag-retry-status error';
    } finally {
      btn.disabled = false; btn.textContent = old;
    }
  }

  async function handleAllowToggleChange(cb) {
    const deviceId = cb.dataset.allowToggleDeviceId;
    const allow = cb.checked;
    cb.disabled = true;
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/dns/allow-customer-toggle`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ allow }) });
      if (res.status === 401) { loginRequired(); return; }
      if (!res.ok) throw new Error('שמירת ההגדרה נכשלה');
      await openDeviceDiagnostics(deviceId);
    } catch (_) {
      cb.checked = !allow;
      cb.disabled = false;
    }
  }

  function renderDiagnostics(data) {
    const h = data.health || {};
    const title = document.getElementById('diagnosticsTitle');
    if (title) title.textContent = h.customerName || 'לקוח ללא שם';
    const owner = h.isDeviceOwner === true ? 'כן' : h.isDeviceOwner === false ? 'לא' : 'אין נתון';
    const version = [h.currentVersionName, h.currentVersionCode != null ? `(${h.currentVersionCode})` : null].filter(Boolean).join(' ') || '—';
    const header = `<div class="diag-section"><div class="diag-header-grid">
      <div class="diag-field"><span class="k">שם לקוח: </span><span class="v">${esc(h.customerName || 'ללא שם')}</span></div>
      <div class="diag-field"><span class="k">דגם: </span><span class="v">${esc(h.model || '—')}</span></div>
      <div class="diag-field"><span class="k">מצב כללי: </span><span class="health-badge ${esc(h.status || 'unknown')}">${esc(STATUS_LABEL[h.status] || h.status || 'ממתין לנתונים')}</span></div>
      <div class="diag-field"><span class="k">נראה לאחרונה: </span><span class="v">${esc(fmtRelative(h.lastSeenAt))}</span></div>
      <div class="diag-field"><span class="k">סנכרון אחרון: </span><span class="v">${esc(fmtRelative(h.lastSyncAt))}</span></div>
      <div class="diag-field"><span class="k">Device Owner: </span><span class="v">${esc(owner)}</span></div>
      <div class="diag-field"><span class="k">גרסת MDM: </span><span class="v">${esc(version)}</span></div>
    </div></div>`;
    const faults = Array.isArray(data.faults) && data.faults.length ? data.faults.map(f => faultCard(f, data.deviceId)).join('') : '<div class="empty-state">לא נמצאו תקלות פעילות במכשיר</div>';
    document.getElementById('diagnosticsContent').innerHTML = header + `<div class="diag-section"><h3>אבחון פעיל</h3>${faults}</div>` + dnsSectionHtml(data.deviceId, h, data.dnsProviderFilters);
    document.querySelectorAll('#diagnosticsContent .diag-retry-btn').forEach(btn => btn.addEventListener('click', () => btn.dataset.dnsCommand ? handleDnsCommand(btn) : handleRetryAction(btn)));
    document.querySelectorAll('#diagnosticsContent [data-allow-toggle-device-id]').forEach(cb => cb.addEventListener('change', () => handleAllowToggleChange(cb)));
  }

  async function openDeviceDiagnostics(deviceId) {
    const modal = document.getElementById('diagnosticsModal');
    document.getElementById('diagnosticsTitle').textContent = '';
    document.getElementById('diagnosticsContent').innerHTML = '<div class="empty-state">טוען אבחון...</div>';
    modal.style.display = 'block'; window.scrollTo(0, 0);
    try {
      const res = await fetch(`/api/health/devices/${encodeURIComponent(deviceId)}/diagnostics`);
      if (res.status === 401) { loginRequired(); return; }
      if (!res.ok) throw new Error('שגיאה בטעינת אבחון');
      renderDiagnostics(await res.json());
    } catch (e) {
      document.getElementById('diagnosticsContent').innerHTML = `<div class="empty-state">${esc(e && e.message ? e.message : 'שגיאת תקשורת')}</div>`;
    }
  }
  function closeDiagnostics() { document.getElementById('diagnosticsModal').style.display = 'none'; }
  document.getElementById('diagnosticsBackBtn')?.addEventListener('click', closeDiagnostics);
  window.openDeviceDiagnostics = openDeviceDiagnostics;
})();
