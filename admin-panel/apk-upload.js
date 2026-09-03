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
