// "בריאות מכשירים" tab - entirely separate from the main inline script in
// index.html. Fetches health endpoints and renders them without touching the
// main device-management state.
(function () {
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;

  const STATUS_LABEL = {
    ok: 'תקין',
    warning: 'דורש תשומת לב',
    critical: 'קריטי',
    unknown: 'ממתין לנתונים',
  };

  const PROTECTION_PROFILE_LABEL = {
    BASIC: 'בסיסית',
    HARDENED: 'מחוזקת',
    HARDENED_ADMIN: 'מחוזקת + מנהל מכשיר',
    DEVICE_OWNER: 'Device Owner',
    SYSTEM_LEVEL: 'רמת מערכת',
  };

  const UNINSTALL_PROTECTION_LABEL = {
    NONE: 'ללא הגנת הסרה',
    BEST_EFFORT: 'הגנת הסרה חלקית',
    ADMIN_GATED: 'דורש ביטול הרשאת מנהל לפני הסרה',
    DEVICE_OWNER_ENFORCED: 'חסימת הסרה באמצעות Device Owner',
    SYSTEM_LEVEL: 'הגנת הסרה ברמת מערכת',
  };

  const CAPABILITY_LABEL = {
    LAUNCHER: 'Launcher',
    DEFAULT_HOME: 'הגדרה כיישום הבית',
    ACCESSIBILITY: 'שירות נגישות',
    DEVICE_ADMIN: 'מנהל מכשיר',
    DEVICE_OWNER: 'Device Owner',
    ROOT: 'Root זוהה',
    PRIV_APP: 'אפליקציית מערכת מורשית',
  };

  const FRP_ERROR_LABEL = {
    API_UNSUPPORTED: 'המכשיר אינו תומך בניהול FRP',
    NOT_DEVICE_OWNER: 'המכשיר אינו מוגדר כמנהל המכשיר',
    FRP_NOT_SUPPORTED_BY_DEVICE: 'המכשיר אינו תומך בהגנת FRP',
    FRP_SECURITY_EXCEPTION: 'אין הרשאה להחיל את הגנת FRP',
    FRP_RECONCILE_FAILED: 'החלת הגנת FRP נכשלה',
    FRP_INSPECT_FAILED: 'בדיקת מצב FRP נכשלה',
    ENABLED_WITHOUT_ACCOUNTS_REJECTED: 'לא הוגדר חשבון שחזור מורשה',
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

  function requestedProfileControl(deviceId, currentProfile) {
    const selected = currentProfile || 'HARDENED_ADMIN';
    const options = Object.entries(PROTECTION_PROFILE_LABEL).map(([value, label]) =>
      `<option value="${value}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`
    ).join('');
    return `
      <div class="protection-request-control">
        <label>
          <span>רמת הגנה נדרשת</span>
          <select data-protection-profile>${options}</select>
        </label>
        <button type="button" class="protection-save-btn" data-save-protection="${escapeHtml(deviceId)}">שמור דרישה</button>
        <span class="protection-save-status" aria-live="polite"></span>
      </div>`;
  }

  function protectionRequirementsBlock(p) {
    const requirements = p && p.requirements;
    if (!requirements) return '';
    if (requirements.satisfied) {
      return '<div class="protection-requirements protection-requirements-ok">לא חסרה יכולת להגנה שנבחרה.</div>';
    }

    const missing = Array.isArray(requirements.missingCapabilities)
      ? requirements.missingCapabilities
      : [];
    const chips = missing.length
      ? missing.map(capability => {
          const label = CAPABILITY_LABEL[capability] || capability;
          return `<span class="protection-missing-chip">${escapeHtml(label)}</span>`;
        }).join('')
      : '<span class="protection-missing-chip">נדרש שדרוג רמת ההגנה</span>';

    let note = '';
    if (requirements.requiresReprovisioning) {
      note = 'Device Owner דורש מסלול provisioning מתאים; לא מבוצע איפוס או provisioning אוטומטי מהפאנל.';
    } else if (requirements.requiresSystemIntegration) {
      note = 'רמת מערכת דורשת התקנת מערכת/priv-app תואמת; לא מתבצעת צריבה אוטומטית.';
    }

    return `
      <div class="protection-requirements">
        <div class="protection-requirements-title">מה חסר כדי להגיע לרמה שנבחרה</div>
        <div class="protection-missing-list">${chips}</div>
        ${note ? `<div class="protection-requirements-note">${escapeHtml(note)}</div>` : ''}
      </div>`;
  }

  function protectionBlock(d) {
    const p = d.protection;
    if (!p) {
      return `
        <div class="protection-card protection-unknown">
          <div class="protection-card-title">מצב הגנה</div>
          <div class="protection-empty">המכשיר עדיין לא דיווח נתוני Universal Adapter</div>
          ${requestedProfileControl(d.deviceId, null)}
        </div>`;
    }

    const requested = PROTECTION_PROFILE_LABEL[p.requestedProfile] || p.requestedProfile || '—';
    const achieved = PROTECTION_PROFILE_LABEL[p.achievedProfile] || p.achievedProfile || '—';
    const uninstall = UNINSTALL_PROTECTION_LABEL[p.uninstallProtection] || p.uninstallProtection || '—';
    const statusClass = p.protectionSatisfied ? 'protection-ok' : 'protection-gap';
    const statusText = p.protectionSatisfied ? 'עומד בדרישת ההגנה' : `חסרות ${p.protectionGap || 0} רמות הגנה`;
    const capabilities = Array.isArray(p.detectedCapabilities) && p.detectedCapabilities.length
      ? p.detectedCapabilities.map(c => `<span class="protection-chip">${escapeHtml(CAPABILITY_LABEL[c] || c)}</span>`).join('')
      : '<span class="protection-chip muted">אין יכולות מדווחות</span>';

    const adapter = p.adapterId || '—';
    const confidence = p.adapterConfidence == null ? '—' : `${p.adapterConfidence}%`;
    const platform = [p.oemSkin, p.oemSkinVersion].filter(Boolean).join(' ') || '—';

    return `
      <div class="protection-card ${statusClass}">
        <div class="protection-card-head">
          <div>
            <div class="protection-card-title">מצב הגנה Universal</div>
            <div class="protection-status-text">${escapeHtml(statusText)}</div>
          </div>
          <span class="protection-status-badge">${p.protectionSatisfied ? 'תקין' : 'פער הגנה'}</span>
        </div>
        <div class="protection-grid">
          <div><span class="k">נדרש</span><span class="v">${escapeHtml(requested)}</span></div>
          <div><span class="k">הושג בפועל</span><span class="v">${escapeHtml(achieved)}</span></div>
          <div><span class="k">הגנת הסרה</span><span class="v">${escapeHtml(uninstall)}</span></div>
          <div><span class="k">Adapter</span><span class="v">${escapeHtml(adapter)}</span></div>
          <div><span class="k">דיוק זיהוי</span><span class="v">${escapeHtml(confidence)}</span></div>
          <div><span class="k">מערכת OEM</span><span class="v">${escapeHtml(platform)}</span></div>
        </div>
        <div class="protection-capabilities">${capabilities}</div>
        ${protectionRequirementsBlock(p)}
        ${requestedProfileControl(d.deviceId, p.requestedProfile)}
      </div>`;
  }

  function frpBlock(d) {
    const f = d.frp || {};
    const requested = f.enabledRequested === true;
    let stateText = requested ? 'ממתין לאימות מהמכשיר' : 'כבוי';
    let stateClass = requested ? 'protection-gap' : 'protection-unknown';

    if (f.reportedAt) {
      if (f.apiSupported === false) {
        stateText = 'לא נתמך במכשיר';
      } else if (f.deviceOwner === false) {
        stateText = 'המכשיר אינו מוגדר כמנהל המכשיר';
      } else if (f.lastError) {
        stateText = FRP_ERROR_LABEL[f.lastError] || 'נדרשת בדיקה';
      } else if (requested && f.enabledActual === true && f.matchesDesired === true) {
        stateText = 'פעיל ומאומת';
        stateClass = 'protection-ok';
      } else if (!requested && f.enabledActual === false && f.matchesDesired === true) {
        stateText = 'כבוי ומאומת';
        stateClass = 'protection-ok';
      }
    }

    const accountText = f.configuredAccountCount > 0
      ? `${f.configuredAccountCount} חשבונות שחזור מוגדרים`
      : 'לא הוגדר חשבון שחזור';

    return `
      <div class="protection-card ${stateClass}" data-frp-card="${escapeHtml(d.deviceId)}">
        <div class="protection-card-head">
          <div>
            <div class="protection-card-title">הגנת FRP</div>
            <div class="protection-status-text">${escapeHtml(stateText)}</div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;font-weight:700;cursor:pointer;">
            <span>${requested ? 'פעיל' : 'כבוי'}</span>
            <input type="checkbox" data-frp-toggle="${escapeHtml(d.deviceId)}" ${requested ? 'checked' : ''} aria-label="הפעלת הגנת FRP">
          </label>
        </div>
        <div class="protection-grid">
          <div><span class="k">חשבונות שחזור</span><span class="v">${escapeHtml(accountText)}</span></div>
          <div><span class="k">מצב במכשיר</span><span class="v">${f.enabledActual == null ? 'ממתין לדיווח' : (f.enabledActual ? 'פעיל' : 'כבוי')}</span></div>
          <div><span class="k">אימות אחרון</span><span class="v">${escapeHtml(fmtRelative(f.reportedAt))}</span></div>
        </div>
        <div class="protection-save-status" data-frp-status aria-live="polite"></div>
      </div>`;
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
          <div class="health-field"><span class="k">Codename: </span><span class="v">${escapeHtml(d.protection?.deviceCodename || '—')}</span></div>
          <div class="health-field"><span class="k">Build: </span><span class="v">${escapeHtml(d.protection?.buildDisplay || '—')}</span></div>
          <div class="health-field"><span class="k">זיהוי capabilities: </span><span class="v">${fmtAbsolute(d.protection?.capabilityDetectedAt ? new Date(d.protection.capabilityDetectedAt).toISOString() : null)}</span></div>
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
        ${frpBlock(d)}
        ${protectionBlock(d)}
        ${detailsHtml}
        <button class="health-diagnose-btn" data-diagnose="${escapeHtml(d.deviceId)}">אבחון ותיקון</button>
      </div>`;
  }

  function openDiagnostics(deviceId) {
    if (window.openDeviceDiagnostics) window.openDeviceDiagnostics(deviceId);
  }

  async function saveRequestedProtection(button) {
    const deviceId = button.getAttribute('data-save-protection');
    const card = button.closest('.protection-card');
    const select = card && card.querySelector('[data-protection-profile]');
    const status = card && card.querySelector('.protection-save-status');
    if (!deviceId || !select || !status) return;

    button.disabled = true;
    select.disabled = true;
    status.textContent = 'שומר...';
    status.className = 'protection-save-status';
    try {
      const response = await fetch(`/api/health/devices/${encodeURIComponent(deviceId)}/protection/requested`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestedProfile: select.value }),
      });
      if (response.status === 401) {
        document.getElementById('loginScreen').style.display = 'flex';
        status.textContent = 'נדרשת התחברות';
        status.classList.add('error');
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        status.textContent = body.error || 'השמירה נכשלה';
        status.classList.add('error');
        return;
      }
      status.textContent = 'נשמר';
      status.classList.add('ok');
      await loadHealthPanel();
    } catch (e) {
      status.textContent = 'שגיאת תקשורת';
      status.classList.add('error');
    } finally {
      button.disabled = false;
      select.disabled = false;
    }
  }

  async function saveFrpToggle(toggle) {
    const deviceId = toggle.getAttribute('data-frp-toggle');
    const card = toggle.closest('[data-frp-card]');
    const status = card && card.querySelector('[data-frp-status]');
    if (!deviceId || !status) return;

    const enabled = toggle.checked;
    toggle.disabled = true;
    status.textContent = enabled ? 'מפעיל הגנת FRP...' : 'מכבה הגנת FRP...';
    status.className = 'protection-save-status';
    try {
      const response = await fetch(`/api/health/devices/${encodeURIComponent(deviceId)}/frp`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (response.status === 401) {
        document.getElementById('loginScreen').style.display = 'flex';
        toggle.checked = !enabled;
        status.textContent = 'נדרשת התחברות';
        status.classList.add('error');
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        toggle.checked = !enabled;
        status.textContent = body.error === 'FRP_RECOVERY_ACCOUNT_REQUIRED'
          ? 'לא ניתן להפעיל: לא הוגדר חשבון שחזור מורשה'
          : 'שינוי מצב FRP נכשל';
        status.classList.add('error');
        return;
      }
      status.textContent = enabled ? 'נשלחה בקשה להפעלת FRP' : 'נשלחה בקשה לכיבוי FRP';
      status.classList.add('ok');
      await loadHealthPanel();
    } catch (e) {
      toggle.checked = !enabled;
      status.textContent = 'שגיאת תקשורת';
      status.classList.add('error');
    } finally {
      toggle.disabled = false;
    }
  }

  function renderDevices(devices) {
    const root = document.getElementById('healthDevices');
    if (!devices.length) {
      root.innerHTML = '<div class="empty-state">עוד לא נרשמו מכשירים</div>';
      return;
    }
    root.innerHTML = devices.map(deviceCard).join('');
    root.querySelectorAll('[data-diagnose]').forEach(btn => {
      btn.addEventListener('click', () => openDiagnostics(btn.getAttribute('data-diagnose')));
    });
    root.querySelectorAll('[data-save-protection]').forEach(btn => {
      btn.addEventListener('click', () => saveRequestedProtection(btn));
    });
    root.querySelectorAll('[data-frp-toggle]').forEach(toggle => {
      toggle.addEventListener('change', () => saveFrpToggle(toggle));
    });
  }

  async function loadHealthPanel() {
    let summaryRes, devicesRes, frpRes;
    try {
      [summaryRes, devicesRes, frpRes] = await Promise.all([
        fetch('/api/health/summary'),
        fetch('/api/health/devices'),
        fetch('/api/health/frp'),
      ]);
    } catch (e) {
      document.getElementById('healthDevices').innerHTML = '<div class="empty-state">שגיאת תקשורת</div>';
      return;
    }
    if (summaryRes.status === 401 || devicesRes.status === 401 || frpRes.status === 401) {
      document.getElementById('loginScreen').style.display = 'flex';
      return;
    }
    if (!summaryRes.ok || !devicesRes.ok || !frpRes.ok) {
      document.getElementById('healthDevices').innerHTML = '<div class="empty-state">שגיאה בטעינת נתוני בריאות</div>';
      return;
    }

    const devices = await devicesRes.json();
    const frpStates = await frpRes.json();
    const frpByDevice = new Map(frpStates.map(state => [state.deviceId, state]));
    for (const device of devices) {
      device.frp = frpByDevice.get(device.deviceId) || {
        enabledRequested: false,
        configuredAccountCount: 0,
        reportedAt: null,
      };
    }

    renderSummary(await summaryRes.json());
    renderDevices(devices);
  }

  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === 'health') {
      btn.addEventListener('click', loadHealthPanel);
    }
  });

  const refreshBtn = document.getElementById('healthRefreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadHealthPanel);
})();