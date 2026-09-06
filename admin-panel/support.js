(function () {
  const listEl = document.getElementById('supportList');
  const summaryEl = document.getElementById('supportSummary');
  const filterEl = document.getElementById('supportStatusFilter');
  const refreshBtn = document.getElementById('supportRefreshBtn');
  if (!listEl || !summaryEl || !filterEl || !refreshBtn) return;

  let tickets = [];
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = iso => iso ? new Date(iso).toLocaleString('he-IL') : '—';
  const statusLabel = status => status === 'RESOLVED' ? 'טופל' : status === 'IN_PROGRESS' ? 'בטיפול' : 'חדש';

  function conversationMarkup(t) {
    const customerBubble = `<div class="support-chat-row customer">
      <div class="support-bubble customer-bubble">
        <div class="support-bubble-sender">לקוח</div>
        <div class="support-bubble-text">${esc(t.message)}</div>
        <div class="support-bubble-time">${esc(fmt(t.createdAt))}</div>
      </div>
    </div>`;
    const adminBubble = t.adminReply
      ? `<div class="support-chat-row admin">
          <div class="support-bubble admin-bubble">
            <div class="support-bubble-sender">תמיכה — יהודי כשר</div>
            <div class="support-bubble-text">${esc(t.adminReply)}</div>
            <div class="support-bubble-time">${esc(fmt(t.updatedAt))}</div>
          </div>
        </div>`
      : '';
    return `<div class="support-chat" dir="rtl">${customerBubble}${adminBubble}</div>`;
  }

  function render() {
    const filter = filterEl.value;
    const shown = filter === 'all' ? tickets : tickets.filter(t => t.status === filter);
    const open = tickets.filter(t => t.status === 'OPEN').length;
    const progress = tickets.filter(t => t.status === 'IN_PROGRESS').length;
    summaryEl.textContent = `חדשות: ${open} · בטיפול: ${progress} · סה״כ: ${tickets.length}`;
    if (!shown.length) {
      listEl.innerHTML = '<div class="empty-state">אין פניות בסטטוס הזה</div>';
      return;
    }
    listEl.innerHTML = shown.map(t => {
      const cls = t.status === 'RESOLVED' ? 'resolved' : t.status === 'IN_PROGRESS' ? 'in-progress' : 'open';
      const customer = t.customerName || 'לקוח ללא שם';
      const phone = t.customerNumber ? ` · ${esc(t.customerNumber)}` : '';
      return `<div class="support-ticket ${cls}" data-ticket="${esc(t.id)}">
        <div class="support-ticket-head">
          <div>
            <div class="support-ticket-title">${esc(t.subject)}</div>
            <div class="support-ticket-meta">${esc(customer)}${phone} · מכשיר ${esc(t.deviceId)}</div>
          </div>
          <strong>${statusLabel(t.status)}</strong>
        </div>
        ${conversationMarkup(t)}
        <div class="support-ticket-controls">
          <select class="login-input" data-support-status>
            <option value="OPEN"${t.status === 'OPEN' ? ' selected' : ''}>חדש</option>
            <option value="IN_PROGRESS"${t.status === 'IN_PROGRESS' ? ' selected' : ''}>בטיפול</option>
            <option value="RESOLVED"${t.status === 'RESOLVED' ? ' selected' : ''}>טופל</option>
          </select>
          <textarea class="login-input support-reply-compose" data-support-reply maxlength="5000" placeholder="כתבו תשובה ללקוח...">${esc(t.adminReply || '')}</textarea>
        </div>
        <div class="support-ticket-actions">
          <button class="add-app-btn" data-support-save>שלח תשובה ועדכן</button>
          <button class="toggle-btn" data-support-customer="${esc(t.deviceId)}">פתח לקוח</button>
        </div>
      </div>`;
    }).join('');

    listEl.querySelectorAll('[data-support-save]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('[data-ticket]');
        const id = card.getAttribute('data-ticket');
        const status = card.querySelector('[data-support-status]').value;
        const adminReply = card.querySelector('[data-support-reply]').value.trim();
        btn.disabled = true;
        const res = await fetch(`/api/support-tickets/${encodeURIComponent(id)}`, {
          method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({status, adminReply}),
        });
        btn.disabled = false;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          alert(body.error || 'שמירת הפנייה נכשלה');
          return;
        }
        await load();
      });
    });

    listEl.querySelectorAll('[data-support-customer]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof window.openDeviceDetail === 'function') window.openDeviceDetail(btn.getAttribute('data-support-customer'));
      });
    });
  }

  async function load() {
    listEl.innerHTML = '<div class="empty-state">טוען פניות...</div>';
    try {
      const res = await fetch('/api/support-tickets');
      if (res.status === 401) {
        document.getElementById('loginScreen').style.display = 'flex';
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      tickets = await res.json();
      render();
    } catch (_) {
      listEl.innerHTML = '<div class="empty-state">שגיאה בטעינת פניות התמיכה</div>';
    }
  }

  filterEl.addEventListener('change', render);
  refreshBtn.addEventListener('click', load);
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === 'support') btn.addEventListener('click', load);
  });
})();
