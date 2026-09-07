'use strict';

(function () {
  const controls = [
    ['TEST', 0, 'בדיקה בלבד'],
    ['ROLLOUT', 10, '10%'],
    ['ROLLOUT', 25, '25%'],
    ['ROLLOUT', 50, '50%'],
    ['STABLE', 100, 'יציב 100%'],
    ['HALTED', 0, 'עצירה מיידית'],
  ];

  async function jsonFetch(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function statusLabel(status, percentage) {
    if (status === 'TEST') return 'בדיקה בלבד';
    if (status === 'STABLE') return 'יציב — 100%';
    if (status === 'HALTED') return 'עצור';
    if (status === 'ROLLOUT') return `הפצה מדורגת — ${percentage}%`;
    return status || 'לא ידוע';
  }

  async function loadReleaseControl() {
    const stats = document.querySelector('.stats');
    if (!stats) return;

    let card = document.getElementById('dpcReleaseControl');
    if (!card) {
      card = document.createElement('section');
      card.id = 'dpcReleaseControl';
      card.className = 'release-control-card';
      stats.insertAdjacentElement('afterend', card);
    }

    card.innerHTML = '<div class="release-control-title">הפצת גרסת DPC</div><div class="release-control-meta">טוען…</div>';
    try {
      const releases = await jsonFetch('/api/releases');
      const current = releases.find(r => r.isCurrent) || releases[0];
      if (!current) {
        card.innerHTML = '<div class="release-control-title">הפצת גרסת DPC</div><div class="release-control-meta">אין גרסה שפורסמה עדיין.</div>';
        return;
      }

      const meta = document.createElement('div');
      meta.className = 'release-control-meta';
      meta.innerHTML = `גרסה <b>${current.versionCode}</b> · ${statusLabel(current.releaseStatus, current.rolloutPercentage)}<br>` +
        'מכשירי בדיקה מקבלים גרסת TEST; שאר המכשירים נכנסים ל-rollout לפי bucket קבוע.';

      const actions = document.createElement('div');
      actions.className = 'release-control-actions';
      controls.forEach(([status, percentage, label]) => {
        const btn = document.createElement('button');
        btn.className = 'release-control-btn' + (status === 'HALTED' ? ' halt' : '');
        if (current.releaseStatus === status && Number(current.rolloutPercentage) === percentage) {
          btn.classList.add('active');
        }
        btn.textContent = label;
        btn.addEventListener('click', async () => {
          const warning = status === 'STABLE'
            ? 'להפיץ את הגרסה לכל המכשירים?'
            : status === 'HALTED'
              ? 'לעצור מיד הפצה חדשה של הגרסה? מכשירים שכבר עודכנו לא יורדו גרסה.'
              : null;
          if (warning && !confirm(warning)) return;
          actions.querySelectorAll('button').forEach(b => { b.disabled = true; });
          try {
            await jsonFetch(`/api/releases/${encodeURIComponent(current.versionCode)}/control`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status, rolloutPercentage: percentage }),
            });
            await loadReleaseControl();
          } catch (e) {
            alert('עדכון מצב ההפצה נכשל: ' + e.message);
            actions.querySelectorAll('button').forEach(b => { b.disabled = false; });
          }
        });
        actions.appendChild(btn);
      });

      card.innerHTML = '<div class="release-control-title">הפצת גרסת DPC</div>';
      card.appendChild(meta);
      card.appendChild(actions);
    } catch (e) {
      card.innerHTML = '<div class="release-control-title">הפצת גרסת DPC</div>' +
        `<div class="release-control-error">לא ניתן לטעון את בקרת ההפצה: ${String(e.message || e)}</div>`;
    }
  }

  async function ensureTestDeviceButton() {
    const deviceId = window.__currentDetailDeviceId;
    const actions = document.querySelector('#detailContent .cmd-actions');
    if (!deviceId || !actions || document.getElementById('detailTestDeviceToggle')) return;

    const btn = document.createElement('button');
    btn.id = 'detailTestDeviceToggle';
    btn.className = 'cmd-btn test-device-btn';
    btn.textContent = 'מכשיר בדיקה';
    actions.appendChild(btn);

    try {
      const devices = await jsonFetch('/api/devices');
      const device = devices.find(d => String(d.deviceId) === String(deviceId));
      let enabled = device?.isTestDevice === true;
      const render = () => {
        btn.classList.toggle('active', enabled);
        btn.textContent = enabled ? '✓ מכשיר בדיקה' : 'מכשיר בדיקה';
      };
      render();
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const updated = await jsonFetch(`/api/devices/${encodeURIComponent(deviceId)}/test-device`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isTestDevice: !enabled }),
          });
          enabled = updated.isTestDevice === true;
          render();
        } catch (e) {
          alert('עדכון מכשיר הבדיקה נכשל: ' + e.message);
        } finally {
          btn.disabled = false;
        }
      });
    } catch (_) {
      btn.remove();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadReleaseControl();
    const observer = new MutationObserver(() => { ensureTestDeviceButton(); });
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
