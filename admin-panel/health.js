// "בריאות מכשירים" tab - entirely separate from the main inline script in
// index.html. Fetches the two read-only health endpoints and renders them;
// it never touches allDevices or any other state the main script owns.
(function () {
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;

  const STATUS_LABEL = {
    ok: 'תקין',
    warning: 'דורש תשומת לב',
    critical: 'קריטי',
    unknown: 'ממתין לנתונים',
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

  function fmtAbsolute(iso) {
    return iso ? new Date(iso).toLocaleString('he-IL') : '—';
  }

  function fmtBytes(bytes) {
    if (bytes == null) return '—';
    const gb = bytes / (1024 ** 3);
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / (1024 ** 2))} MB`;
  }

  function summaryCard(cls, label, value) {
    return `
      <div class="health-stat-card ${cls}">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${value == null ? '—' : escapeHtml(String(value))}</div>
      </div>`;
  }

  function renderSummary(s) {
    document.getElementById('healthSummary').innerHTML = [
      summaryCard('', 'סה"כ מכשירים', s.total),
      summaryCard('ok', 'תקינים', s.ok),
      summaryCard('warning', 'דורשים תשומת לב', s.warning),
      summaryCard('critical', 'קריטיים', s.critical),
      summaryCard('unknown', 'ממתינים לנתונים', s.unknown),
      summaryCard('warning', 'לא נראו לאחרונה', s.staleLastSeen),
      summaryCard('critical', 'עדכון אחרון נכשל', s.updateFailed),
      summaryCard('', 'על גרסה ישנה', s.outdatedVersion == null ? 'בקרוב' : s.outdatedVersion),
    ].join('');
  }

  function deviceCard(d) {
    const name = d.customerName ? escapeHtml(d.customerName) : 'ללא שם';
    const number = d.customerNumber ? ' · #' + escapeHtml(d.customerNumber) : '';
    const sub = [d.manufacturer, d.model, d.androidVersion ? 'Android ' + d.androidVersion : null]
      .filter(Boolean).map(escapeHtml).join(' · ') || 'אין פרטי מכשיר עדיין';

    const reasonsHtml = d.reasons && d.reasons.length
      ? `<ul class="health-reasons">${d.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
      : '';

    const ownerText = d.isDeviceOwner === true ? 'כן' : d.isDeviceOwner === false ? 'לא' : 'אין נתון';

    const fields = [
      ['נראה לאחרונה', fmtRelative(d.lastSeenAt)],
      ['סנכרון אחרון', fmtRelative(d.lastSyncAt)],
      ['Device Owner', ownerText],
      ['סוללה', d.batteryLevel != null ? `${d.batteryLevel}%` : '—'],
      ['אחסון פנוי', fmtBytes(d.freeStorageBytes)],
      ['סטטוס עדכון אחרון', d.lastUpdateStatus || '—'],
    ];
    const fieldsHtml = fields.map(([k, v]) => `
      <div class="health-field"><span class="k">${escapeHtml(k)}: </span><span class="v">${escapeHtml(v)}</span></div>
    `).join('');

    const detailsHtml = `
      <details class="health-details">
        <summary>פרטים טכניים</summary>
        <div class="health-grid" style="margin-top:8px;">
          <div class="health-field"><span class="k">מזהה מכשיר: </span><span class="v">${escapeHtml(d.deviceId)}</span></div>
          <div class="health-field"><span class="k">גרסה נוכחית: </span><span class="v">${escapeHtml(d.currentVersionName || '—')} (${d.currentVersionCode != null ? d.currentVersionCode : '—'})</span></div>
          <div class="health-field"><span class="k">גרסת עדכון אחרונה: </span><span class="v">${d.lastUpdateVersion != null ? d.lastUpdateVersion : '—'}</span></div>
          <div class="health-field"><span class="k">שגיאת עדכון אחרונה: </span><span class="v">${escapeHtml(d.lastUpdateError || '—')}</span></div>
          <div class="health-field"><span class="k">נראה לאחרונה (מדויק): </span><span class="v">${fmtAbsolute(d.lastSeenAt)}</span></div>
          <div class="health-field"><span class="k">סנכרון אחרון (מדויק): </span><span class="v">${fmtAbsolute(d.lastSyncAt)}</span></div>
        </div>
      </details>`;

    return `
      <div class="health-device-card">
        <div class="health-device-header">
          <div>
            <div class="health-device-name">${name}${number}</div>
            <div class="health-device-sub">${sub}</div>
          </div>
          <span class="health-badge ${d.status}">${escapeHtml(STATUS_LABEL[d.status] || d.status)}</span>
        </div>
        ${reasonsHtml}
        <div class="health-grid">${fieldsHtml}</div>
        ${detailsHtml}
        <button class="health-diagnose-btn" data-diagnose="${escapeHtml(d.deviceId)}">אבחון ותיקון</button>
      </div>`;
  }

  function openDiagnosePlaceholder(deviceId) {
    alert('אבחון ותיקון מרחוק עבור מכשיר ' + deviceId + ' — בקרוב.');
  }

  function renderDevices(devices) {
    const root = document.getElementById('healthDevices');
    if (!devices.length) {
      root.innerHTML = '<div class="empty-state">עוד לא נרשמו מכשירים</div>';
      return;
    }
    root.innerHTML = devices.map(deviceCard).join('');
    root.querySelectorAll('[data-diagnose]').forEach(btn => {
      btn.addEventListener('click', () => openDiagnosePlaceholder(btn.getAttribute('data-diagnose')));
    });
  }

  async function loadHealthPanel() {
    let summaryRes, devicesRes;
    try {
      [summaryRes, devicesRes] = await Promise.all([
        fetch('/api/health/summary'),
        fetch('/api/health/devices'),
      ]);
    } catch (e) {
      document.getElementById('healthDevices').innerHTML = '<div class="empty-state">שגיאת תקשורת</div>';
      return;
    }
    if (summaryRes.status === 401 || devicesRes.status === 401) {
      document.getElementById('loginScreen').style.display = 'flex';
      return;
    }
    if (!summaryRes.ok || !devicesRes.ok) {
      document.getElementById('healthDevices').innerHTML = '<div class="empty-state">שגיאה בטעינת נתוני בריאות</div>';
      return;
    }
    renderSummary(await summaryRes.json());
    renderDevices(await devicesRes.json());
  }

  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === 'health') {
      btn.addEventListener('click', loadHealthPanel);
    }
  });

  const refreshBtn = document.getElementById('healthRefreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadHealthPanel);
})();
