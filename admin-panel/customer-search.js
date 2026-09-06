// Unified customer search/profile panel for the mobile admin dashboard.
// Loaded dynamically from news.js to avoid duplicating the existing device-detail implementation.
(function () {
  'use strict';

  function esc(v) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(v == null ? '' : String(v));
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function fmtDate(v) {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('he-IL');
  }

  function getStatus(d) {
    if (typeof window.subStatus === 'function') return window.subStatus(d);
    if (!d || !d.subscriptionExpiresAt) return { text: 'ללא מנוי', cls: 'status-none' };
    return new Date(d.subscriptionExpiresAt) > new Date()
      ? { text: 'מנוי פעיל', cls: 'status-active' }
      : { text: 'מנוי לא פעיל', cls: 'status-expired' };
  }

  function ensurePanel() {
    let panel = document.getElementById('unifiedCustomerProfile');
    if (panel) return panel;
    const searchCard = document.querySelector('.quick-search-card');
    if (!searchCard) return null;
    panel = document.createElement('section');
    panel.id = 'unifiedCustomerProfile';
    panel.className = 'unified-customer-profile';
    panel.style.display = 'none';
    searchCard.insertAdjacentElement('afterend', panel);
    return panel;
  }

  function render(deviceId) {
    const panel = ensurePanel();
    if (!panel) return;
    const devices = Array.isArray(window.allDevices) ? window.allDevices : [];
    const d = devices.find(x => x && x.deviceId === deviceId);
    if (!d) {
      panel.style.display = 'none';
      panel.innerHTML = '';
      return;
    }

    const status = getStatus(d);
    const p = d.policy || {};
    const apps = Array.isArray(p.allowedApps) ? p.allowedApps : [];
    const pending = Array.isArray(d.pendingCommands) ? d.pendingCommands : [];
    const history = Array.isArray(d.commandHistory) ? d.commandHistory : [];
    const deviceStatus = d.status || {};
    const lastCommands = history.slice(-5).reverse();

    panel.innerHTML = `
      <div class="unified-profile-head">
        <div>
          <div class="unified-profile-name">${esc(d.customerName || 'לקוח ללא שם')}</div>
          <div class="unified-profile-number">${d.customerNumber ? 'טלפון / מספר לקוח: ' + esc(d.customerNumber) : 'טלפון / מספר לקוח: —'}</div>
        </div>
        <button type="button" class="toggle-btn" data-unified-close>סגור</button>
      </div>

      <div class="unified-profile-grid">
        <div class="unified-info-card"><span>מזהה מכשיר</span><strong dir="ltr">${esc(d.deviceId)}</strong></div>
        <div class="unified-info-card"><span>מצב מנוי</span><strong class="${esc(status.cls || '')}">${esc(status.text || '—')}</strong></div>
        <div class="unified-info-card"><span>נרשם</span><strong>${esc(fmtDate(d.registeredAt))}</strong></div>
        <div class="unified-info-card"><span>דגם</span><strong>${esc(deviceStatus.model || '—')}</strong></div>
        <div class="unified-info-card"><span>Android</span><strong>${esc(deviceStatus.androidVersion || '—')}</strong></div>
        <div class="unified-info-card"><span>נראה לאחרונה</span><strong>${esc(fmtDate(deviceStatus.lastSeen))}</strong></div>
        <div class="unified-info-card"><span>סנכרון מדיניות</span><strong>${esc(p.syncIntervalMinutes || 60)} דקות</strong></div>
        <div class="unified-info-card"><span>מצב קיוסק</span><strong>${p.kioskEnabled ? 'פעיל' : 'כבוי'}</strong></div>
      </div>

      <div class="unified-profile-section">
        <h3>אפליקציות מותרות (${apps.length})</h3>
        <div class="unified-chip-list">${apps.length ? apps.map(a => `<span class="app-chip">${esc(a)}</span>`).join('') : '<span class="no-apps">אין אפליקציות מוגדרות</span>'}</div>
      </div>

      <div class="unified-profile-section">
        <h3>פקודות</h3>
        <div class="unified-command-summary">ממתינות: <strong>${pending.length}</strong> · היסטוריה: <strong>${history.length}</strong></div>
        ${lastCommands.length ? `<div class="unified-last-commands">${lastCommands.map(c => `<div>${esc(typeof window.commandLabel === 'function' ? window.commandLabel(c.command) : c.command)} · ${esc(fmtDate(c.deliveredAt || c.queuedAt))}</div>`).join('')}</div>` : '<div class="no-apps">אין היסטוריית פקודות</div>'}
      </div>

      <div class="unified-profile-actions">
        <button type="button" class="add-app-btn" data-unified-manage="${esc(d.deviceId)}">פתח ניהול מלא</button>
        <button type="button" class="toggle-btn" data-unified-diagnostics="${esc(d.deviceId)}">אבחון מלא</button>
      </div>
    `;
    panel.style.display = 'block';

    panel.querySelector('[data-unified-close]')?.addEventListener('click', () => {
      panel.style.display = 'none';
      panel.innerHTML = '';
      const input = document.getElementById('quickCustomerSearch');
      if (input) input.value = '';
    });
    panel.querySelector('[data-unified-manage]')?.addEventListener('click', e => {
      if (typeof window.openDeviceDetail === 'function') window.openDeviceDetail(e.currentTarget.getAttribute('data-unified-manage'));
    });
    panel.querySelector('[data-unified-diagnostics]')?.addEventListener('click', e => {
      const id = e.currentTarget.getAttribute('data-unified-diagnostics');
      if (typeof window.openDeviceDiagnostics === 'function') window.openDeviceDiagnostics(id);
    });
  }

  function matchingDevices(value) {
    const q = String(value || '').trim().toLowerCase();
    if (!q) return [];
    const digits = q.replace(/\D/g, '');
    return (Array.isArray(window.allDevices) ? window.allDevices : []).filter(d => {
      const name = String(d.customerName || '').toLowerCase();
      const number = String(d.customerNumber || '').toLowerCase();
      const id = String(d.deviceId || '').toLowerCase();
      const numberDigits = number.replace(/\D/g, '');
      return name.includes(q) || number.includes(q) || id.includes(q) || (digits.length >= 3 && numberDigits.includes(digits));
    });
  }

  function init() {
    const input = document.getElementById('quickCustomerSearch');
    const results = document.getElementById('quickCustomerResults');
    if (!input || !results) return;
    ensurePanel();

    // Intercept selection before the legacy handler opens the separate detail overlay.
    results.addEventListener('click', e => {
      const btn = e.target.closest('[data-quick-device]');
      if (!btn) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const id = btn.getAttribute('data-quick-device');
      results.style.display = 'none';
      render(id);
    }, true);

    // As the manager types, if there is exactly one match, show it immediately.
    input.addEventListener('input', () => {
      const matches = matchingDevices(input.value);
      if (matches.length === 1) render(matches[0].deviceId);
      else if (!input.value.trim()) {
        const panel = ensurePanel();
        if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
      }
    });

    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const matches = matchingDevices(input.value);
      if (matches.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        results.style.display = 'none';
        render(matches[0].deviceId);
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.renderUnifiedCustomerProfile = render;
})();
