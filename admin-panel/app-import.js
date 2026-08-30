(function () {
  const modal = document.getElementById('playSearchModal');
  const openBtn = document.getElementById('openPlaySearchBtn');
  const closeBtn = document.getElementById('closePlaySearchBtn');
  const searchBtn = document.getElementById('playSearchBtn');
  const input = document.getElementById('playSearchInput');
  const results = document.getElementById('playSearchResults');

  if (!modal || !openBtn || !closeBtn || !searchBtn || !input || !results) return;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function iconHtml(app) {
    if (app.iconUrl) {
      return `<div class="catalog-icon-frame"><img class="catalog-icon" src="${escapeHtml(app.iconUrl)}" alt="" /></div>`;
    }
    return `<div class="catalog-icon-frame"><div class="catalog-icon-placeholder">${escapeHtml((app.name || '?')[0])}</div></div>`;
  }

  function render(items) {
    if (!items.length) {
      results.innerHTML = '<div class="empty-state">לא נמצאו אפליקציות</div>';
      return;
    }
    results.innerHTML = `<div class="catalog-grid">${items.map(app => `
      <div class="catalog-tile">
        ${iconHtml(app)}
        <div class="catalog-name">${escapeHtml(app.name)}</div>
        <div class="catalog-package">${escapeHtml(app.packageName)}</div>
        <div class="catalog-tile-actions">
          <button class="add-app-btn" data-add-play="${escapeHtml(app.packageName)}">הוסף לחנות</button>
        </div>
      </div>
    `).join('')}</div>`;

    results.querySelectorAll('[data-add-play]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const packageName = btn.getAttribute('data-add-play');
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'מוסיף...';
        try {
          const res = await fetch('/api/apps/from-play', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ packageName }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            alert(body.error || 'לא ניתן להוסיף את האפליקציה');
            return;
          }
          btn.textContent = '✓ נוסף לחנות';
          if (typeof loadAppsCatalog === 'function') await loadAppsCatalog();
        } catch (e) {
          alert('שגיאת תקשורת');
        } finally {
          if (btn.textContent !== '✓ נוסף לחנות') {
            btn.disabled = false;
            btn.textContent = original;
          }
        }
      });
    });
  }

  async function search() {
    const query = input.value.trim();
    if (query.length < 2) {
      results.innerHTML = '<div class="empty-state">הקלד לפחות 2 תווים</div>';
      return;
    }
    searchBtn.disabled = true;
    searchBtn.textContent = 'מחפש...';
    results.innerHTML = '<div class="empty-state">מחפש ב-Google Play...</div>';
    try {
      const res = await fetch(`/api/apps/play-search?q=${encodeURIComponent(query)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        results.innerHTML = `<div class="empty-state">${escapeHtml(body.error || 'החיפוש נכשל')}</div>`;
        return;
      }
      render(body);
    } catch (e) {
      results.innerHTML = '<div class="empty-state">שגיאת תקשורת</div>';
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = 'חפש';
    }
  }

  openBtn.addEventListener('click', () => {
    modal.style.display = 'flex';
    results.innerHTML = '<div class="empty-state">חפש אפליקציה לפי שם</div>';
    input.value = '';
    setTimeout(() => input.focus(), 0);
  });
  closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  searchBtn.addEventListener('click', search);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
})();
