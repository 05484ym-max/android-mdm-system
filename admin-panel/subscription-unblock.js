(function () {
  'use strict';

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = iso => iso ? new Date(iso).toLocaleString('he-IL') : '—';

  function deviceById(id) {
    const devices = Array.isArray(window.__allDevices) ? window.__allDevices : [];
    return devices.find(d => d && d.deviceId === id) || null;
  }

  function accessText(d) {
    const a = d && d.subscriptionAccess;
    if (!a || !a.overrideActive) return 'אין פתיחה חריגה פעילה';
    if (a.overridePermanent) return 'פתוח לתמיד';
    return `פתוח עד ${fmt(a.overrideUntil)}`;
  }

  function controlsHtml(deviceId, compact) {
    const d = deviceById(deviceId);
    const active = d && d.subscriptionAccess && d.subscriptionAccess.overrideActive;
    return `<div class="subscription-unblock-card${compact ? ' compact' : ''}" data-sub-unblock-card="${esc(deviceId)}">
      <div class="subscription-unblock-head">
        <div>
          <strong>פתיחת חסימת מנוי</strong>
          <div class="subscription-unblock-status">${esc(accessText(d))}</div>
        </div>
        ${active ? '<span class="subscription-unblock-badge">פתוח</span>' : '<span class="subscription-unblock-badge inactive">ללא פתיחה</span>'}
      </div>
      <div class="subscription-unblock-grid">
        <select class="customer-input" data-sub-unblock-mode>
          <option value="24h">24 שעות</option>
          <option value="days">מספר ימים</option>
          <option value="until">עד תאריך ושעה</option>
          <option value="permanent">לתמיד</option>
        </select>
        <input class="customer-input" type="number" min="1" max="3650" value="3" data-sub-unblock-days style="display:none" aria-label="מספר ימים" />
        <input class="customer-input" type="datetime-local" data-sub-unblock-until style="display:none" aria-label="תאריך סיום" />
        <button type="button" class="renew-btn" data-sub-unblock-apply>פתח חסימה</button>
        ${active ? '<button type="button" class="toggle-btn cmd-danger" data-sub-unblock-clear>בטל פתיחה</button>' : ''}
      </div>
      <div class="subscription-unblock-note">הפתיחה אינה מסירה Device Owner ואינה מבטלת את סינון התוכן.</div>
    </div>`;
  }

  function bindCard(card) {
    if (!card || card.dataset.bound === '1') return;
    card.dataset.bound = '1';
    const mode = card.querySelector('[data-sub-unblock-mode]');
    const days = card.querySelector('[data-sub-unblock-days]');
    const until = card.querySelector('[data-sub-unblock-until]');
    const apply = card.querySelector('[data-sub-unblock-apply]');
    const clear = card.querySelector('[data-sub-unblock-clear]');
    const deviceId = card.getAttribute('data-sub-unblock-card');

    function refreshInputs() {
      days.style.display = mode.value === 'days' ? '' : 'none';
      until.style.display = mode.value === 'until' ? '' : 'none';
    }
    mode.addEventListener('change', refreshInputs);
    refreshInputs();

    apply.addEventListener('click', async () => {
      const payload = { mode: mode.value };
      if (mode.value === 'days') payload.days = Number(days.value);
      if (mode.value === 'until') {
        if (!until.value) { alert('בחר תאריך ושעה'); return; }
        payload.until = new Date(until.value).toISOString();
      }
      await submit(deviceId, payload, apply);
    });
    if (clear) clear.addEventListener('click', async () => {
      if (!confirm('לבטל את פתיחת החסימה ולחזור למצב המנוי הרגיל?')) return;
      await submit(deviceId, { mode: 'clear' }, clear);
    });
  }

  async function submit(deviceId, payload, button) {
    button.disabled = true;
    const old = button.textContent;
    button.textContent = 'שומר...';
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/subscription-unblock`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { alert(body.error || 'שמירת פתיחת החסימה נכשלה'); return; }
      const devices = Array.isArray(window.__allDevices) ? window.__allDevices : [];
      const idx = devices.findIndex(d => d.deviceId === deviceId);
      if (idx >= 0) devices[idx] = body;
      if (typeof window.loadDevices === 'function') await window.loadDevices();
      else remount();
    } catch (_) {
      alert('שגיאת תקשורת בשמירת פתיחת החסימה');
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  function mountUnified() {
    const panel = document.getElementById('unifiedCustomerProfile');
    if (!panel || panel.style.display === 'none') return;
    if (panel.querySelector('[data-sub-unblock-card]')) return;
    const manage = panel.querySelector('.unified-profile-actions');
    const name = panel.querySelector('[data-unified-manage]');
    const id = name && name.getAttribute('data-unified-manage');
    if (!id) return;
    const holder = document.createElement('div');
    holder.innerHTML = controlsHtml(id, true);
    const card = holder.firstElementChild;
    manage ? manage.insertAdjacentElement('beforebegin', card) : panel.appendChild(card);
    bindCard(card);
  }

  function mountDetail() {
    const detail = document.getElementById('detailContent');
    if (!detail || !detail.children.length) return;
    if (detail.querySelector('[data-sub-unblock-card]')) return;
    const deviceId = window.__currentDetailDeviceId || null;
    if (!deviceId) return;
    const sections = [...detail.querySelectorAll('.detail-section')];
    const subscription = sections.find(s => s.querySelector('h3')?.textContent.trim() === 'מנוי');
    if (!subscription) return;
    const holder = document.createElement('div');
    holder.innerHTML = `<div class="detail-section"><h3>פתיחת חסימת מנוי</h3>${controlsHtml(deviceId, false)}</div>`;
    const section = holder.firstElementChild;
    subscription.insertAdjacentElement('afterend', section);
    bindCard(section.querySelector('[data-sub-unblock-card]'));
  }

  function remount() {
    mountUnified();
    mountDetail();
  }

  const observer = new MutationObserver(remount);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', remount);
  setTimeout(remount, 0);
})();
