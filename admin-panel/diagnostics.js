// "אבחון ותיקון" screen for one device - entirely separate from health.js and
// the main inline script. Mostly read-only (fetches and renders the
// diagnosis for the device it was opened for) - the DNS section is the one
// exception, with its own enable/disable/toggle actions (see the DNS
// filtering block below).
(function () {
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;

  const STATUS_LABEL = {
    ok: 'תקין', warning: 'דורש תשומת לב', critical: 'קריטי', unknown: 'ממתין לנתונים',
  };
  const SEVERITY_LABEL = { critical: 'קריטי', warning: 'אזהרה', info: 'מידע' };
  const DNS_MODE_LABEL = {
    OFF: 'כבוי', OPPORTUNISTIC: 'Opportunistic', PROVIDER_HOSTNAME: 'Strict (מסונן)',
    UNKNOWN: 'לא ידוע', ERROR: 'שגיאת קריאה',
  };
  const DNS_FAIL_SAFE_LABEL = {
    NORMAL: 'תקין', DEGRADED: 'מנוטר (כשלים חלקיים)', ROLLED_BACK: 'בוצע rollback',
    RECOVERING: 'בתהליך התאוששות',
  };
  const DNS_NETWORK_LABEL = { WIFI: 'Wi-Fi', CELLULAR: 'סלולרי', OTHER: 'אחר', NONE: 'אין חיבור' };
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

  // Maps a fault code to the endpoint action name and button label - the
  // only two retry actions that exist today. Sending either request is not
  // the same as it actually succeeding; see handleRetryAction(), which never
  // marks a fault resolved just because the push went out.
  const RETRY_ACTIONS = {
    SYNC_STALE: { action: 'retry-sync', label: 'נסה סנכרון מחדש' },
    UPDATE_FAILED: { action: 'retry-update', label: 'נסה עדכון מחדש' },
  };

  function retryActionBlock(deviceId, code) {
    const cfg = RETRY_ACTIONS[code];
    return `
      <div class="diag-retry-row">
        <button class="diag-retry-btn" data-device-id="${escapeHtml(deviceId)}" data-action="${escapeHtml(cfg.action)}">${escapeHtml(cfg.label)}</button>
        <span class="diag-retry-status"></span>
      </div>`;
  }

  function faultCard(f, deviceId) {
    const fixBadge = fixBadgeHtml(f);
    const retryHtml = RETRY_ACTIONS[f.code] ? retryActionBlock(deviceId, f.code) : '';
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
        ${retryHtml}
      </div>`;
  }

  /** Sends whichever retry action the button is for (retry-sync or
   * retry-update - data-action names the endpoint) and reports the raw
   * outcome only. Never re-fetches/re-renders the fault list, and never
   * claims the fault is resolved: a sent push and an actual completed sync
   * or update are two different things. Only reopening (or refreshing) the
   * diagnostics screen, which re-reads real health data from the server,
   * can show whether the fault actually cleared. */
  async function handleRetryAction(btn) {
    const deviceId = btn.getAttribute('data-device-id');
    const action = btn.getAttribute('data-action');
    const statusEl = btn.nextElementSibling;
    const originalText = btn.textContent;

    btn.disabled = true;
    btn.textContent = 'שולח...';
    statusEl.textContent = '';
    statusEl.className = 'diag-retry-status';

    let res;
    try {
      res = await fetch(`/api/health/devices/${encodeURIComponent(deviceId)}/actions/${action}`, {
        method: 'POST',
      });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = originalText;
      statusEl.textContent = 'שגיאת תקשורת - נסה שוב';
      statusEl.classList.add('error');
      return;
    }

    if (res.status === 401) {
      document.getElementById('diagnosticsModal').style.display = 'none';
      document.getElementById('loginScreen').style.display = 'flex';
      return;
    }

    let body = {};
    try { body = await res.json(); } catch (e) { /* leave body empty */ }

    btn.disabled = false;
    btn.textContent = originalText;

    if (!res.ok) {
      statusEl.textContent = body.error || 'שגיאה בשליחת הבקשה';
      statusEl.classList.add('error');
      return;
    }

    if (body.status === 'sent') {
      statusEl.textContent = body.message || 'הבקשה נשלחה למכשיר';
      statusEl.classList.add('sent');
    } else {
      statusEl.textContent = body.message || 'לא ניתן היה לשלוח את הבקשה';
      statusEl.classList.add('info');
    }
  }

  // DRY-RUN only (see PolicyEnforcer.kt) - nothing on this list is actually
  // hidden by the device today, this just sizes up a future policy change.
  // Reuses existing diag-section/diag-fault-row styling, no new CSS.
  function noLauncherDryRunHtml(candidates) {
    if (!candidates || !candidates.length) return '';
    const rows = candidates.map(c => {
      const label = c.label ? escapeHtml(c.label) : escapeHtml(c.packageName);
      const pkgSuffix = c.label ? ` <span class="k">(${escapeHtml(c.packageName)})</span>` : '';
      return `<div class="diag-fault-row">${label}${pkgSuffix}</div>`;
    }).join('');
    return `<div class="diag-section"><h3>מועמדים לחסימה ללא launcher (DRY-RUN, לא נחסמים בפועל)</h3>${rows}</div>`;
  }

  /** Desired state (dnsFilteringRequested/dnsDesiredProviderHost, written the
   * instant an admin queues a command or a customer's own toggle is honored -
   * see backend/index.js's setDnsDesiredState) vs. actual state
   * (dnsFilteringActual/dnsActualProviderHost, only ever set from the
   * device's own confirmed report) shown side by side and as two distinct
   * provider-host rows, so a command that hasn't landed on the device yet
   * reads as "pending", not as a stale/wrong value - and a device report can
   * never silently overwrite what an admin just asked for. dnsProviderFilters
   * (a fleet-wide flag from the server, not per-device) gates whether this
   * section is even allowed to call it "ad/content blocking" - see
   * DNS_PROVIDER_FILTERS_CONTENT in index.js. */
  function dnsSectionHtml(deviceId, h, providerFilters) {
    const requestedText = h.dnsFilteringRequested ? 'הפעלה' : 'כיבוי';
    const actualText = h.dnsFilteringActual == null ? 'אין נתון' : (h.dnsFilteringActual ? 'פעיל (Strict)' : 'לא פעיל');
    const pending = Boolean(h.dnsFilteringRequested) !== Boolean(h.dnsFilteringActual);
    const rollbackText = h.lastRollbackAt
      ? `${escapeHtml(fmtRelative(new Date(h.lastRollbackAt).toISOString()))}${h.dnsFailureReason ? ' - ' + escapeHtml(h.dnsFailureReason) : ''}`
      : 'לא היה';
    const title = providerFilters ? 'סינון DNS (חוסם תוכן)' : 'סינון DNS (הצפנה בלבד - הספק אינו חוסם תוכן)';

    return `
      <div class="diag-section">
        <h3>${escapeHtml(title)}</h3>
        <div class="diag-header-grid">
          <div class="diag-field"><span class="k">רצוי: </span><span class="v">${escapeHtml(requestedText)}${pending ? ' (ממתין לאישור מהמכשיר)' : ''}</span></div>
          <div class="diag-field"><span class="k">בפועל: </span><span class="v">${escapeHtml(actualText)}</span></div>
          <div class="diag-field"><span class="k">מצב: </span><span class="v">${escapeHtml(DNS_MODE_LABEL[h.dnsMode] || h.dnsMode || 'אין נתון')}</span></div>
          <div class="diag-field"><span class="k">ספק רצוי: </span><span class="v">${escapeHtml(h.dnsDesiredProviderHost || '—')}</span></div>
          <div class="diag-field"><span class="k">ספק בפועל: </span><span class="v">${escapeHtml(h.dnsActualProviderHost || '—')}</span></div>
          <div class="diag-field"><span class="k">רשת: </span><span class="v">${escapeHtml(DNS_NETWORK_LABEL[h.currentNetworkType] || h.currentNetworkType || 'אין נתון')}</span></div>
          <div class="diag-field"><span class="k">DNS תקין: </span><span class="v">${h.dnsResolutionOk == null ? 'אין נתון' : (h.dnsResolutionOk ? 'כן' : 'לא')}</span></div>
          <div class="diag-field"><span class="k">DoT זמין: </span><span class="v">${h.dotProviderReachable == null ? 'אין נתון' : (h.dotProviderReachable ? 'כן' : 'לא')}</span></div>
          <div class="diag-field"><span class="k">Fail-safe: </span><span class="v">${escapeHtml(DNS_FAIL_SAFE_LABEL[h.dnsFailSafeState] || h.dnsFailSafeState || 'אין נתון')}</span></div>
          <div class="diag-field"><span class="k">בדיקה אחרונה: </span><span class="v">${h.lastDnsCheckAt ? escapeHtml(fmtRelative(new Date(h.lastDnsCheckAt).toISOString())) : 'טרם נבדק'}</span></div>
          <div class="diag-field"><span class="k">rollback אחרון: </span><span class="v">${rollbackText}</span></div>
        </div>
        <div class="diag-retry-row">
          <button class="diag-retry-btn" data-device-id="${escapeHtml(deviceId)}" data-dns-command="ENABLE_DNS_FILTERING">הפעל סינון</button>
          <button class="diag-retry-btn" data-device-id="${escapeHtml(deviceId)}" data-dns-command="DISABLE_DNS_FILTERING">כבה סינון</button>
          <button class="diag-retry-btn" data-device-id="${escapeHtml(deviceId)}" data-action="retry-sync">רענן סטטוס</button>
          <span class="diag-retry-status"></span>
        </div>
        <div class="diag-retry-row">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" data-allow-toggle-device-id="${escapeHtml(deviceId)}" ${h.allowCustomerDnsToggle ? 'checked' : ''} />
            <span class="diag-field k">לאפשר ללקוח לשלוט בעצמו במתג ה-DNS באפליקציה</span>
          </label>
        </div>
      </div>`;
  }

  /** Same shape as handleRetryAction, but against the generic commands route
   * (ENABLE/DISABLE_DNS_FILTERING are device commands, not one of the two
   * fixed health-dashboard retry actions) - never claims success beyond "the
   * command was queued and the device was woken"; reopening diagnostics
   * after the device's next sync is what shows whether it actually applied. */
  async function handleDnsCommand(btn) {
    const deviceId = btn.getAttribute('data-device-id');
    const command = btn.getAttribute('data-dns-command');
    const statusEl = btn.parentElement.querySelector('.diag-retry-status');
    const originalText = btn.textContent;

    btn.disabled = true;
    btn.textContent = 'שולח...';
    statusEl.textContent = '';
    statusEl.className = 'diag-retry-status';

    let res;
    try {
      res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
    } catch (e) {
      btn.disabled = false;
      btn.textContent = originalText;
      statusEl.textContent = 'שגיאת תקשורת - נסה שוב';
      statusEl.classList.add('error');
      return;
    }

    if (res.status === 401) {
      document.getElementById('diagnosticsModal').style.display = 'none';
      document.getElementById('loginScreen').style.display = 'flex';
      return;
    }

    let body = {};
    try { body = await res.json(); } catch (e) { /* leave body empty */ }

    btn.disabled = false;
    btn.textContent = originalText;

    if (!res.ok) {
      statusEl.textContent = body.error || 'שגיאה בשליחת הבקשה';
      statusEl.classList.add('error');
      return;
    }

    statusEl.textContent = command === 'ENABLE_DNS_FILTERING'
      ? 'הפקודה נשלחה - הסטטוס יתעדכן בסנכרון הבא של המכשיר'
      : 'הפקודה נשלחה - הסטטוס יתעדכן בסנכרון הבא של המכשיר';
    statusEl.classList.add('sent');
  }

  /** Unlike the command buttons above, this really does take effect
   * immediately server-side (it's a plain DB write, not a queued device
   * command) - so re-rendering the whole diagnostics screen right away is
   * accurate, not premature. */
  async function handleAllowToggleChange(checkbox) {
    const deviceId = checkbox.getAttribute('data-allow-toggle-device-id');
    const allow = checkbox.checked;
    checkbox.disabled = true;

    let res;
    try {
      res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/dns/allow-customer-toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allow }),
      });
    } catch (e) {
      checkbox.checked = !allow;
      checkbox.disabled = false;
      return;
    }

    if (res.status === 401) {
      document.getElementById('diagnosticsModal').style.display = 'none';
      document.getElementById('loginScreen').style.display = 'flex';
      return;
    }

    if (!res.ok) {
      checkbox.checked = !allow;
      checkbox.disabled = false;
      return;
    }

    openDeviceDiagnostics(deviceId);
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
      ? data.faults.map(f => faultCard(f, data.deviceId)).join('')
      : '<div class="empty-state">לא נמצאו תקלות פעילות במכשיר</div>';

    document.getElementById('diagnosticsContent').innerHTML = headerHtml +
      `<div class="diag-section"><h3>אבחון פעיל</h3>${faultsHtml}</div>` +
      noLauncherDryRunHtml(h.wouldHideNoLauncherPackages) +
      dnsSectionHtml(data.deviceId, h, data.dnsProviderFilters);

    document.querySelectorAll('#diagnosticsContent .diag-retry-btn').forEach(btn => {
      if (btn.hasAttribute('data-dns-command')) {
        btn.addEventListener('click', () => handleDnsCommand(btn));
      } else {
        btn.addEventListener('click', () => handleRetryAction(btn));
      }
    });
    document.querySelectorAll('#diagnosticsContent [data-allow-toggle-device-id]').forEach(cb => {
      cb.addEventListener('change', () => handleAllowToggleChange(cb));
    });
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
