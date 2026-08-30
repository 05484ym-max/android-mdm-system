// "אבחון ותיקון" screen for one device - entirely separate from health.js and
// the main inline script. Read-only: never sends a command, never queues
// anything, only fetches and renders the diagnosis for the device it was
// opened for.
(function () {
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;

  const STATUS_LABEL = {
    ok: 'תקין', warning: 'דורש תשומת לב', critical: 'קריטי', unknown: 'ממתין לנתונים',
  };
  const SEVERITY_LABEL = { critical: 'קריטי', warning: 'אזהרה', info: 'מידע' };
  const TECH_LABEL = {
    lastUpdateVersion: 'גרסת עדכון שנכשלה',
    lastUpdateError: 'פרטי שגיאה',
    currentVersionCode: 'גרסה נוכחית',
    registeredAt: 'תאריך רישום',
    lastSeenAt: 'נראה לאחרונה (מדויק)',
    lastSyncAt: 'סנכרון אחרון (מדויק)',
    freeStorageBytes: 'שטח פנוי (בייטים)',
    batteryLevel: 'אחוז סוללה',
    deviceOwnerLostAt: 'Device Owner אבד בתאריך',
    criticalAfterHours: 'סף קריטי (שעות)',
  };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtRelative(iso) {
    if (!iso) return 'מעולם לא';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < HOUR_MS) return 'לפני פחות משעה';
    if (diff < DAY_MS) return `לפני ${Math.floor(diff / HOUR_MS)} שעות`;
    return `לפני ${Math.floor(diff / DAY_MS)} ימים`;
  }

  function technicalDetailsHtml(details) {
    const keys = Object.keys(details || {}).filter(k => details[k] != null && details[k] !== '');
    if (!keys.length) return '';
    return '<div class="diag-fault-tech">' + keys.map(k =>
      `<div class="diag-fault-row"><span class="k">${escapeHtml(TECH_LABEL[k] || k)}: </span>${escapeHtml(String(details[k]))}</div>`
    ).join('') + '</div>';
  }

  function fixBadgeHtml(f) {
    if (f.remoteFixAvailable === true) {
      return '<span class="diag-fix-badge remote">ניתן לתיקון מרחוק</span>';
    }
    if (f.physicalAccessRequired === true) {
      return '<span class="diag-fix-badge physical">נדרשת גישה למכשיר</span>';
    }
    return '<span class="diag-fix-badge neutral">אין פעולה נדרשת כרגע</span>';
  }

  function faultCard(f) {
    const fixBadge = fixBadgeHtml(f);
    return `
      <div class="diag-fault-card severity-${escapeHtml(f.severity)}">
        <div class="diag-fault-header">
          <span class="diag-severity-badge ${escapeHtml(f.severity)}">${escapeHtml(SEVERITY_LABEL[f.severity] || f.severity)}</span>
          <span class="diag-fault-title">${escapeHtml(f.title)}</span>
          ${fixBadge}
        </div>
        <div class="diag-fault-desc">${escapeHtml(f.description)}</div>
        <div class="diag-fault-row"><span class="k">סיבה סבירה: </span>${escapeHtml(f.likelyCause)}</div>
        <div class="diag-fault-row"><span class="k">מה לעשות עכשיו: </span>${escapeHtml(f.recommendedAction)}</div>
        ${technicalDetailsHtml(f.technicalDetails)}
      </div>`;
  }

  function renderDiagnostics(data) {
    const h = data.health;
    document.getElementById('diagnosticsTitle').textContent = h.customerName || 'לקוח ללא שם';

    const ownerText = h.isDeviceOwner === true ? 'כן' : h.isDeviceOwner === false ? 'לא' : 'אין נתון';
    const versionText = [h.currentVersionName, h.currentVersionCode != null ? `(${h.currentVersionCode})` : null]
      .filter(Boolean).join(' ') || '—';

    const headerHtml = `
      <div class="diag-section">
        <div class="diag-header-grid">
          <div class="diag-field"><span class="k">שם לקוח: </span><span class="v">${escapeHtml(h.customerName || 'ללא שם')}</span></div>
          <div class="diag-field"><span class="k">דגם: </span><span class="v">${escapeHtml(h.model || '—')}</span></div>
          <div class="diag-field"><span class="k">מצב כללי: </span><span class="health-badge ${escapeHtml(h.status)}">${escapeHtml(STATUS_LABEL[h.status] || h.status)}</span></div>
          <div class="diag-field"><span class="k">נראה לאחרונה: </span><span class="v">${escapeHtml(fmtRelative(h.lastSeenAt))}</span></div>
          <div class="diag-field"><span class="k">סנכרון אחרון: </span><span class="v">${escapeHtml(fmtRelative(h.lastSyncAt))}</span></div>
          <div class="diag-field"><span class="k">Device Owner: </span><span class="v">${escapeHtml(ownerText)}</span></div>
          <div class="diag-field"><span class="k">גרסת MDM: </span><span class="v">${escapeHtml(versionText)}</span></div>
        </div>
      </div>`;

    const faultsHtml = data.faults && data.faults.length
      ? data.faults.map(faultCard).join('')
      : '<div class="empty-state">לא נמצאו תקלות פעילות במכשיר</div>';

    document.getElementById('diagnosticsContent').innerHTML = headerHtml +
      `<div class="diag-section"><h3>אבחון פעיל</h3>${faultsHtml}</div>`;
  }

  async function openDeviceDiagnostics(deviceId) {
    const modal = document.getElementById('diagnosticsModal');
    document.getElementById('diagnosticsTitle').textContent = '';
    document.getElementById('diagnosticsContent').innerHTML = '<div class="empty-state">טוען אבחון...</div>';
    modal.style.display = 'block';
    window.scrollTo(0, 0);

    let res;
    try {
      res = await fetch(`/api/health/devices/${encodeURIComponent(deviceId)}/diagnostics`);
    } catch (e) {
      document.getElementById('diagnosticsContent').innerHTML = '<div class="empty-state">שגיאת תקשורת</div>';
      return;
    }
    if (res.status === 401) {
      modal.style.display = 'none';
      document.getElementById('loginScreen').style.display = 'flex';
      return;
    }
    if (!res.ok) {
      document.getElementById('diagnosticsContent').innerHTML = '<div class="empty-state">שגיאה בטעינת אבחון</div>';
      return;
    }
    renderDiagnostics(await res.json());
  }

  function closeDiagnostics() {
    document.getElementById('diagnosticsModal').style.display = 'none';
  }

  const backBtn = document.getElementById('diagnosticsBackBtn');
  if (backBtn) backBtn.addEventListener('click', closeDiagnostics);

  window.openDeviceDiagnostics = openDeviceDiagnostics;
})();
