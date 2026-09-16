(function () {
  const modal = document.getElementById('playSearchModal');
  const openBtn = document.getElementById('openPlaySearchBtn');
  const closeBtn = document.getElementById('closePlaySearchBtn');
  const searchBtn = document.getElementById('playSearchBtn');
  const input = document.getElementById('playSearchInput');
  const results = document.getElementById('playSearchResults');
  if (!modal || !openBtn || !closeBtn || !searchBtn || !input || !results) return;

  let categoriesCache = null;

  function escapeHtml(str) { return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function requireLogin() { modal.style.display = 'none'; const login = document.getElementById('loginScreen'); if (login) login.style.display = 'flex'; }
  function iconHtml(app) {
    if (app.iconUrl) return `<div class="catalog-icon-frame"><img class="catalog-icon" src="${escapeHtml(app.iconUrl)}" alt="" /></div>`;
    return `<div class="catalog-icon-frame"><div class="catalog-icon-placeholder">${escapeHtml((app.name || '?')[0])}</div></div>`;
  }

  async function loadCategories() {
    if (Array.isArray(categoriesCache) && categoriesCache.length) return categoriesCache;
    const res = await fetch('/api/apps/categories');
    if (res.status === 401) { requireLogin(); throw new Error('auth'); }
    const body = await res.json().catch(() => []);
    if (!res.ok || !Array.isArray(body) || !body.length) throw new Error('categories');
    categoriesCache = body;
    return body;
  }

  async function chooseCategory(appName) {
    let categories;
    try {
      categories = await loadCategories();
    } catch (e) {
      if (e.message !== 'auth') alert('לא ניתן לטעון את רשימת הקטגוריות כרגע');
      return null;
    }

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:20px;direction:rtl';
      const card = document.createElement('div');
      card.style.cssText = 'width:min(92vw,420px);background:#fff;border-radius:18px;padding:20px;box-shadow:0 18px 50px rgba(0,0,0,.22);font-family:inherit';
      const title = document.createElement('div');
      title.textContent = 'בחר קטגוריה לאפליקציה';
      title.style.cssText = 'font-weight:800;font-size:18px;margin-bottom:6px;color:#1C1C1C';
      const subtitle = document.createElement('div');
      subtitle.textContent = appName || 'האפליקציה';
      subtitle.style.cssText = 'font-size:13px;color:#777;margin-bottom:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      const select = document.createElement('select');
      select.style.cssText = 'width:100%;padding:12px;border:1px solid #D8D8D0;border-radius:12px;background:#F7F6EF;font:inherit;margin-bottom:16px';
      categories.forEach(category => {
        const option = document.createElement('option');
        option.value = category.key;
        option.textContent = category.label;
        select.appendChild(option);
      });
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:10px';
      const confirm = document.createElement('button');
      confirm.textContent = 'הוסף לקטגוריה';
      confirm.style.cssText = 'flex:1;border:0;border-radius:11px;padding:11px 12px;background:#4B6B45;color:white;font-weight:800;font:inherit;cursor:pointer';
      const cancel = document.createElement('button');
      cancel.textContent = 'ביטול';
      cancel.style.cssText = 'border:1px solid #D8D8D0;border-radius:11px;padding:11px 16px;background:white;color:#444;font:inherit;cursor:pointer';
      const finish = value => { overlay.remove(); resolve(value); };
      confirm.addEventListener('click', () => finish(select.value || null));
      cancel.addEventListener('click', () => finish(null));
      overlay.addEventListener('click', e => { if (e.target === overlay) finish(null); });
      actions.appendChild(confirm); actions.appendChild(cancel);
      card.appendChild(title); card.appendChild(subtitle); card.appendChild(select); card.appendChild(actions);
      overlay.appendChild(card); document.body.appendChild(overlay); select.focus();
    });
  }

  function render(items) {
    if (!items.length) { results.innerHTML = '<div class="empty-state">לא נמצאו אפליקציות</div>'; return; }
    results.innerHTML = `<div class="play-search-count">נמצאו ${items.length} תוצאות · גלול למטה כדי לראות עוד</div><div class="play-search-grid">${items.map(app => `<div class="catalog-tile">${iconHtml(app)}<div class="catalog-name">${escapeHtml(app.name)}</div>${app.developer ? `<div class="catalog-package" style="direction:rtl">${escapeHtml(app.developer)}</div>` : ''}<div class="catalog-package">${escapeHtml(app.packageName)}</div><div class="catalog-tile-actions"><button class="add-app-btn" data-add-play="${escapeHtml(app.packageName)}">הוסף לחנות</button></div></div>`).join('')}</div>`;
    results.scrollTop = 0;
    results.querySelectorAll('[data-add-play]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const packageName = btn.dataset.addPlay;
        const app = items.find(item => item.packageName === packageName) || {};
        const category = await chooseCategory(app.name || packageName);
        if (!category) return;
        const original = btn.textContent; btn.disabled = true; btn.textContent = 'מוסיף...';
        try {
          const res = await fetch('/api/apps/from-play', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({packageName, category})});
          if (res.status === 401) { requireLogin(); return; }
          const body = await res.json().catch(() => ({}));
          if (!res.ok) { alert(body.error || 'לא ניתן להוסיף את האפליקציה'); return; }
          btn.textContent = '✓ נוסף לחנות';
          if (typeof loadAppsCatalog === 'function') await loadAppsCatalog();
        } catch (_) { alert('שגיאת תקשורת'); }
        finally { if (btn.isConnected && btn.textContent !== '✓ נוסף לחנות') { btn.disabled = false; btn.textContent = original; } }
      });
    });
  }

  async function search() {
    const query = input.value.trim();
    if (query.length < 2) { results.innerHTML = '<div class="empty-state">הקלד לפחות 2 תווים</div>'; return; }
    searchBtn.disabled = true; searchBtn.textContent = 'מחפש...'; results.innerHTML = '<div class="empty-state">מחפש ב-Google Play...</div>';
    try {
      const res = await fetch(`/api/apps/play-search?q=${encodeURIComponent(query)}`);
      if (res.status === 401) { requireLogin(); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { results.innerHTML = `<div class="empty-state">${escapeHtml(body.error || 'החיפוש נכשל')}</div>`; return; }
      render(Array.isArray(body) ? body : []);
    } catch (_) { results.innerHTML = '<div class="empty-state">שגיאת תקשורת</div>'; }
    finally { searchBtn.disabled = false; searchBtn.textContent = 'חפש'; }
  }

  openBtn.addEventListener('click', () => { modal.style.display = 'flex'; results.innerHTML = '<div class="empty-state">חפש אפליקציה לפי שם</div>'; input.value = ''; setTimeout(() => input.focus(), 0); });
  closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  searchBtn.addEventListener('click', search);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
})();
