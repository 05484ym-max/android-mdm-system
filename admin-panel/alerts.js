// "התראות" tab - a plain-Hebrew, near-real-time fault center.
(function () {
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const AUTO_REFRESH_MS = 30 * 1000;

  const EXPLAIN = {
    DEVICE_OWNER_LOST: {
      what: 'הטלפון כבר לא מנוהל בצורה מלאה, ולכן חלק מהחסימות עלולות לא לעבוד.',
      impact: 'גבוה — הגנות מרכזיות של המכשיר אינן מובטחות.',
      solution: 'צריך לרשום את הטלפון מחדש כ-Device Owner. פתח אבחון וקבל קוד רישום חדש.',
      who: 'צריך את הטלפון ביד',
    },
    DEVICE_OFFLINE: {
      what: 'המערכת לא שמעה מהטלפון הרבה זמן.',
      impact: 'פקודות ושינויים חדשים עלולים לא להגיע אליו.',
      solution: 'בדוק שהטלפון דולק ומחובר לאינטרנט, פתח יהודי כשר ולחץ סנכרון.',
      who: 'צריך לבדוק את הטלפון',
    },
    UPDATE_FAILED: {
      what: 'הטלפון ניסה לעדכן את יהודי כשר והעדכון לא הסתיים.',
      impact: 'המכשיר עלול להישאר על גרסה ישנה.',
      solution: 'פתח אבחון ולחץ "נסה עדכון מחדש". אם זה חוזר, שם תופיע סיבת הכשל.',
      who: 'אפשר להתחיל מרחוק',
    },
    NEVER_CONTACTED: {
      what: 'הטלפון נרשם במערכת אבל אף פעם לא סיים סנכרון ראשון.',
      impact: 'אין לנו אישור שהניהול באמת פעיל.',
      solution: 'בדוק אינטרנט, פתח יהודי כשר ולחץ סנכרון. אם עדיין לא מתחבר — רשום מחדש.',
      who: 'צריך את הטלפון ביד',
    },
    SYNC_STALE: {
      what: 'הטלפון כן מדבר עם השרת, אבל הסנכרון המלא תקוע.',
      impact: 'מדיניות או פקודות חדשות עלולות להתעכב.',
      solution: 'המערכת מנסה קודם להעיר את המכשיר לבד. אם זה לא מסתדר, פתח אבחון ולחץ "נסה סנכרון מחדש".',
      who: 'המערכת מנסה קודם לבד',
    },
    LOW_STORAGE: {
      what: 'נשאר מעט מקום פנוי בטלפון.',
      impact: 'התקנות ועדכונים עלולים להיכשל.',
      solution: 'פנה מקום בטלפון ואז בצע סנכרון מחדש.',
      who: 'צריך את הטלפון ביד',
    },
    DNS_FILTER_MISMATCH: {
      what: 'המצב שביקשת לסינון האינטרנט שונה ממה שהטלפון מדווח בפועל.',
      impact: 'הסינון עלול להיות כבוי כשאמור להיות פעיל, או להפך.',
      solution: 'המערכת מנסה קודם סנכרון בטוח. אם אין שינוי, פתח אבחון ושלח שוב את מצב הסינון.',
      who: 'המערכת מנסה קודם לבד',
    },
    DNS_RESOLUTION_FAILED: {
      what: 'הטלפון מחובר לרשת, אבל בדיקת ה-DNS נכשלת.',
      impact: 'הגלישה באינטרנט עלולה לא לעבוד בכלל.',
      solution: 'בדוק אינטרנט בטלפון. אם צריך, כבה זמנית את הסינון והפעל אותו מחדש אחרי שהחיבור חוזר.',
      who: 'אפשר להתחיל מרחוק',
    },
    DNS_PROVIDER_UNREACHABLE: {
      what: 'הטלפון לא מצליח להגיע כרגע לשרת הסינון.',
      impact: 'הסינון עלול לא לעבוד בצורה יציבה.',
      solution: 'נסה שוב אחרי מעבר בין Wi-Fi לסלולר או אחרי שהחיבור מתייצב.',
      who: 'צריך לבדוק חיבור בטלפון',
    },
    DNS_FAILSAFE_ACTIVE: {
      what: 'מנגנון ההגנה של הסינון זיהה תקלה והתערב אוטומטית.',
      impact: 'ייתכן שהסינון נחלש או בוטל זמנית כדי להשאיר אינטרנט פעיל.',
      solution: 'ודא שהאינטרנט עובד. לאחר שהחיבור יציב, הפעל שוב את הסינון ורענן סטטוס.',
      who: 'המערכת כבר ניסתה להגן לבד',
    },
  };

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtRelative(iso) {
    if (!iso) return '—';
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    if (diff < HOUR_MS) return 'לפני פחות משעה';
    if (diff < DAY_MS) return `לפני ${Math.floor(diff / HOUR_MS)} שעות`;
    return `לפני ${Math.floor(diff / DAY_MS)} ימים`;
  }

  const SEVERITY_LABEL = { critical: 'צריך טיפול עכשיו', warning: 'כדאי לטפל' };
  const SCOPE_CLASS = { FLEET: 'fleet', CLUSTER: 'cluster', LIMITED: 'limited', DEVICE: 'device' };

  function summaryCard(cls, label, value) {
    return `<div class="alerts-stat-card ${cls}"><div class="label">${escapeHtml(label)}</div><div class="value">${value}</div></div>`;
  }

  function renderSummary(list) {
    const critical = list.filter(a => a.severity === 'critical').length;
    const fleet = list.filter(a => a.fleetScope === 'FLEET' || a.fleetScope === 'CLUSTER').length;
    document.getElementById('alertsSummary').innerHTML = [
      summaryCard('', 'תקלות פעילות', list.length),
      summaryCard('critical', 'לטיפול עכשיו', critical),
      summaryCard('warning', 'תקלות רחבות', fleet),
    ].join('');
  }

  function scopeHtml(a) {
    if (!a.fleetScopeLabel) {
      return '<div class="alert-scope scope-unknown"><strong>היקף:</strong> עדיין אוסף נתונים להשוואה בין המכשירים</div>';
    }
    const auto = a.autoHealAllowed
      ? '<div class="alert-autoheal">תיקון אוטומטי בטוח: המערכת מנסה סנכרון/התעוררות לבד</div>'
      : '';
    return `<div class="alert-scope scope-${escapeHtml(SCOPE_CLASS[a.fleetScope] || 'unknown')}">
      <strong>${escapeHtml(a.fleetScopeLabel)}</strong>
      <span>${escapeHtml(a.fleetScopeReason || '')}</span>
      ${a.affectedCount != null && a.fleetCount != null ? `<small>נפגעו ${escapeHtml(a.affectedCount)} מתוך ${escapeHtml(a.fleetCount)} (${escapeHtml(a.affectedPercent || 0)}%)</small>` : ''}
      ${auto}
    </div>`;
  }

  function alertCard(a) {
    const name = a.customerName ? escapeHtml(a.customerName) : 'ללא שם';
    const sub = [a.model, 'מזהה: ' + a.deviceId].filter(Boolean).map(escapeHtml).join(' · ');
    const info = EXPLAIN[a.category] || {
      what: a.message || 'המערכת זיהתה מצב שדורש בדיקה.',
      impact: 'פתח אבחון כדי לראות אם הלקוח מושפע.',
      solution: 'פתח אבחון וקבל הוראות מדויקות לפי הנתונים האחרונים מהמכשיר.',
      who: 'דורש בדיקה',
    };

    return `<div class="alert-card severity-${escapeHtml(a.severity)}">
      <div class="alert-card-header">
        <div>
          <div class="alert-card-title">${escapeHtml(a.message)}</div>
          <div class="alert-card-sub">${name} · ${sub}</div>
        </div>
        <span class="alert-severity-badge ${escapeHtml(a.severity)}">${escapeHtml(SEVERITY_LABEL[a.severity] || 'לבדיקה')}</span>
      </div>

      ${scopeHtml(a)}

      <div class="alert-simple-box">
        <div class="alert-simple-row"><strong>מה קרה?</strong><span>${escapeHtml(info.what)}</span></div>
        <div class="alert-simple-row"><strong>מה זה גורם?</strong><span>${escapeHtml(info.impact)}</span></div>
        <div class="alert-simple-row solution"><strong>מה עושים?</strong><span>${escapeHtml(info.solution)}</span></div>
        <div class="alert-simple-row"><strong>מי מטפל?</strong><span>${escapeHtml(info.who)}</span></div>
      </div>

      <div class="alert-card-time">זוהה ${escapeHtml(fmtRelative(a.createdAt))}</div>
      <button class="alert-diagnose-btn" data-device-id="${escapeHtml(a.deviceId)}">פתח פתרון מלא</button>
    </div>`;
  }

  function renderList(list) {
    const root = document.getElementById('alertsList');
    if (!list.length) {
      root.innerHTML = '<div class="empty-state">הכול תקין — אין כרגע תקלה שדורשת ממך פעולה</div>';
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
      res = await fetch('/api/alerts', { cache: 'no-store' });
    } catch (e) {
      document.getElementById('alertsList').innerHTML = '<div class="empty-state">לא הצלחתי להתחבר לשרת. בדוק אינטרנט ורענן.</div>';
      return;
    }
    if (res.status === 401) {
      document.getElementById('loginScreen').style.display = 'flex';
      return;
    }
    if (!res.ok) {
      document.getElementById('alertsList').innerHTML = '<div class="empty-state">לא הצלחתי לטעון את מצב התקלות. נסה רענון.</div>';
      return;
    }
    const list = await res.json();
    renderSummary(list);
    renderList(list);
  }

  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === 'alerts') btn.addEventListener('click', loadAlerts);
  });

  const refreshBtn = document.getElementById('alertsRefreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadAlerts);

  // Near-real-time view without requiring the operator to refresh manually.
  // The backend monitor is event-driven + periodic; this only refreshes the
  // visible admin representation and does not poll individual devices.
  const timer = setInterval(() => {
    const tab = document.querySelector('[data-tab-content="alerts"]');
    if (tab && tab.offsetParent !== null) loadAlerts();
  }, AUTO_REFRESH_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();
})();
