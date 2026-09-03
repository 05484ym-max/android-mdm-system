// "חדשות ועדכונים" tab - entirely separate from the other tab scripts,
// same IIFE-per-feature pattern as alerts.js/app-import.js/apk-upload.js.
// Every piece of admin-authored text (title/body) is rendered through
// escapeHtml below before ever touching innerHTML - the server stores and
// returns plain text as-is (see backend/index.js's customer-updates
// routes), so this is the one place that actually has to guard against it
// being interpreted as markup.
(function () {
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

  if (!listEl || !titleInput || !bodyInput || !pinnedInput || !publishedInput ||
      !saveBtn || !cancelEditBtn || !formTitle || !formError || !mediaInput ||
      !mediaPreview || !removeMediaRow || !removeMediaInput) {
    return;
  }

  let editingId = null;
  let editingItem = null;
  let localPreviewUrl = null;

  function clearLocalPreviewUrl() {
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    localPreviewUrl = null;
  }

  function mediaMarkup(mediaType, mediaUrl, controls = true) {
    if (!mediaUrl) return '';
    const safeUrl = escapeHtml(mediaUrl);
    if (mediaType === 'IMAGE') {
      return `<img src="${safeUrl}" alt="מדיה מצורפת" loading="lazy" />`;
    }
    if (mediaType === 'VIDEO') {
      return `<video src="${safeUrl}" ${controls ? 'controls' : ''} preload="metadata" playsinline></video>`;
    }
    return '';
  }

  function showFormMediaPreview(item) {
    clearLocalPreviewUrl();
    mediaPreview.innerHTML = '';
    if (item && item.mediaUrl) {
      mediaPreview.innerHTML = mediaMarkup(item.mediaType, item.mediaUrl);
      mediaPreview.style.display = '';
      removeMediaRow.style.display = '';
    } else {
      mediaPreview.style.display = 'none';
      removeMediaRow.style.display = 'none';
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  }

  function resetForm() {
    editingId = null;
    editingItem = null;
    clearLocalPreviewUrl();
    mediaInput.value = '';
    removeMediaInput.checked = false;
    mediaPreview.innerHTML = '';
    mediaPreview.style.display = 'none';
    removeMediaRow.style.display = 'none';
    titleInput.value = '';
    bodyInput.value = '';
    pinnedInput.checked = false;
    publishedInput.checked = false;
    formTitle.textContent = 'הודעה חדשה';
    saveBtn.textContent = 'שמור';
    cancelEditBtn.style.display = 'none';
    formError.textContent = '';
  }

  function startEdit(item) {
    editingId = item.id;
    editingItem = item;
    mediaInput.value = '';
    removeMediaInput.checked = false;
    showFormMediaPreview(item);
    titleInput.value = item.title;
    bodyInput.value = item.body;
    pinnedInput.checked = item.pinned;
    // published is not editable through this form once a row exists - the
    // publish/unpublish buttons on the card are the one write path for
    // that (see backend/index.js's comment on why they're kept separate).
    publishedInput.checked = item.published;
    publishedInput.disabled = true;
    formTitle.textContent = 'עריכת הודעה';
    saveBtn.textContent = 'עדכן';
    cancelEditBtn.style.display = '';
    formError.textContent = '';
    titleInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  mediaInput.addEventListener('change', () => {
    clearLocalPreviewUrl();
    const file = mediaInput.files && mediaInput.files[0];
    if (!file) {
      showFormMediaPreview(editingItem);
      return;
    }
    removeMediaInput.checked = false;
    removeMediaRow.style.display = editingItem && editingItem.mediaUrl ? '' : 'none';
    localPreviewUrl = URL.createObjectURL(file);
    const type = file.type.startsWith('image/') ? 'IMAGE' : 'VIDEO';
    mediaPreview.innerHTML = mediaMarkup(type, localPreviewUrl);
    mediaPreview.style.display = '';
  });

  removeMediaInput.addEventListener('change', () => {
    if (removeMediaInput.checked) {
      mediaInput.value = '';
      clearLocalPreviewUrl();
      mediaPreview.innerHTML = '<div class="news-media-help">המדיה הקיימת תוסר בשמירה</div>';
      mediaPreview.style.display = '';
    } else {
      showFormMediaPreview(editingItem);
    }
  });

  cancelEditBtn.addEventListener('click', () => {
    publishedInput.disabled = false;
    resetForm();
  });

  function newsCard(item) {
    const badges = [
      `<span class="news-badge ${item.published ? 'published' : 'draft'}">${item.published ? 'פורסם' : 'טיוטה'}</span>`,
    ];
    if (item.pinned) badges.push('<span class="news-badge pinned">★ חשוב</span>');

    const metaParts = [`נוצר: ${escapeHtml(fmtDateTime(item.createdAt))}`];
    if (item.publishedAt) metaParts.push(`פורסם: ${escapeHtml(fmtDateTime(item.publishedAt))}`);

    const media = item.mediaUrl
      ? `<div class="news-card-media">${mediaMarkup(item.mediaType, item.mediaUrl)}</div>`
      : '';

    return `
      <div class="news-card${item.pinned ? ' pinned' : ''}">
        <div class="news-card-header">
          <div class="news-card-title">${escapeHtml(item.title)}</div>
          <div class="news-card-badges">${badges.join('')}</div>
        </div>
        <div class="news-card-body-preview">${escapeHtml(item.body)}</div>
        ${media}
        <div class="news-card-meta">${metaParts.join(' · ')}</div>
        <div class="news-card-actions">
          <button data-edit="${escapeHtml(item.id)}">ערוך</button>
          ${item.published
            ? `<button data-unpublish="${escapeHtml(item.id)}">הסתר</button>`
            : `<button data-publish="${escapeHtml(item.id)}">פרסם</button>`}
          <button class="news-delete-btn" data-delete="${escapeHtml(item.id)}">מחק</button>
        </div>
      </div>`;
  }

  function renderNews(list) {
    if (!list.length) {
      listEl.innerHTML = '<div class="empty-state">אין עדיין הודעות — צרו הודעה למעלה</div>';
      return;
    }
    listEl.innerHTML = list.map(newsCard).join('');

    listEl.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = list.find(i => i.id === btn.getAttribute('data-edit'));
        if (item) startEdit(item);
      });
    });
    listEl.querySelectorAll('[data-publish]').forEach(btn => {
      btn.addEventListener('click', () => setPublished(btn.getAttribute('data-publish'), true));
    });
    listEl.querySelectorAll('[data-unpublish]').forEach(btn => {
      btn.addEventListener('click', () => setPublished(btn.getAttribute('data-unpublish'), false));
    });
    listEl.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteUpdate(btn.getAttribute('data-delete')));
    });
  }

  async function loadNews() {
    let res;
    try {
      res = await fetch('/api/customer-updates');
    } catch (e) {
      listEl.innerHTML = '<div class="empty-state">שגיאת תקשורת</div>';
      return;
    }
    if (res.status === 401) {
      document.getElementById('loginScreen').style.display = 'flex';
      return;
    }
    if (!res.ok) {
      listEl.innerHTML = '<div class="empty-state">שגיאה בטעינת ההודעות</div>';
      return;
    }
    renderNews(await res.json());
  }

  async function setPublished(id, published) {
    const res = await fetch(`/api/customer-updates/${encodeURIComponent(id)}/${published ? 'publish' : 'unpublish'}`, {
      method: 'POST',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'הפעולה נכשלה');
      return;
    }
    loadNews();
  }

  async function deleteUpdate(id) {
    if (!confirm('למחוק את ההודעה הזו לצמיתות?')) return;
    const res = await fetch(`/api/customer-updates/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'המחיקה נכשלה');
      return;
    }
    if (editingId === id) {
      publishedInput.disabled = false;
      resetForm();
    }
    loadNews();
  }

  saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();
    if (!title) {
      formError.textContent = 'יש להזין כותרת';
      return;
    }
    if (!body) {
      formError.textContent = 'יש להזין תוכן';
      return;
    }

    const file = mediaInput.files && mediaInput.files[0];
    if (file) {
      const image = file.type.startsWith('image/');
      const video = file.type.startsWith('video/');
      if (!image && !video) {
        formError.textContent = 'יש לבחור תמונה או סרטון נתמכים';
        return;
      }
      const limit = image ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
      if (file.size > limit) {
        formError.textContent = image ? 'התמונה גדולה מ-10MB' : 'הסרטון גדול מ-50MB';
        return;
      }
    }

    formError.textContent = '';
    saveBtn.disabled = true;
    const form = new FormData();
    form.append('title', title);
    form.append('body', body);
    form.append('pinned', String(pinnedInput.checked));
    if (!editingId) form.append('published', String(publishedInput.checked));
    if (editingId && removeMediaInput.checked) form.append('removeMedia', 'true');
    if (file) form.append('media', file, file.name);

    try {
      const res = await fetch(
        editingId ? `/api/customer-updates/${encodeURIComponent(editingId)}` : '/api/customer-updates',
        { method: editingId ? 'PUT' : 'POST', body: form },
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        formError.textContent = errBody.error || 'השמירה נכשלה';
        return;
      }
      publishedInput.disabled = false;
      resetForm();
      loadNews();
    } catch (e) {
      formError.textContent = 'שגיאת תקשורת';
    } finally {
      saveBtn.disabled = false;
    }
  });
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === 'news') {
      btn.addEventListener('click', loadNews);
    }
  });

  if (refreshBtn) refreshBtn.addEventListener('click', loadNews);
})();
