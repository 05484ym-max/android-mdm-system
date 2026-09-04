(function () {
  const modal = document.getElementById('apkUploadModal');
  const openBtn = document.getElementById('openApkUploadBtn');
  const cancelBtn = document.getElementById('apkUploadCancelBtn');
  const submitBtn = document.getElementById('apkUploadSubmitBtn');
  const fileInput = document.getElementById('apkFileInput');
  const nameInput = document.getElementById('apkAppName');
  const packageInput = document.getElementById('apkPackageName');
  const categorySelect = document.getElementById('apkCategorySelect');
  const statusEl = document.getElementById('apkUploadStatus');

  /*
   * Older APK catalog rows can contain an absolute icon URL that was saved
   * before reverse-proxy HTTPS handling was fixed (for example http://... on
   * Render). The catalog's inline onerror handler immediately replaces a
   * failed icon with the app's first letter, so repair these first-party icon
   * URLs before that fallback runs. This also makes the panel resilient if the
   * public host changes later: /api/apps/icon/:assetId is always served by the
   * same backend that rendered the panel.
   */
  document.addEventListener('error', event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('catalog-icon')) return;
    if (img.dataset.sameOriginIconRetry === '1') return;

    let parsed;
    try {
      parsed = new URL(img.currentSrc || img.src, window.location.href);
    } catch {
      return;
    }

    if (!/^\/api\/apps\/icon\/\d+$/.test(parsed.pathname)) return;

    const sameOriginUrl = window.location.origin + parsed.pathname + parsed.search;
    if ((img.currentSrc || img.src) === sameOriginUrl) return;

    // Capture-phase listener runs before the existing inline onerror fallback.
    // Stop this first failure from replacing the <img>; retry once via the
    // current HTTPS origin. If the retry itself fails, the normal fallback is
    // allowed to run and display the first letter.
    event.stopImmediatePropagation();
    img.dataset.sameOriginIconRetry = '1';
    img.src = sameOriginUrl;
  }, true);

  if (!modal || !openBtn || !cancelBtn || !submitBtn || !fileInput || !nameInput ||
      !packageInput || !categorySelect || !statusEl) return;

  let uploadInFlight = false;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.classList.remove('error', 'success');
    if (kind) statusEl.classList.add(kind);
  }

  async function populateCategories() {
    categorySelect.innerHTML = '<option value="">טוען קטגוריות...</option>';
    try {
      const res = await fetch('/api/apps/categories');
      const categories = await res.json().catch(() => []);
      if (!res.ok || !Array.isArray(categories)) throw new Error('bad response');
      categorySelect.innerHTML = categories
        .map(c => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.label)}</option>`)
        .join('');
    } catch (e) {
      categorySelect.innerHTML = '<option value="">אחר</option>';
    }
  }

  function resetForm() {
    fileInput.value = '';
    nameInput.value = '';
    packageInput.value = '';
    setStatus('');
    submitBtn.disabled = false;
    uploadInFlight = false;
  }

  openBtn.addEventListener('click', () => {
    resetForm();
    populateCategories();
    modal.style.display = 'flex';
  });

  cancelBtn.addEventListener('click', () => {
    if (uploadInFlight) return;
    modal.style.display = 'none';
  });

  submitBtn.addEventListener('click', () => {
    if (uploadInFlight) return;

    const file = fileInput.files[0];
    const name = nameInput.value.trim();
    const category = categorySelect.value;

    if (!file) {
      setStatus('יש לבחור קובץ APK', 'error');
      return;
    }
    if (!/\.apk$/i.test(file.name)) {
      setStatus('יש לבחור קובץ עם סיומת ‎.apk', 'error');
      return;
    }
    if (!name) {
      setStatus('יש להזין שם אפליקציה', 'error');
      return;
    }
    const formData = new FormData();
    formData.append('apk', file);
    formData.append('name', name);
    if (category) formData.append('category', category);

    uploadInFlight = true;
    submitBtn.disabled = true;
    setStatus('מעלה... 0%');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/apps/upload-apk');

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) {
        setStatus(`מעלה... ${Math.round((e.loaded / e.total) * 100)}%`);
      }
    });

    xhr.onload = () => {
      uploadInFlight = false;
      submitBtn.disabled = false;
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON error body */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        packageInput.value = body.packageName || '';
        setStatus(`הועלה בהצלחה: ${body.name || name}${body.packageName ? ` (${body.packageName})` : ''}`, 'success');
        if (typeof loadAppsCatalog === 'function') loadAppsCatalog();
        setTimeout(() => { modal.style.display = 'none'; }, 1200);
      } else {
        setStatus(body.error || 'העלאת ה-APK נכשלה', 'error');
      }
    };

    xhr.onerror = () => {
      uploadInFlight = false;
      submitBtn.disabled = false;
      setStatus('שגיאת תקשורת בהעלאת ה-APK', 'error');
    };

    xhr.send(formData);
  });
})();
