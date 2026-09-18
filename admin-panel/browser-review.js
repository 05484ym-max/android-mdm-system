(() => {
  'use strict';

  const list = document.getElementById('browserReviewList');
  const summary = document.getElementById('browserReviewSummary');
  const filter = document.getElementById('browserReviewStatus');
  const refresh = document.getElementById('browserReviewRefreshBtn');
  const manualWrap = document.getElementById('browserManualEntry');
  const manualHost = document.getElementById('browserManualHost');
  const manualAdd = document.getElementById('browserManualAddBtn');
  const note = document.getElementById('browserReviewNote');
  const modeButtons = [...document.querySelectorAll('[data-browser-list-mode]')];
  if (!list || !summary || !filter || !refresh || !manualWrap || !manualHost || !manualAdd || !note) return;

  let mode = 'requests';

  const escapeHtml = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const statusLabel = status => ({
    PENDING: 'ממתין לבדיקה',
    APPROVED: 'מאושר',
    BLOCKED: 'חסום',
  }[status] || status);

  const reasonLabel = reason => ({
    classification_missing: 'הסיווג לא החזיר תשובה מלאה',
    classification_not_confident: 'רמת הוודאות של הסיווג נמוכה',
    category_not_allowed: 'הקטגוריה אינה מאושרת אוטומטית',
    classifier_not_configured: 'שירות הסיווג אינו מוגדר',
    classifier_unreachable: 'שירות הסיווג אינו זמין',
    classifier_pending_or_unavailable: 'הסיווג עדיין ממתין או לא זמין',
    approved_from_browser_review_queue: 'אושר ידנית מהתור',
    manual_admin_allow: 'נוסף ידנית',
    blocked_from_browser_review_queue: 'נחסם ידנית מהתור',
    manual_admin_block: 'נוסף ידנית לרשימה השחורה',
  }[reason] || reason || 'נדרש אישור מנהל');

  function setMode(next) {
    mode = next;
    modeButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.browserListMode === next));
    filter.style.display = next === 'requests' ? '' : 'none';
    manualWrap.style.display = next === 'requests' ? 'none' : 'flex';
    manualHost.value = '';
    if (next === 'requests') {
      note.textContent = 'אתר לא מוכר שנחסם בדפדפן נכנס לכאן אוטומטית. אישור חל על הדומיין המדויק בלבד ואינו מבטל את סינון התמונות.';
    } else if (next === 'whitelist') {
      note.textContent = 'הרשימה הלבנה משותפת למכשירים שבמצב “רשימה לבנה”. כל אתר שאישרת נשמר כאן קבוע עד שתסיר אותו.';
      manualHost.placeholder = 'הוסף דומיין לרשימה הלבנה, למשל example.com';
    } else {
      note.textContent = 'הרשימה השחורה חלה על מכשירים שבמצב “רשימה שחורה”. כל אתר שמופיע כאן ייחסם גם אם כל שאר האינטרנט פתוח.';
      manualHost.placeholder = 'הוסף דומיין לרשימה השחורה, למשל example.com';
    }
    load();
  }

  function renderRequests(entries) {
    const pending = entries.filter(x => x.status === 'PENDING').length;
    summary.textContent = entries.length
      ? `סה"כ ${entries.length} · ממתינים ${pending}`
      : 'אין בקשות בתצוגה הנוכחית';

    if (!entries.length) {
      list.innerHTML = '<div class="empty-state">אין כרגע בקשות אתרים</div>';
      return;
    }

    list.innerHTML = entries.map(item => {
      const pendingActions = item.status === 'PENDING' ? `
        <div class="browser-review-actions">
          <button class="add-app-btn" data-browser-approve="${escapeHtml(item.id)}">✓ אשר אתר</button>
          <button class="browser-block-btn" data-browser-block="${escapeHtml(item.id)}">חסום</button>
        </div>` : '';

      return `
        <div class="browser-review-card">
          <div class="browser-review-main">
            <div class="browser-review-host">${escapeHtml(item.host)}</div>
            <a class="browser-review-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">פתח את האתר לבדיקה ↗</a>
            <div class="browser-review-meta">
              <span class="browser-review-status status-${escapeHtml(item.status.toLowerCase())}">${escapeHtml(statusLabel(item.status))}</span>
              <span>${escapeHtml(reasonLabel(item.reason))}</span>
              <span>נצפה ${Number(item.seenCount) || 1} פעמים</span>
              <span>אחרון: ${new Date(item.lastSeenAt).toLocaleString('he-IL')}</span>
            </div>
          </div>
          ${pendingActions}
        </div>`;
    }).join('');

    document.querySelectorAll('[data-browser-approve]').forEach(btn => {
      btn.addEventListener('click', () => decide(btn, 'approve'));
    });
    document.querySelectorAll('[data-browser-block]').forEach(btn => {
      btn.addEventListener('click', () => decide(btn, 'block'));
    });
  }

  function renderDomainList(entries, listMode) {
    const isWhite = listMode === 'whitelist';
    summary.textContent = `סה"כ ${entries.length} אתרים ב${isWhite ? 'רשימה הלבנה' : 'רשימה השחורה'}`;
    if (!entries.length) {
      list.innerHTML = `<div class="empty-state">הרשימה ה${isWhite ? 'לבנה' : 'שחורה'} ריקה</div>`;
      return;
    }
    list.innerHTML = entries.map(item => `
      <div class="browser-review-card">
        <div class="browser-review-main">
          <div class="browser-review-host">${escapeHtml(item.host)}</div>
          <a class="browser-review-link" href="https://${escapeHtml(item.host)}/" target="_blank" rel="noopener noreferrer">פתח את האתר ↗</a>
          <div class="browser-review-meta">
            <span>${escapeHtml(reasonLabel(item.reason))}</span>
            <span>עודכן: ${new Date(item.updatedAt).toLocaleString('he-IL')}</span>
            ${item.source ? `<span>${escapeHtml(item.source)}</span>` : ''}
          </div>
        </div>
        <div class="browser-review-actions">
          <button class="browser-block-btn" data-domain-remove="${escapeHtml(item.host)}">הסר מהרשימה</button>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('[data-domain-remove]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const host = btn.dataset.domainRemove;
        if (!confirm(`להסיר את ${host} מהרשימה?`)) return;
        btn.disabled = true;
        const endpoint = isWhite
          ? '/api/browser/allowlist/' + encodeURIComponent(host)
          : '/api/browser/blocklist/' + encodeURIComponent(host);
        try {
          const res = await fetch(endpoint, { method: 'DELETE' });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error || 'ההסרה נכשלה');
          await load();
        } catch (e) {
          alert(e.message || 'שגיאת תקשורת');
          btn.disabled = false;
        }
      });
    });
  }

  async function decide(button, action) {
    const id = button.getAttribute(action === 'approve' ? 'data-browser-approve' : 'data-browser-block');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = action === 'approve' ? 'מאשר...' : 'חוסם...';
    try {
      const res = await fetch(`/api/browser/review-requests/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'הפעולה נכשלה');
      await load();
    } catch (e) {
      alert(e.message || 'שגיאת תקשורת');
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function addManual() {
    const host = manualHost.value.trim();
    if (!host) return;
    manualAdd.disabled = true;
    const endpoint = mode === 'whitelist' ? '/api/browser/allowlist' : '/api/browser/blocklist';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, reason: mode === 'whitelist' ? 'manual_admin_allow' : 'manual_admin_block' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'הוספת האתר נכשלה');
      manualHost.value = '';
      await load();
    } catch (e) {
      alert(e.message || 'שגיאת תקשורת');
    } finally {
      manualAdd.disabled = false;
    }
  }

  async function load() {
    list.innerHTML = '<div class="empty-state">טוען...</div>';
    try {
      if (mode === 'requests') {
        const status = filter.value;
        const qs = status ? '?status=' + encodeURIComponent(status) : '';
        const res = await fetch('/api/browser/review-requests' + qs);
        if (!res.ok) throw new Error('טעינת בקשות האתרים נכשלה');
        const body = await res.json();
        renderRequests(Array.isArray(body.entries) ? body.entries : []);
        return;
      }

      const endpoint = mode === 'whitelist' ? '/api/browser/allowlist' : '/api/browser/blocklist';
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error('טעינת רשימת האתרים נכשלה');
      const body = await res.json();
      let entries = Array.isArray(body.entries) ? body.entries : [];
      if (mode === 'whitelist') entries = entries.filter(x => x.enabled === true);
      renderDomainList(entries, mode);
    } catch (e) {
      list.innerHTML = '<div class="empty-state">לא ניתן לטעון את נתוני הדפדפן</div>';
      summary.textContent = e.message || '';
    }
  }

  modeButtons.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.browserListMode)));
  filter.addEventListener('change', load);
  refresh.addEventListener('click', load);
  manualAdd.addEventListener('click', addManual);
  manualHost.addEventListener('keydown', e => { if (e.key === 'Enter') addManual(); });
  document.querySelectorAll('.nav-btn[data-tab="browser"]').forEach(btn => btn.addEventListener('click', load));
  window.loadBrowserReviewRequests = load;
})();