(function () {
  'use strict';

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function deviceById(id) {
    const devices = Array.isArray(window.__allDevices) ? window.__allDevices : [];
    return devices.find(d => d && d.deviceId === id) || null;
  }

  function cardHtml(deviceId, compact) {
    const d = deviceById(deviceId);
    const active = d && d.fullOpenMode === true;
    return `<div class="full-open-card${compact ? ' compact' : ''}${active ? ' active' : ''}" data-full-open-card="${esc(deviceId)}">
      <div class="full-open-head">
        <div>
          <strong>פתיחת המכשיר</strong>
          <div class="full-open-status">${active ? 'המכשיר פתוח בפועל — אפליקציות והגבלות המדיניות משוחררות' : 'המכשיר במצב מסונן ומוגבל'}</div>
        </div>
        <span class="full-open-badge ${active ? 'active' : ''}">${active ? 'פתוח' : 'חסום'}</span>
      </div>
      <div class="full-open-note">זו פתיחה אמיתית של המכשיר, לא חריגת מנוי. Device Owner נשאר פעיל כדי שתוכל להחזיר את החסימה מרחוק, וגם חסימת איפוס/הסרת ניהול נשארת פעילה.</div>
      <div class="full-open-actions">
        ${active
          ? '<button type="button" class="toggle-btn full-open-restore" data-full-open-disable>החזר חסימה וסינון</button>'
          : '<button type="button" class="toggle-btn full-open-enable" data-full-open-enable>פתח את המכשיר באמת</button>'}
      </div>
    </div>`;
  }

  async function submit(deviceId, enabled, button) {
    const prompt = enabled
      ? 'לפתוח את המכשיר בפועל? הפעולה תפעיל Full Open, תפתח את האפליקציות וההתקנות ותשחרר את הגבלות המדיניות. Device Owner יישאר פעיל כדי שתוכל לסגור שוב מרחוק.'
      : 'להחזיר את החסימה, הסינון ורשימת האפליקציות הרגילה למכשיר?';
    if (!confirm(prompt)) return;

    button.disabled = true;
    const old = button.textContent;
    button.textContent = 'שומר ושולח למכשיר...';
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/full-open`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ enabled }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error || 'שינוי מצב הפתיחה נכשל');
        return;
      }
      const devices = Array.isArray(window.__allDevices) ? window.__allDevices : [];
      const idx = devices.findIndex(d => d.deviceId === deviceId);
      if (idx >= 0) devices[idx] = body;
      if (typeof window.loadDevices === 'function') await window.loadDevices();
      else remount();
    } catch (_) {
      alert('שגיאת תקשורת בשינוי מצב הפתיחה');
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  function bind(card) {
    if (!card || card.dataset.bound === '1') return;
    card.dataset.bound = '1';
    const id = card.getAttribute('data-full-open-card');
    card.querySelector('[data-full-open-enable]')?.addEventListener('click', e => submit(id, true, e.currentTarget));
    card.querySelector('[data-full-open-disable]')?.addEventListener('click', e => submit(id, false, e.currentTarget));
  }

  function mountUnified() {
    const panel = document.getElementById('unifiedCustomerProfile');
    if (!panel || panel.style.display === 'none' || panel.querySelector('[data-full-open-card]')) return;
    const manage = panel.querySelector('.unified-profile-actions');
    const button = panel.querySelector('[data-unified-manage]');
    const id = button && button.getAttribute('data-unified-manage');
    if (!id) return;
    const holder = document.createElement('div');
    holder.innerHTML = cardHtml(id, true);
    const card = holder.firstElementChild;
    manage ? manage.insertAdjacentElement('beforebegin', card) : panel.appendChild(card);
    bind(card);
  }

  function mountDetail() {
    const detail = document.getElementById('detailContent');
    if (!detail || !detail.children.length || detail.querySelector('[data-full-open-card]')) return;
    const id = window.__currentDetailDeviceId || null;
    if (!id) return;
    const holder = document.createElement('div');
    holder.innerHTML = `<div class="detail-section"><h3>פתיחת המכשיר</h3>${cardHtml(id, false)}</div>`;
    const section = holder.firstElementChild;
    const subscriptionExceptionSection = [...detail.querySelectorAll('.detail-section')]
      .find(s => s.querySelector('h3')?.textContent.trim() === 'החרגת מנוי');
    const subscriptionSection = [...detail.querySelectorAll('.detail-section')]
      .find(s => s.querySelector('h3')?.textContent.trim() === 'מנוי');
    const anchor = subscriptionExceptionSection || subscriptionSection;
    anchor ? anchor.insertAdjacentElement('afterend', section) : detail.appendChild(section);
    bind(section.querySelector('[data-full-open-card]'));
  }

  function remount() {
    mountUnified();
    mountDetail();
  }

  new MutationObserver(remount).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', remount);
  setTimeout(remount, 0);
})();
