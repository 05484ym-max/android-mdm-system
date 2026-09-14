// Simple, actionable device diagnostics.
(function () {
  'use strict';

  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const STATUS_LABEL = { ok: 'תקין', warning: 'דורש טיפול', critical: 'קריטי', unknown: 'ממתין לנתונים' };
  const SEVERITY_LABEL = { critical: 'קריטי', warning: 'דורש טיפול', info: 'מידע' };
  const TECH_LABEL = {
    lastUpdateVersion: 'גרסת עדכון שנכשלה',
    lastUpdateError: 'שגיאת העדכון',
    currentVersionCode: 'גרסה נוכחית',
    registeredAt: 'תאריך רישום',
    lastSeenAt: 'נראה לאחרונה',
    lastSyncAt: 'סנכרון אחרון',
    freeStorageBytes: 'שטח פנוי (בייטים)',
    deviceOwnerLostAt: 'Device Owner אבד בתאריך',
    criticalAfterHours: 'סף ניתוק (שעות)',
    pendingCount: 'פקודות ממתינות',
    oldestPendingAt: 'הפקודה הממתינה הוותיקה ביותר',
  };

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  function loginRequired() {
    const modal = document.getElementById('diagnosticsModal');
    const login = document.getElementById('loginScreen');
    if (modal) modal.style.display = 'none';
    if (login) login.style.display = 'flex';
  }

  function fmtRelative(value) {
    if (!value) return 'מעולם לא';
    const raw = typeof value === 'number' ? value : new Date(value).getTime();
    if (!Number.isFinite(raw)) return 'אין נתון';
    const diff = Math.max(0, Date.now() - raw);
    if (diff < HOUR_MS) return 'לפני פחות משעה';
    if (diff < DAY_MS) return `לפני ${Math.floor(diff / HOUR_MS)} שעות`;
    return `לפני ${Math.floor(diff / DAY_MS)} ימים`;
  }

  function technicalDetailsHtml(details) {
    const keys = Object.keys(details || {}).filter(k => details[k] != null && details[k] !== '');
    if (!keys.length) return '';
    const rows = keys.map(k => `<div class="diag-fault-row"><span class="k">${esc(TECH_LABEL[k] || k)}: </span>${esc(details[k])}</div>`).join('');
    return `<details class="health-details" style="margin-top:10px"><summary>מידע טכני</summary><div class="diag-fault-tech">${rows}</div></details>`;
  }

  function clientFaults(device, existingFaults) {
    if (!device) return [];
    const out = [];
    const policy = device.policy || {};
    const wa = policy.whatsappGuard || {};
    const status = device.status || {};
    const waRequested = Boolean(wa.blockStatuses || wa.blockChannels || wa.hideProfilePhotos);

    if (waRequested && status.whatsappGuardAccessibilityEnabled !== true) {
      out.push({
        code: 'WHATSAPP_ACCESSIBILITY_OFF',
        severity: 'warning',
        title: 'סינון WhatsApp לא פעיל',
        description: 'הגנת WhatsApp מוגדרת בפאנל, אבל שירות הנגישות אינו פעיל במכשיר.',
        solution: 'במכשיר: פתח יהודי כשר > הגנת WhatsApp > הפעל את שירות הנגישות. לאחר מכן לחץ סנכרון ורענן את האבחון.',
        remoteFixAvailable: false,
        physicalAccessRequired: true,
      });
    }

    const registeredAt = device.registeredAt ? new Date(device.registeredAt).getTime() : 0;
    const oldEnough = registeredAt && Date.now() - registeredAt > 10 * 60 * 1000;
    if (oldEnough && device.pushToken == null && status && Object.keys(status).length) {
      out.push({
        code: 'PUSH_TOKEN_MISSING',
        severity: 'warning',
        title: 'שליטה מיידית מרחוק אינה זמינה',
        description: 'למכשיר אין Push Token פעיל, ולכן פקודות מרחוק עלולות להמתין לסנכרון הבא.',
        solution: 'במכשיר: פתח יהודי כשר ולחץ סנכרון. האפליקציה תנסה לרשום Push מחדש אוטומטית.',
        remoteFixAvailable: false,
        physicalAccessRequired: true,
      });
    }

    const pending = Array.isArray(device.pendingCommands) ? device.pendingCommands : [];
    const oldPending = pending.filter(c => c && c.queuedAt && Date.now() - new Date(c.queuedAt).getTime() > 30 * 60 * 1000);
    const syncAlreadyReported = (existingFaults || []).some(f => f.code === 'SYNC_STALE');
    if (oldPending.length && !syncAlreadyReported) {
      const oldest = oldPending.reduce((a, b) => new Date(a.queuedAt) < new Date(b.queuedAt) ? a : b);
      out.push({
        code: 'COMMAND_STUCK',
        severity: 'warning',
        title: 'פקודה ממתינה יותר מדי זמן',
        description: `${oldPending.length} פקודות עדיין לא נמסרו למכשיר.`,
        solution: 'לחץ "נסה סנכרון עכשיו". אם הפקודה עדיין ממתינה לאחר הרענון, בדוק את החיבור במכשיר.',
        remoteFixAvailable: true,
        physicalAccessRequired: false,
        technicalDetails: { pendingCount: oldPending.length, oldestPendingAt: oldest.queuedAt },
      });
    }

    return out;
  }

  function actionHtml(f, deviceId) {
    if (f.code === 'SYNC_STALE') {
      return `<button class="diag-retry-btn" data-device-id="${esc(deviceId)}" data-health-action="retry-sync">נסה סנכרון מחדש</button>`;
    }
    if (f.code === 'UPDATE_FAILED') {
      return `<button class="diag-retry-btn" data-device-id="${esc(deviceId)}" data-health-action="retry-update">נסה עדכון מחדש</button>`;
    }
    if (f.code === 'COMMAND_STUCK') {
      return `<button class="diag-retry-btn" data-device-id="${esc(deviceId)}" data-command="SYNC_POLICY">נסה סנכרון עכשיו</button>`;
    }
    if (f.code === 'DEVICE_OWNER_LOST' || f.code === 'NEVER_CONTACTED') {
      return `<button class="diag-retry-btn" data-device-id="${esc(deviceId)}" data-enrollment>צור קוד רישום חדש</button>`;
    }
    return '';
  }

  function faultCard(f, deviceId) {
    const mode = f.remoteFixAvailable ? 'ניתן לנסות מרחוק' : (f.physicalAccessRequired ? 'נדרשת פעולה במכשיר' : 'מידע');
    return `<div class="diag-fault-card severity-${esc(f.severity)}">
      <div class="diag-fault-header">
        <span class="diag-severity-badge ${esc(f.severity)}">${esc(SEVERITY_LABEL[f.severity] || f.severity)}</span>
        <span class="diag-fault-title">${esc(f.title)}</span>
        <span class="diag-fix-badge ${f.remoteFixAvailable ? 'remote' : (f.physicalAccessRequired ? 'physical' : 'neutral')}">${esc(mode)}</span>
      </div>
      <div class="diag-fault-desc">${esc(f.description)}</div>
      <div class="diag-fault-row" style="margin-top:10px"><strong>פתרון: </strong>${esc(f.solution || f.recommendedAction || 'רענן את האבחון ובדוק שוב.')}</div>
      ${actionHtml(f, deviceId)}
      <span class="diag-retry-status"></span>
      ${technicalDetailsHtml(f.technicalDetails)}
    </div>`;
  }

  async function runHealthAction(btn) {
    const deviceId = btn.dataset.deviceId;
    const action = btn.dataset.healthAction;
    const statusEl = btn.parentElement.querySelector('.diag-retry-status');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'שולח...';
    try {
      const res = await fetch(`/api/health/devices/${encodeURIComponent(deviceId)}/actions/${encodeURIComponent(action)}`, { method: 'POST' });
      if (res.status === 401) { loginRequired(); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'הפעולה נכשלה');
      statusEl.textContent = body.message || 'הבקשה נשלחה. רענן את האבחון בעוד רגע.';
      statusEl.className = 'diag-retry-status sent';
    } catch (e) {
      statusEl.textContent = e && e.message ? e.message : 'שגיאת תקשורת';
      statusEl.className = 'diag-retry-status error';
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  async function runCommand(btn) {
    const deviceId = btn.dataset.deviceId;
    const command = btn.dataset.command;
    const statusEl = btn.parentElement.querySelector('.diag-retry-status');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'שולח...';
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/commands`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ command })
      });
      if (res.status === 401) { loginRequired(); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'שליחת הפקודה נכשלה');
      statusEl.textContent = 'הפקודה נשלחה. רענן את האבחון בעוד רגע.';
      statusEl.className = 'diag-retry-status sent';
    } catch (e) {
      statusEl.textContent = e && e.message ? e.message : 'שגיאת תקשורת';
      statusEl.className = 'diag-retry-status error';
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  async function generateEnrollment(btn) {
    const statusEl = btn.parentElement.querySelector('.diag-retry-status');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'יוצר...';
    try {
      const res = await fetch('/api/enrollments', { method: 'POST' });
      if (res.status === 401) { loginRequired(); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.token) throw new Error(body.error || 'יצירת קוד נכשלה');
      statusEl.textContent = `קוד רישום חדש: ${body.token}`;
      statusEl.className = 'diag-retry-status sent';
      try { await navigator.clipboard.writeText(body.token); statusEl.textContent += ' · הועתק'; } catch (_) {}
    } catch (e) {
      statusEl.textContent = e && e.message ? e.message : 'שגיאת תקשורת';
      statusEl.className = 'diag-retry-status error';
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  function dnsSectionHtml(deviceId, h, providerFilters) {
    const requested = h.dnsFilteringRequested == null ? 'אין נתון' : (h.dnsFilteringRequested ? 'פעיל' : 'כבוי');
    const actual = h.dnsFilteringActual == null ? 'אין נתון' : (h.dnsFilteringActual ? 'פעיל' : 'כבוי');
    const mismatch = h.dnsFilteringRequested != null && h.dnsFilteringActual != null && Boolean(h.dnsFilteringRequested) !== Boolean(h.dnsFilteringActual);
    const ok = !mismatch && h.dnsResolutionOk !== false;
    return `<div class="diag-section">
      <h3>סינון אינטרנט</h3>
      <div class="diag-header-grid">
        <div class="diag-field"><span class="k">מצב רצוי: </span><span class="v">${esc(requested)}</span></div>
        <div class="diag-field"><span class="k">מצב בפועל: </span><span class="v">${esc(actual)}</span></div>
        <div class="diag-field"><span class="k">בדיקה: </span><span class="v">${ok ? 'תקין' : 'דורש בדיקה'}</span></div>
      </div>
      ${mismatch ? '<div class="diag-fault-row"><strong>פתרון: </strong>לחץ רענן סטטוס. אם המצב נשאר שונה, שלח שוב הפעלה או כיבוי.</div>' : ''}
      <div class="diag-retry-row">
        <button class="diag-retry-btn" data-device-id="${esc(deviceId)}" data-command="ENABLE_DNS_FILTERING">הפעל סינון</button>
        <button class="diag-retry-btn" data-device-id="${esc(deviceId)}" data-command="DISABLE_DNS_FILTERING">כבה סינון</button>
        <button class="diag-retry-btn" data-device-id="${esc(deviceId)}" data-health-action="retry-sync">רענן סטטוס</button>
        <span class="diag-retry-status"></span>
      </div>
      <details class="health-details"><summary>פרטי DNS טכניים</summary>
        <div class="diag-fault-tech">
          <div class="diag-fault-row">ספק רצוי: ${esc(h.dnsDesiredProviderHost || '—')}</div>
          <div class="diag-fault-row">ספק בפועל: ${esc(h.dnsActualProviderHost || '—')}</div>
          <div class="diag-fault-row">רשת: ${esc(h.currentNetworkType || '—')}</div>
          <div class="diag-fault-row">DNS תקין: ${h.dnsResolutionOk == null ? 'אין נתון' : (h.dnsResolutionOk ? 'כן' : 'לא')}</div>
          <div class="diag-fault-row">DoT זמין: ${h.dotProviderReachable == null ? 'אין נתון' : (h.dotProviderReachable ? 'כן' : 'לא')}</div>
          <div class="diag-fault-row">בדיקה אחרונה: ${h.lastDnsCheckAt ? esc(fmtRelative(h.lastDnsCheckAt)) : 'טרם נבדק'}</div>
          <div class="diag-fault-row">סוג הספק: ${providerFilters ? 'מסנן תוכן' : 'הצפנה בלבד'}</div>
        </div>
      </details>
    </div>`;
  }

  function bindActions(root) {
    root.querySelectorAll('[data-health-action]').forEach(btn => btn.addEventListener('click', () => runHealthAction(btn)));
    root.querySelectorAll('[data-command]').forEach(btn => btn.addEventListener('click', () => runCommand(btn)));
    root.querySelectorAll('[data-enrollment]').forEach(btn => btn.addEventListener('click', () => generateEnrollment(btn)));
  }

  function renderDiagnostics(data, publicDevice) {
    const h = data.health || {};
    const faults = [...(Array.isArray(data.faults) ? data.faults : [])];
    faults.push(...clientFaults(publicDevice, faults));

    const title = document.getElementById('diagnosticsTitle');
    if (title) title.textContent = h.customerName || 'לקוח ללא שם';
    const owner = h.isDeviceOwner === true ? 'פעיל' : h.isDeviceOwner === false ? 'לא פעיל' : 'אין נתון';
    const version = [h.currentVersionName, h.currentVersionCode != null ? `(${h.currentVersionCode})` : null].filter(Boolean).join(' ') || '—';

    const header = `<div class="diag-section"><div class="diag-header-grid">
      <div class="diag-field"><span class="k">מצב: </span><span class="health-badge ${esc(h.status || 'unknown')}">${esc(STATUS_LABEL[h.status] || 'ממתין לנתונים')}</span></div>
      <div class="diag-field"><span class="k">נראה לאחרונה: </span><span class="v">${esc(fmtRelative(h.lastSeenAt))}</span></div>
      <div class="diag-field"><span class="k">סנכרון אחרון: </span><span class="v">${esc(fmtRelative(h.lastSyncAt))}</span></div>
      <div class="diag-field"><span class="k">ניהול: </span><span class="v">${esc(owner)}</span></div>
      <div class="diag-field"><span class="k">גרסה: </span><span class="v">${esc(version)}</span></div>
    </div></div>`;

    const faultsHtml = faults.length
      ? faults.map(f => faultCard(f, data.deviceId)).join('')
      : '<div class="empty-state" style="color:var(--ok)">✓ לא נמצאה תקלה שדורשת טיפול</div>';

    const root = document.getElementById('diagnosticsContent');
    root.innerHTML = header + `<div class="diag-section"><h3>מה דורש טיפול</h3>${faultsHtml}</div>` + dnsSectionHtml(data.deviceId, h, data.dnsProviderFilters);
    bindActions(root);
  }

  async function openDeviceDiagnostics(deviceId) {
    const modal = document.getElementById('diagnosticsModal');
    document.getElementById('diagnosticsTitle').textContent = '';
    document.getElementById('diagnosticsContent').innerHTML = '<div class="empty-state">בודק את המכשיר...</div>';
    modal.style.display = 'block';
    window.scrollTo(0, 0);

    try {
      const [diagRes, devicesRes] = await Promise.all([
        fetch(`/api/health/devices/${encodeURIComponent(deviceId)}/diagnostics`),
        fetch('/api/devices'),
      ]);
      if (diagRes.status === 401 || devicesRes.status === 401) { loginRequired(); return; }
      if (!diagRes.ok) throw new Error('לא ניתן לטעון את האבחון');
      const data = await diagRes.json();
      let publicDevice = null;
      if (devicesRes.ok) {
        const devices = await devicesRes.json();
        publicDevice = Array.isArray(devices) ? devices.find(d => d.deviceId === deviceId) || null : null;
      }
      renderDiagnostics(data, publicDevice);
    } catch (e) {
      document.getElementById('diagnosticsContent').innerHTML = `<div class="empty-state">${esc(e && e.message ? e.message : 'שגיאת תקשורת')}</div>`;
    }
  }

  function closeDiagnostics() {
    document.getElementById('diagnosticsModal').style.display = 'none';
  }

  document.getElementById('diagnosticsBackBtn')?.addEventListener('click', closeDiagnostics);
  window.openDeviceDiagnostics = openDeviceDiagnostics;
})();
