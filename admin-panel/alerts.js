// "התראות" tab - entirely separate from health.js/diagnostics.js/the main
// inline script. Read-only: lists currently-active alerts (opened/resolved
// server-side as a side effect of device sync) and reuses the existing
// diagnostics screen via window.openDeviceDiagnostics - no new diagnosis UI.
(function () {
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtRelative(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < HOUR_MS) return 'לפני פחות משעה';
    if (diff < DAY_MS) return `לפני ${Math.floor(diff / HOUR_MS)} שעות`;
    return `לפני ${Math.floor(diff / DAY_MS)} ימים`;
  }

  const SEVERITY_LABEL = { critical: 'קריטי', warning: 'אזהרה' };

  function summaryCard(cls, label, value) {
    return `
      <div class="alerts-stat-card ${cls}">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${value}</div>
      </div>`;
  }

  function renderSummary(list) {
    const critical = list.filter(a => a.severity === 'critical').length;
    const warning = list.filter(a => a.severity === 'warning').length;
    document.getElementById('alertsSummary').innerHTML = [
      summaryCard('', 'סה"כ התראות פעילות', list.length),
      summaryCard('critical', 'קריטיות', critical),
      summaryCard('warning', 'אזהרות', warning),
    ].join('');
  }

  function alertCard(a) {
    const name = a.customerName ? escapeHtml(a.customerName) : 'ללא שם';
    const sub = [a.model, 'מזהה: ' + a.deviceId].filter(Boolean).map(escapeHtml).join(' · ');
    return `
      <div class="alert-card severity-${escapeHtml(a.severity)}">
        <div class="alert-card-header">
          <div>
            <div class="alert-card-title">${escapeHtml(a.message)}</div>
            <div class="alert-card-sub">${name} · ${sub}</div>
          </div>
          <span class="alert-severity-badge ${escapeHtml(a.severity)}">${escapeHtml(SEVERITY_LABEL[a.severity] || a.severity)}</span>
        </div>
        <div class="alert-card-time">נפתחה ${escapeHtml(fmtRelative(a.createdAt))}</div>
        <button class="alert-diagnose-btn" data-device-id="${escapeHtml(a.deviceId)}">פתח אבחון</button>
      </div>`;
  }

  function renderList(list) {
    const root = document.getElementById('alertsList');
    if (!list.length) {
      root.innerHTML = '<div class="empty-state">הכול תקין — אין התראות פעילות</div>';
      return;
    }
    root.innerHTML = list.map(alertCard).join('');
    root.querySelectorAll('[data-device-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.openDeviceDiagnostics) window.openDeviceDiagnostics(btn.getAttribute('data-device-id'));
      });
    });
  }

  async function loadAlerts() {
    let res;
    try {
      res = await fetch('/api/alerts');
    } catch (e) {
      document.getElementById('alertsList').innerHTML = '<div class="empty-state">שגיאת תקשורת</div>';
      return;
    }
    if (res.status === 401) {
      document.getElementById('loginScreen').style.display = 'flex';
      return;
    }
    if (!res.ok) {
      document.getElementById('alertsList').innerHTML = '<div class="empty-state">שגיאה בטעינת התראות</div>';
      return;
    }
    const list = await res.json();
    renderSummary(list);
    renderList(list);
  }

  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === 'alerts') {
      btn.addEventListener('click', loadAlerts);
    }
  });

  const refreshBtn = document.getElementById('alertsRefreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadAlerts);
})();
