(() => {
  'use strict';

  const list = document.getElementById('browserReviewList');
  const summary = document.getElementById('browserReviewSummary');
  const filter = document.getElementById('browserReviewStatus');
  const refresh = document.getElementById('browserReviewRefreshBtn');
  if (!list || !summary || !filter || !refresh) return;

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
  }[reason] || reason || 'נדרש אישור מנהל');

  function render(entries) {
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

  async function load() {
    list.innerHTML = '<div class="empty-state">טוען...</div>';
    const status = filter.value;
    try {
      const qs = status ? '?status=' + encodeURIComponent(status) : '';
      const res = await fetch('/api/browser/review-requests' + qs);
      if (!res.ok) throw new Error('טעינת בקשות האתרים נכשלה');
      const body = await res.json();
      render(Array.isArray(body.entries) ? body.entries : []);
    } catch (e) {
      list.innerHTML = '<div class="empty-state">לא ניתן לטעון את בקשות האתרים</div>';
      summary.textContent = e.message || '';
    }
  }

  filter.addEventListener('change', load);
  refresh.addEventListener('click', load);
  document.querySelectorAll('.nav-btn[data-tab="browser"]').forEach(btn => {
    btn.addEventListener('click', load);
  });
  window.loadBrowserReviewRequests = load;
})();