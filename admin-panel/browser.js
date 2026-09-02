// "דפדפן מסונן" (Filtered Browser) admin tab - entirely separate from the
// main inline script in index.html, same isolation convention as
// health.js/alerts.js/diagnostics.js: it never touches state those files
// own, and is lazy-loaded (only fetches once the tab is actually opened).
//
// Server is always the source of truth here (see /docs/server-api-contract.md's
// Phase 1.1/2 sections) - every write below goes through the backend's own
// validation; nothing here is trusted as a substitute for it.
(function () {
  const DECISION_LABEL = { ALLOW: 'מאושר', BLOCK: 'חסום', REVIEW: 'בבדיקה' };
  const DECISION_CLASS = { ALLOW: 'ok', BLOCK: 'bad', REVIEW: 'warn' };
  const ACTION_LABEL = {
    domain_upsert: 'עדכון ידני של כלל',
    domain_delete: 'מחיקת כלל',
    request_resolve_global: 'החלטה גלובלית מתוך בקשה',
    request_resolve_device: 'החלטה למכשיר בודד מתוך בקשה',
  };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtRelative(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR;
    if (diff < HOUR) return 'לפני פחות משעה';
    if (diff < DAY) return `לפני ${Math.floor(diff / HOUR)} שעות`;
    return `לפני ${Math.floor(diff / DAY)} ימים`;
  }

  function fmtAbsolute(iso) {
    return iso ? new Date(iso).toLocaleString('he-IL') : '—';
  }

  function decisionBadge(decision) {
    const cls = DECISION_CLASS[decision] || 'warn';
    const label = DECISION_LABEL[decision] || decision || '—';
    return `<span class="browser-badge ${cls}">${escapeHtml(label)}</span>`;
  }

  function scopeBadge(scope) {
    return scope === 'GLOBAL'
      ? '<span class="browser-scope-badge global">🌐 גלובלי - כל הלקוחות</span>'
      : '<span class="browser-scope-badge device">📱 מכשיר בודד</span>';
  }

  function showLoginIfUnauthorized(status) {
    if (status === 401) {
      const el = document.getElementById('loginScreen');
      if (el) el.style.display = 'flex';
      return true;
    }
    return false;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ---------- Requests ----------

  async function loadRequests() {
    const el = document.getElementById('browserRequestsList');
    el.innerHTML = '<div class="empty-state">טוען...</div>';
    let res;
    try {
      res = await fetch('/api/browser/requests');
    } catch {
      el.innerHTML = '<div class="empty-state">שגיאת תקשורת</div>';
      return;
    }
    if (showLoginIfUnauthorized(res.status)) return;
    if (!res.ok) {
      el.innerHTML = '<div class="empty-state">שגיאה בטעינת הבקשות</div>';
      return;
    }
    const requests = await res.json();
    if (!requests.length) {
      el.innerHTML = '<div class="empty-state">אין בקשות ממתינות כרגע</div>';
      return;
    }
    el.innerHTML = requests.map(requestCard).join('');
    wireRequestActions();
  }

  function requestCard(r) {
    const extra = [
      r.category ? field('קטגוריה', escapeHtml(r.category)) : '',
      r.riskScore != null ? field('ציון סיכון', r.riskScore) : '',
      r.confidence != null ? field('ביטחון', r.confidence) : '',
      r.reason ? field('סיבה', escapeHtml(r.reason)) : '',
    ].join('');
    return `
      <div class="browser-card" data-request-id="${escapeHtml(r.id)}">
        <div class="browser-card-header">
          <div class="browser-domain">${escapeHtml(r.domain)}</div>
          ${decisionBadge('REVIEW')}
        </div>
        ${r.exampleUrl ? `<div class="browser-url">${escapeHtml(r.exampleUrl)}</div>` : ''}
        <div class="browser-fields">
          ${field('ממתינים להחלטה', r.requesterCount)}
          ${field('סה"כ ביקשו אי פעם', r.totalRequesterCount)}
          ${field('נוצרה', fmtRelative(r.createdAt))}
          ${r.lastRequestedAt ? field('בקשה אחרונה', fmtRelative(r.lastRequestedAt)) : ''}
          ${extra}
        </div>
        <div class="browser-actions">
          ${scopeBadge('GLOBAL')}
          <button class="browser-btn ok" data-action="global-allow" data-id="${escapeHtml(r.id)}" data-domain="${escapeHtml(r.domain)}">אשר לכולם</button>
          <button class="browser-btn bad" data-action="global-block" data-id="${escapeHtml(r.id)}" data-domain="${escapeHtml(r.domain)}">חסום לכולם</button>
          <button class="browser-btn ghost" data-action="toggle-devices" data-id="${escapeHtml(r.id)}">הצג מכשירים ממתינים (${r.requesterCount})</button>
          <button class="browser-btn ghost" data-action="refresh-requests">רענן</button>
        </div>
        <div class="browser-devices" id="browserDevices-${escapeHtml(r.id)}" style="display:none;"></div>
      </div>`;
  }

  function field(label, value) {
    return `<div class="browser-field"><span>${escapeHtml(label)}</span><b>${value == null ? '—' : value}</b></div>`;
  }

  async function toggleDevices(requestId) {
    const container = document.getElementById(`browserDevices-${requestId}`);
    if (!container) return;
    if (container.style.display !== 'none') {
      container.style.display = 'none';
      return;
    }
    container.style.display = 'block';
    container.innerHTML = '<div class="empty-state">טוען מכשירים...</div>';
    let res;
    try {
      res = await fetch(`/api/browser/requests/${encodeURIComponent(requestId)}/devices`);
    } catch {
      container.innerHTML = '<div class="empty-state">שגיאת תקשורת</div>';
      return;
    }
    if (showLoginIfUnauthorized(res.status)) return;
    const devices = await res.json();
    const card = document.querySelector(`[data-request-id="${cssEscape(requestId)}"]`);
    const domain = card ? card.getAttribute('data-domain') : '';
    container.innerHTML = devices.length
      ? devices.map(d => deviceRow(requestId, domain, d)).join('')
      : '<div class="empty-state">אין מכשירים</div>';
    wireDeviceActions(requestId);
  }

  // Minimal CSS.escape fallback (device/request ids are UUIDs/opaque
  // strings in practice, but this avoids a broken selector on anything
  // unexpected rather than trusting the input blindly).
  function cssEscape(str) {
    return window.CSS && CSS.escape ? CSS.escape(str) : String(str).replace(/["\\]/g, '\\$&');
  }

  function deviceRow(requestId, domain, d) {
    if (d.decision) {
      return `
        <div class="browser-device-row resolved">
          <span class="browser-device-id">${escapeHtml(d.deviceId)}</span>
          ${scopeBadge('DEVICE')}
          ${decisionBadge(d.decision)}
          <span style="color:var(--text-dim);font-size:0.75rem;">כבר הוחלט - ${fmtRelative(d.resolvedAt)}</span>
        </div>`;
    }
    return `
      <div class="browser-device-row">
        <span class="browser-device-id">${escapeHtml(d.deviceId)}</span>
        ${scopeBadge('DEVICE')}
        <button class="browser-btn ok small" data-action="device-allow" data-id="${escapeHtml(requestId)}" data-domain="${escapeHtml(domain)}" data-device="${escapeHtml(d.deviceId)}">אשר למכשיר זה בלבד</button>
        <button class="browser-btn bad small" data-action="device-block" data-id="${escapeHtml(requestId)}" data-domain="${escapeHtml(domain)}" data-device="${escapeHtml(d.deviceId)}">חסום למכשיר זה בלבד</button>
      </div>`;
  }

  function wireRequestActions() {
    document.querySelectorAll('#browserRequestsList [data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleRequestAction(btn));
    });
  }

  function wireDeviceActions(requestId) {
    const container = document.getElementById(`browserDevices-${requestId}`);
    if (!container) return;
    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleRequestAction(btn));
    });
  }

  async function handleRequestAction(btn) {
    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');
    if (action === 'refresh-requests') return loadRequests();
    if (action === 'toggle-devices') return toggleDevices(id);

    const domain = btn.getAttribute('data-domain');
    let scope, decision, deviceId, confirmMsg;
    if (action === 'global-allow' || action === 'global-block') {
      scope = 'GLOBAL';
      decision = action === 'global-allow' ? 'ALLOW' : 'BLOCK';
      confirmMsg = `${decision === 'ALLOW' ? 'לאשר' : 'לחסום'} את "${domain}" עבור כל הלקוחות במערכת?\n\n`
        + 'זו החלטה גלובלית - היא תחול מיד על כל מכשיר מנוהל, לא רק על מי שביקש את האתר הזה.';
    } else {
      scope = 'DEVICE';
      decision = action === 'device-allow' ? 'ALLOW' : 'BLOCK';
      deviceId = btn.getAttribute('data-device');
      confirmMsg = `${decision === 'ALLOW' ? 'לאשר' : 'לחסום'} את "${domain}" רק עבור המכשיר:\n${deviceId}\n\n`
        + 'זו החלטה למכשיר בודד בלבד - שאר הלקוחות שביקשו את אותו אתר יישארו בבדיקה עד שיוחלט עבורם בנפרד.';
    }
    if (!confirm(confirmMsg)) return;

    btn.disabled = true;
    try {
      const res = await fetch(`/api/browser/requests/${encodeURIComponent(id)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, decision, deviceId }),
      });
      if (showLoginIfUnauthorized(res.status)) return;
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`הפעולה נכשלה: ${body.error || res.status}`);
        btn.disabled = false;
        return;
      }
    } catch (e) {
      alert(`הפעולה נכשלה: ${e.message}`);
      btn.disabled = false;
      return;
    }
    loadRequests();
  }

  // ---------- Domains ----------

  let domainSearch = '';
  let domainDecisionFilter = '';

  async function loadDomains() {
    const el = document.getElementById('browserDomainsList');
    el.innerHTML = '<div class="empty-state">טוען...</div>';
    const params = new URLSearchParams();
    if (domainSearch) params.set('search', domainSearch);
    if (domainDecisionFilter) params.set('decision', domainDecisionFilter);
    let res;
    try {
      res = await fetch(`/api/browser/domains?${params.toString()}`);
    } catch {
      el.innerHTML = '<div class="empty-state">שגיאת תקשורת</div>';
      return;
    }
    if (showLoginIfUnauthorized(res.status)) return;
    if (!res.ok) {
      el.innerHTML = '<div class="empty-state">שגיאה בטעינת הדומיינים</div>';
      return;
    }
    const domains = await res.json();
    if (!domains.length) {
      el.innerHTML = '<div class="empty-state">אין דומיינים תואמים</div>';
      return;
    }
    el.innerHTML = domains.map(domainRow).join('');
    wireDomainActions();
  }

  function domainRow(d) {
    const extra = [
      d.category ? field('קטגוריה', escapeHtml(d.category)) : '',
      field('מקור', escapeHtml(d.source || '—')),
      d.reason ? field('סיבה', escapeHtml(d.reason)) : '',
      field('גרסת החלטה', d.decisionVersion),
      field('עודכן', fmtRelative(d.updatedAt)),
    ].join('');
    return `
      <div class="browser-domain-row" data-domain="${escapeHtml(d.domain)}">
        <div class="browser-domain-row-main">
          <span class="browser-domain-name">${escapeHtml(d.domain)}</span>
          ${decisionBadge(d.decision)}
          ${d.allowSubdomains ? '<span class="browser-badge subdomains">כולל תת-דומיינים</span>' : ''}
        </div>
        <div class="browser-fields">${extra}</div>
        <div class="browser-actions">
          <button class="browser-btn ghost" data-action="edit-domain">ערוך</button>
          <button class="browser-btn ghost" data-action="toggle-history">היסטוריה</button>
          <button class="browser-btn bad" data-action="delete-domain">מחק כלל</button>
        </div>
        <div class="browser-history" style="display:none;"></div>
      </div>`;
  }

  function wireDomainActions() {
    document.querySelectorAll('#browserDomainsList [data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleDomainAction(btn));
    });
  }

  async function handleDomainAction(btn) {
    const row = btn.closest('[data-domain]');
    const domain = row.getAttribute('data-domain');
    const action = btn.getAttribute('data-action');
    if (action === 'edit-domain') return fillDomainForm(domain);
    if (action === 'toggle-history') return toggleHistory(row, domain);
    if (action === 'delete-domain') {
      if (!confirm(`למחוק לצמיתות את הכלל עבור "${domain}"?\n\nהדומיין יחזור למצב "ללא החלטה" (בבדיקה) בפעם הבאה שמישהו ינסה לגלוש אליו.`)) {
        return;
      }
      btn.disabled = true;
      let res;
      try {
        res = await fetch(`/api/browser/domains/${encodeURIComponent(domain)}`, { method: 'DELETE' });
      } catch (e) {
        alert(`המחיקה נכשלה: ${e.message}`);
        btn.disabled = false;
        return;
      }
      if (showLoginIfUnauthorized(res.status)) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(`המחיקה נכשלה: ${body.error || res.status}`);
        btn.disabled = false;
        return;
      }
      loadDomains();
    }
  }

  async function fillDomainForm(domain) {
    const res = await fetch(`/api/browser/domains?search=${encodeURIComponent(domain)}`);
    if (showLoginIfUnauthorized(res.status)) return;
    const list = await res.json();
    const d = list.find(x => x.domain === domain);
    if (!d) return;
    document.getElementById('browserDomainInput').value = d.domain;
    document.getElementById('browserDecisionInput').value = d.decision;
    document.getElementById('browserAllowSubdomainsInput').checked = d.allowSubdomains;
    document.getElementById('browserCategoryInput').value = d.category || '';
    document.getElementById('browserReasonInput').value = d.reason || '';
    document.getElementById('browserDomainForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function clearDomainForm() {
    document.getElementById('browserDomainInput').value = '';
    document.getElementById('browserDecisionInput').value = 'ALLOW';
    document.getElementById('browserAllowSubdomainsInput').checked = false;
    document.getElementById('browserCategoryInput').value = '';
    document.getElementById('browserReasonInput').value = '';
  }

  async function toggleHistory(row, domain) {
    const container = row.querySelector('.browser-history');
    if (container.style.display !== 'none') {
      container.style.display = 'none';
      return;
    }
    container.style.display = 'block';
    container.innerHTML = '<div class="empty-state">טוען היסטוריה...</div>';
    let res;
    try {
      res = await fetch(`/api/browser/audit?domain=${encodeURIComponent(domain)}`);
    } catch {
      container.innerHTML = '<div class="empty-state">שגיאת תקשורת</div>';
      return;
    }
    if (showLoginIfUnauthorized(res.status)) return;
    const entries = await res.json();
    container.innerHTML = entries.length
      ? entries.map(auditRow).join('')
      : '<div class="empty-state">אין היסטוריה עדיין</div>';
  }

  function auditRow(a) {
    return `
      <div class="browser-audit-row">
        <span class="browser-audit-time">${fmtAbsolute(a.createdAt)}</span>
        <span>${escapeHtml(ACTION_LABEL[a.action] || a.action)}</span>
        ${scopeBadge(a.scope)}
        ${a.deviceId ? `<span class="browser-device-id">${escapeHtml(a.deviceId)}</span>` : ''}
        <span>${a.oldDecision ? decisionBadge(a.oldDecision) : '—'} ← ${a.newDecision ? decisionBadge(a.newDecision) : 'נמחק'}</span>
      </div>`;
  }

  // ---------- Wiring (runs once, at script load - matches the sub-tabs/
  // refresh-button pattern already used by health.js/alerts.js) ----------

  document.querySelectorAll('[data-browser-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-browser-mode');
      document.querySelectorAll('[data-browser-mode]').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('browserRequestsView').style.display = mode === 'requests' ? 'block' : 'none';
      document.getElementById('browserDomainsView').style.display = mode === 'domains' ? 'block' : 'none';
      if (mode === 'requests') loadRequests(); else loadDomains();
    });
  });

  const domainSearchInput = document.getElementById('browserDomainSearchInput');
  if (domainSearchInput) {
    domainSearchInput.addEventListener('input', debounce(() => {
      domainSearch = domainSearchInput.value.trim();
      loadDomains();
    }, 300));
  }
  const domainFilterSelect = document.getElementById('browserDomainFilterSelect');
  if (domainFilterSelect) {
    domainFilterSelect.addEventListener('change', () => {
      domainDecisionFilter = domainFilterSelect.value;
      loadDomains();
    });
  }
  const domainForm = document.getElementById('browserDomainForm');
  if (domainForm) {
    domainForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const domain = document.getElementById('browserDomainInput').value.trim();
      const decision = document.getElementById('browserDecisionInput').value;
      const allowSubdomains = document.getElementById('browserAllowSubdomainsInput').checked;
      const category = document.getElementById('browserCategoryInput').value.trim();
      const reason = document.getElementById('browserReasonInput').value.trim();
      if (allowSubdomains) {
        const ok = confirm(
          `להעניק "${DECISION_LABEL[decision] || decision}" ל-"${domain}" כולל כל תת-הדומיינים שלו?\n\n`
          + `פעולה זו תשפיע על כל כתובת שמסתיימת ב-".${domain}", לא רק על הדומיין המדויק.`,
        );
        if (!ok) return;
      }
      const submitBtn = domainForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      let res;
      try {
        res = await fetch('/api/browser/domains', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain, decision, allowSubdomains,
            category: category || undefined,
            reason: reason || undefined,
          }),
        });
      } catch (err) {
        alert(`השמירה נכשלה: ${err.message}`);
        if (submitBtn) submitBtn.disabled = false;
        return;
      }
      if (showLoginIfUnauthorized(res.status)) { if (submitBtn) submitBtn.disabled = false; return; }
      const body = await res.json().catch(() => ({}));
      if (submitBtn) submitBtn.disabled = false;
      if (!res.ok) {
        alert(`השמירה נכשלה: ${body.error || res.status}`);
        return;
      }
      clearDomainForm();
      loadDomains();
    });
  }

  const requestsRefreshBtn = document.getElementById('browserRequestsRefreshBtn');
  if (requestsRefreshBtn) requestsRefreshBtn.addEventListener('click', loadRequests);
  const domainsRefreshBtn = document.getElementById('browserDomainsRefreshBtn');
  if (domainsRefreshBtn) domainsRefreshBtn.addEventListener('click', loadDomains);

  // Lazy load: only fetch once the tab is actually opened, same as
  // health.js's loadHealthPanel wiring.
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === 'browser') {
      btn.addEventListener('click', loadRequests);
    }
  });
})();
