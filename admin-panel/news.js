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

  // Attachments (images/videos/files/links) - only ever shown while editing
  // an already-saved update (see startEdit/resetForm below), since an
  // attachment needs a real update id to attach to.
  const attachmentsSection = document.getElementById('newsAttachmentsSection');
  const attachmentsList = document.getElementById('newsAttachmentsList');
  const attachFileInput = document.getElementById('newsAttachFileInput');
  const attachFileBtn = document.getElementById('newsAttachFileBtn');
  const attachFileError = document.getElementById('newsAttachFileError');
  const attachLinkUrlInput = document.getElementById('newsAttachLinkUrlInput');
  const attachLinkLabelInput = document.getElementById('newsAttachLinkLabelInput');
  const attachLinkBtn = document.getElementById('newsAttachLinkBtn');
  const attachLinkError = document.getElementById('newsAttachLinkError');

  if (!listEl || !titleInput || !bodyInput || !pinnedInput || !publishedInput ||
      !saveBtn || !cancelEditBtn || !formTitle || !formError ||
      !attachmentsSection || !attachmentsList || !attachFileInput || !attachFileBtn ||
      !attachFileError || !attachLinkUrlInput || !attachLinkLabelInput || !attachLinkBtn ||
      !attachLinkError) {
    return;
  }

  let editingId = null;
  let currentNewsList = [];

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
    titleInput.value = '';
    bodyInput.value = '';
    pinnedInput.checked = false;
    publishedInput.checked = false;
    formTitle.textContent = 'הודעה חדשה';
    saveBtn.textContent = 'שמור';
    cancelEditBtn.style.display = 'none';
    formError.textContent = '';
    attachmentsSection.style.display = 'none';
    attachmentsList.innerHTML = '';
    attachFileInput.value = '';
    attachFileError.textContent = '';
    attachLinkUrlInput.value = '';
    attachLinkLabelInput.value = '';
    attachLinkError.textContent = '';
  }

  function startEdit(item) {
    editingId = item.id;
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
    attachFileError.textContent = '';
    attachLinkError.textContent = '';
    renderAttachmentsSection(item.attachments || []);
    titleInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function attachmentIcon(kind) {
    if (kind === 'VIDEO') return '🎬';
    if (kind === 'LINK') return '🔗';
    return '📄';
  }

  function fmtBytes(n) {
    if (n === null || n === undefined) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function attachmentItemHtml(att) {
    const thumb = att.kind === 'IMAGE'
      ? `<img class="news-attachment-thumb" src="${escapeHtml(att.url)}" alt="" />`
      : `<div class="news-attachment-icon">${attachmentIcon(att.kind)}</div>`;
    const name = att.kind === 'LINK' ? (att.label || att.url) : (att.filename || att.url);
    const meta = att.kind === 'LINK'
      ? att.url
      : [att.mimeType, fmtBytes(att.sizeBytes)].filter(Boolean).join(' · ');
    return `
      <div class="news-attachment-item">
        ${thumb}
        <div class="news-attachment-info">
          <div class="news-attachment-name">${escapeHtml(name)}</div>
          <div class="news-attachment-meta">${escapeHtml(meta)}</div>
        </div>
        <button class="news-attachment-remove-btn" data-remove-attachment="${escapeHtml(att.id)}">הסר</button>
      </div>`;
  }

  function renderAttachmentsSection(list) {
    attachmentsSection.style.display = '';
    attachmentsList.innerHTML = list.length
      ? list.map(attachmentItemHtml).join('')
      : '<div class="news-attachments-empty">אין קבצים מצורפים עדיין</div>';
    attachmentsList.querySelectorAll('[data-remove-attachment]').forEach(btn => {
      btn.addEventListener('click', () => removeAttachment(btn.getAttribute('data-remove-attachment')));
    });
  }

  async function removeAttachment(attachmentId) {
    if (!editingId) return;
    if (!confirm('להסיר את הקובץ המצורף?')) return;
    const res = await fetch(
      `/api/customer-updates/${encodeURIComponent(editingId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'ההסרה נכשלה');
      return;
    }
    await loadNews();
  }

  attachFileBtn.addEventListener('click', async () => {
    if (!editingId) return;
    const file = attachFileInput.files && attachFileInput.files[0];
    if (!file) {
      attachFileError.textContent = 'יש לבחור קובץ';
      return;
    }
    attachFileError.textContent = '';
    attachFileBtn.disabled = true;
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/customer-updates/${encodeURIComponent(editingId)}/attachments`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        attachFileError.textContent = body.error || 'העלאת הקובץ נכשלה';
        return;
      }
      attachFileInput.value = '';
      await loadNews();
    } catch (e) {
      attachFileError.textContent = 'שגיאת תקשורת';
    } finally {
      attachFileBtn.disabled = false;
    }
  });

  attachLinkBtn.addEventListener('click', async () => {
    if (!editingId) return;
    const url = attachLinkUrlInput.value.trim();
    const label = attachLinkLabelInput.value.trim();
    if (!url) {
      attachLinkError.textContent = 'יש להזין קישור';
      return;
    }
    attachLinkError.textContent = '';
    attachLinkBtn.disabled = true;
    try {
      const res = await fetch(`/api/customer-updates/${encodeURIComponent(editingId)}/attachments/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, label: label || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        attachLinkError.textContent = body.error || 'הוספת הקישור נכשלה';
        return;
      }
      attachLinkUrlInput.value = '';
      attachLinkLabelInput.value = '';
      await loadNews();
    } catch (e) {
      attachLinkError.textContent = 'שגיאת תקשורת';
    } finally {
      attachLinkBtn.disabled = false;
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

    return `
      <div class="news-card${item.pinned ? ' pinned' : ''}">
        <div class="news-card-header">
          <div class="news-card-title">${escapeHtml(item.title)}</div>
          <div class="news-card-badges">${badges.join('')}</div>
        </div>
        <div class="news-card-body-preview">${escapeHtml(item.body)}</div>
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
    currentNewsList = await res.json();
    renderNews(currentNewsList);
    // Keeps the open edit form's attachments section in sync after an
    // upload/link-add/remove (all of which call loadNews() rather than
    // touching the DOM directly) - the title/body/pinned fields are
    // untouched here, only the attachments list underneath them.
    if (editingId) {
      const current = currentNewsList.find(item => item.id === editingId);
      renderAttachmentsSection(current ? (current.attachments || []) : []);
    }
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
    formError.textContent = '';
    saveBtn.disabled = true;

    try {
      let res;
      if (editingId) {
        res = await fetch(`/api/customer-updates/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, body, pinned: pinnedInput.checked }),
        });
      } else {
        res = await fetch('/api/customer-updates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title, body,
            pinned: pinnedInput.checked,
            published: publishedInput.checked,
          }),
        });
      }
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
