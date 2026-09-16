// News and customer updates management.
(function () {
  'use strict';
  const listEl = document.getElementById('newsList');
  const titleInput = document.getElementById('newsTitleInput');
  const bodyInput = document.getElementById('newsBodyInput');
  const pinnedInput = document.getElementById('newsPinnedInput');
  const publishedInput = document.getElementById('newsPublishedInput');
  const saveBtn = document.getElementById('newsSaveBtn');
  const cancelEditBtn = document.getElementById('newsCancelEditBtn');
  const formTitle = document.getElementById('newsFormTitle');
  const formError = document.getElementById('newsFormError');
  const refreshBtn = document.getElementById('newsRefreshBtn');
  const mediaInput = document.getElementById('newsMediaInput');
  const mediaPreview = document.getElementById('newsMediaPreview');
  const removeMediaRow = document.getElementById('newsRemoveMediaRow');
  const removeMediaInput = document.getElementById('newsRemoveMediaInput');
  const bubbleWidthInput = document.getElementById('newsBubbleWidthInput');
  const bubbleWidthNumber = document.getElementById('newsBubbleWidthNumber');
  if (!listEl || !titleInput || !bodyInput || !pinnedInput || !publishedInput || !saveBtn || !cancelEditBtn || !formTitle || !formError || !mediaInput || !mediaPreview || !removeMediaRow || !removeMediaInput || !bubbleWidthInput || !bubbleWidthNumber) return;

  let editingId = null;
  let editingItem = null;
  let localPreviewUrl = null;
  const esc = str => String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const mediaLabel = document.querySelector('label[for="newsMediaInput"]');
  if (mediaLabel) mediaLabel.textContent = '📎 צרף תמונה או סרטון';
  const clampBubbleWidth = value => Math.max(55, Math.min(100, Number.parseInt(value, 10) || 88));
  function applyBubblePreviewWidth(value) {
    const width = clampBubbleWidth(value);
    mediaPreview.style.width = `${width}%`;
    mediaPreview.style.marginInlineStart = 'auto';
  }
  function setBubbleWidth(value) {
    const width = clampBubbleWidth(value);
    bubbleWidthInput.value = String(width);
    bubbleWidthNumber.value = String(width);
    applyBubblePreviewWidth(width);
  }

  function requireLogin() { const el = document.getElementById('loginScreen'); if (el) el.style.display = 'flex'; }
  function selectedMediaKind(file) {
    if (!file) return null;
    const mime = String(file.type || '').toLowerCase(); const name = String(file.name || '').toLowerCase();
    if (mime.startsWith('image/') || /\.(png|jpe?g|webp|heic|heif)$/.test(name)) return 'IMAGE';
    if (mime.startsWith('video/') || /\.(mp4|webm)$/.test(name)) return 'VIDEO';
    return null;
  }
  function clearLocalPreviewUrl() { if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl); localPreviewUrl = null; }
  function mediaMarkup(type, url, controls = true) {
    if (!url) return '';
    const safe = esc(url);
    if (type === 'IMAGE') return `<img src="${safe}" alt="מדיה מצורפת" loading="lazy" />`;
    if (type === 'VIDEO') return `<video src="${safe}" ${controls ? 'controls' : ''} preload="metadata" playsinline></video>`;
    return '';
  }
  function fmtDateTime(iso) { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('he-IL', {dateStyle:'short',timeStyle:'short'}); }
  function showFormMediaPreview(item) {
    clearLocalPreviewUrl(); mediaPreview.innerHTML = '';
    if (item && item.mediaUrl) { mediaPreview.innerHTML = mediaMarkup(item.mediaType, item.mediaUrl); mediaPreview.style.display = ''; removeMediaRow.style.display = ''; }
    else { mediaPreview.style.display = 'none'; removeMediaRow.style.display = 'none'; }
  }
  function resetForm() {
    editingId = null; editingItem = null; clearLocalPreviewUrl(); mediaInput.value = ''; removeMediaInput.checked = false;
    mediaPreview.innerHTML = ''; mediaPreview.style.display = 'none'; removeMediaRow.style.display = 'none';
    titleInput.value = ''; bodyInput.value = ''; pinnedInput.checked = false; publishedInput.checked = false; publishedInput.disabled = false; setBubbleWidth(88);
    formTitle.textContent = 'הודעה חדשה'; saveBtn.textContent = 'שלח ללקוחות'; cancelEditBtn.style.display = 'none'; formError.textContent = '';
  }
  function startEdit(item) {
    editingId = item.id; editingItem = item; mediaInput.value = ''; removeMediaInput.checked = false; showFormMediaPreview(item);
    titleInput.value = item.title; bodyInput.value = item.body; pinnedInput.checked = item.pinned; publishedInput.checked = item.published; publishedInput.disabled = true; setBubbleWidth(item.bubbleWidthPercent || 88);
    formTitle.textContent = 'עריכת הודעה'; saveBtn.textContent = 'עדכן הודעה'; cancelEditBtn.style.display = ''; formError.textContent = '';
    titleInput.scrollIntoView({behavior:'smooth',block:'center'});
  }
  mediaInput.addEventListener('change', () => {
    clearLocalPreviewUrl(); const file = mediaInput.files && mediaInput.files[0];
    if (!file) { showFormMediaPreview(editingItem); return; }
    removeMediaInput.checked = false; removeMediaRow.style.display = editingItem && editingItem.mediaUrl ? '' : 'none';
    localPreviewUrl = URL.createObjectURL(file); const type = selectedMediaKind(file);
    mediaPreview.innerHTML = `<div class="news-media-selected">נבחר: ${esc(file.name)}</div>` + mediaMarkup(type, localPreviewUrl); mediaPreview.style.display = '';
    saveBtn.textContent = editingId ? 'עדכן עם המדיה' : 'שלח ללקוחות עם המדיה';
  });
  removeMediaInput.addEventListener('change', () => {
    if (removeMediaInput.checked) { mediaInput.value = ''; clearLocalPreviewUrl(); mediaPreview.innerHTML = '<div class="news-media-help">המדיה הקיימת תוסר בשמירה</div>'; mediaPreview.style.display = ''; }
    else showFormMediaPreview(editingItem);
  });
  cancelEditBtn.addEventListener('click', resetForm);
  bubbleWidthInput.addEventListener('input', () => setBubbleWidth(bubbleWidthInput.value));
  bubbleWidthNumber.addEventListener('input', () => {
    const numeric = Number.parseInt(bubbleWidthNumber.value, 10);
    if (Number.isInteger(numeric) && numeric >= 55 && numeric <= 100) {
      bubbleWidthInput.value = String(numeric);
      applyBubblePreviewWidth(numeric);
    }
  });
  bubbleWidthNumber.addEventListener('change', () => setBubbleWidth(bubbleWidthNumber.value));

  function newsCard(item) {
    const badges = [`<span class="news-badge ${item.published ? 'published' : 'draft'}">${item.published ? 'פורסם' : 'טיוטה'}</span>`];
    if (item.pinned) badges.push('<span class="news-badge pinned">★ חשוב</span>');
    const meta = [`נוצר: ${esc(fmtDateTime(item.createdAt))}`]; if (item.publishedAt) meta.push(`פורסם: ${esc(fmtDateTime(item.publishedAt))}`);
    const media = item.mediaUrl ? `<div class="news-card-media">${mediaMarkup(item.mediaType, item.mediaUrl)}</div>` : '';
    return `<div class="news-card${item.pinned ? ' pinned' : ''}"><div class="news-card-header"><div class="news-card-title">${esc(item.title)}</div><div class="news-card-badges">${badges.join('')}</div></div><div class="news-card-body-preview">${esc(item.body)}</div>${media}<div class="news-card-meta">${meta.join(' · ')}</div><div class="news-card-actions"><button data-edit="${esc(item.id)}">ערוך</button>${item.published ? `<button data-unpublish="${esc(item.id)}">הסתר</button>` : `<button data-publish="${esc(item.id)}">פרסם</button>`}<button class="news-delete-btn" data-delete="${esc(item.id)}">מחק</button></div></div>`;
  }
  function renderNews(list) {
    if (!list.length) { listEl.innerHTML = '<div class="empty-state">אין עדיין הודעות — צרו הודעה למעלה</div>'; return; }
    listEl.innerHTML = list.map(newsCard).join('');
    listEl.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => { const item = list.find(i => i.id === btn.dataset.edit); if (item) startEdit(item); }));
    listEl.querySelectorAll('[data-publish]').forEach(btn => btn.addEventListener('click', () => setPublished(btn.dataset.publish, true, btn)));
    listEl.querySelectorAll('[data-unpublish]').forEach(btn => btn.addEventListener('click', () => setPublished(btn.dataset.unpublish, false, btn)));
    listEl.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', () => deleteUpdate(btn.dataset.delete, btn)));
  }
  async function loadNews() {
    try {
      const res = await fetch('/api/customer-updates');
      if (res.status === 401) { requireLogin(); return; }
      if (!res.ok) throw new Error('שגיאה בטעינת ההודעות');
      renderNews(await res.json());
    } catch (e) { listEl.innerHTML = `<div class="empty-state">${esc(e.message || 'שגיאת תקשורת')}</div>`; }
  }
  async function setPublished(id, published, btn) {
    const old = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = 'שומר...'; }
    try {
      const res = await fetch(`/api/customer-updates/${encodeURIComponent(id)}/${published ? 'publish' : 'unpublish'}`, {method:'POST'});
      if (res.status === 401) { requireLogin(); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'הפעולה נכשלה');
      await loadNews();
    } catch (e) { alert(e.message || 'שגיאת תקשורת'); }
    finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = old; } }
  }
  async function deleteUpdate(id, btn) {
    if (!confirm('למחוק את ההודעה הזו לצמיתות?')) return;
    const old = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = 'מוחק...'; }
    try {
      const res = await fetch(`/api/customer-updates/${encodeURIComponent(id)}`, {method:'DELETE'});
      if (res.status === 401) { requireLogin(); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'המחיקה נכשלה');
      if (editingId === id) resetForm();
      await loadNews();
    } catch (e) { alert(e.message || 'שגיאת תקשורת'); }
    finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = old; } }
  }

  saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim(); const body = bodyInput.value.trim();
    if (!title) { formError.textContent = 'יש להזין כותרת'; return; }
    if (!body) { formError.textContent = 'יש להזין תוכן'; return; }
    const file = mediaInput.files && mediaInput.files[0];
    if (file) {
      if (!selectedMediaKind(file)) { formError.textContent = 'יש לבחור תמונה או סרטון נתמכים'; return; }
      if (file.size > 50 * 1024 * 1024) { formError.textContent = 'הקובץ גדול מ-50MB'; return; }
    }
    formError.textContent = ''; saveBtn.disabled = true;
    const form = new FormData(); form.append('title', title); form.append('body', body); form.append('pinned', String(pinnedInput.checked)); form.append('bubbleWidthPercent', String(clampBubbleWidth(bubbleWidthNumber.value)));
    if (!editingId) form.append('published', String(publishedInput.checked));
    if (editingId && removeMediaInput.checked) form.append('removeMedia', 'true');
    if (file) form.append('media', file, file.name);
    try {
      const res = await fetch(editingId ? `/api/customer-updates/${encodeURIComponent(editingId)}` : '/api/customer-updates', {method: editingId ? 'PUT' : 'POST', body: form});
      if (res.status === 401) { requireLogin(); return; }
      const err = await res.json().catch(() => ({}));
      if (!res.ok) { formError.textContent = err.error || 'השמירה נכשלה'; return; }
      resetForm(); await loadNews();
    } catch (_) { formError.textContent = 'שגיאת תקשורת'; }
    finally { saveBtn.disabled = false; }
  });
  document.querySelectorAll('.nav-btn').forEach(btn => { if (btn.dataset.tab === 'news') btn.addEventListener('click', loadNews); });
  refreshBtn?.addEventListener('click', loadNews);
  setBubbleWidth(88);
})();
