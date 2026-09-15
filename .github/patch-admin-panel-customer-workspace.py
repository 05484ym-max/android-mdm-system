from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    p.write_text(s.replace(old, new, 1))


# 1) Navigation: Customers first, remove the separate Health tab from navigation.
replace_once(
    'admin-panel/index.html',
    '''    <button class="nav-btn" data-tab="enroll">
      <span class="nav-icon">✚</span>
      <span class="nav-label">רישום מכשיר</span>
    </button>
    <button class="nav-btn" data-tab="catalog">
      <span class="nav-icon">▦</span>
      <span class="nav-label">חנות אפליקציות</span>
    </button>
    <button class="nav-btn active" data-tab="customers">
      <span class="nav-icon">👤</span>
      <span class="nav-label">לקוחות</span>
    </button>
    <button class="nav-btn" data-tab="health">
      <span class="nav-icon">🩺</span>
      <span class="nav-label">בריאות מכשירים</span>
    </button>''',
    '''    <button class="nav-btn active" data-tab="customers">
      <span class="nav-icon">👤</span>
      <span class="nav-label">לקוחות</span>
    </button>
    <button class="nav-btn" data-tab="catalog">
      <span class="nav-icon">▦</span>
      <span class="nav-label">חנות אפליקציות</span>
    </button>
    <button class="nav-btn" data-tab="enroll">
      <span class="nav-icon">✚</span>
      <span class="nav-label">רישום מכשיר</span>
    </button>''',
    'navigation cleanup',
)

# 2) Search belongs only to Customers instead of globally above every tab.
replace_once(
    'admin-panel/index.html',
    '''<div class="quick-search-card">
  <input class="search-input" id="quickCustomerSearch"
         placeholder="חיפוש מהיר — שם לקוח, מספר לקוח או מזהה מכשיר..." autocomplete="off" />
  <div id="quickCustomerResults" class="quick-search-results"></div>
</div>

<div class="tab-content active" data-tab-content="customers">
  <div class="stats">''',
    '''<div class="tab-content active" data-tab-content="customers">
  <div class="quick-search-card">
    <input class="search-input" id="quickCustomerSearch"
           placeholder="חיפוש לקוח — שם, מספר לקוח או מזהה מכשיר..." autocomplete="off" />
    <div id="quickCustomerResults" class="quick-search-results"></div>
  </div>
  <div class="stats">''',
    'customer-only search',
)

# 3) Customer profile: show explicit subscription facts and inline diagnostics.
replace_once(
    'admin-panel/customer-search.js',
    '''    const p = d.policy || {};
    const apps = Array.isArray(p.allowedApps) ? p.allowedApps : [];''',
    '''    const p = d.policy || {};
    const subscription = d.subscription || {};
    const apps = Array.isArray(p.allowedApps) ? p.allowedApps : [];''',
    'subscription data',
)

replace_once(
    'admin-panel/customer-search.js',
    '''        <div class="unified-info-card"><span>מצב מנוי</span><strong class="${esc(status.cls || '')}">${esc(status.text || '—')}</strong></div>
        <div class="unified-info-card"><span>נרשם</span><strong>${esc(fmtDate(d.registeredAt))}</strong></div>''',
    '''        <div class="unified-info-card"><span>מצב מנוי</span><strong class="${esc(status.cls || '')}">${esc(status.text || '—')}</strong></div>
        <div class="unified-info-card"><span>תוקף מנוי</span><strong>${esc(fmtDate(subscription.expiryDate))}</strong></div>
        <div class="unified-info-card"><span>מחיר מנוי</span><strong>${subscription.price != null ? esc(subscription.price) + ' ₪' : '—'}</strong></div>
        <div class="unified-info-card"><span>נרשם</span><strong>${esc(fmtDate(d.registeredAt))}</strong></div>''',
    'subscription cards',
)

replace_once(
    'admin-panel/customer-search.js',
    '''      <div class="unified-profile-actions">
        <button type="button" class="add-app-btn" data-unified-manage="${esc(d.deviceId)}">פתח ניהול מלא</button>
        <button type="button" class="toggle-btn" data-unified-diagnostics="${esc(d.deviceId)}">אבחון מלא</button>
      </div>
    `;
    panel.style.display = 'block';''',
    '''      <div class="unified-profile-section" data-inline-diagnostics>
        <div class="unified-profile-head">
          <h3 style="margin:0">אבחון המכשיר</h3>
          <button type="button" class="toggle-btn" data-inline-diagnostics-refresh>⟳ רענן אבחון</button>
        </div>
        <div data-inline-diagnostics-content><div class="empty-state">טוען אבחון...</div></div>
      </div>

      <div class="unified-profile-actions">
        <button type="button" class="add-app-btn" data-unified-manage="${esc(d.deviceId)}">פתח ניהול ופעולות</button>
      </div>
    `;
    panel.style.display = 'block';
    setCustomerFocus(true);

    const inlineDiagnosticsRoot = panel.querySelector('[data-inline-diagnostics-content]');
    const loadInlineDiagnostics = () => {
      if (!inlineDiagnosticsRoot) return;
      if (typeof window.loadDeviceDiagnosticsInline !== 'function') {
        inlineDiagnosticsRoot.innerHTML = '<div class="empty-state">האבחון אינו זמין כרגע</div>';
        return;
      }
      window.loadDeviceDiagnosticsInline(d.deviceId, inlineDiagnosticsRoot);
    };
    loadInlineDiagnostics();
    panel.querySelector('[data-inline-diagnostics-refresh]')?.addEventListener('click', loadInlineDiagnostics);''',
    'inline diagnostics section',
)

replace_once(
    'admin-panel/customer-search.js',
    '''    panel.querySelector('[data-unified-diagnostics]')?.addEventListener('click', e => {
      const id = e.currentTarget.getAttribute('data-unified-diagnostics');
      if (typeof window.openDeviceDiagnostics === 'function') window.openDeviceDiagnostics(id);
    });
''',
    '',
    'remove duplicate diagnostics button',
)

# 4) Focus the customer workspace after a match; restore list when profile closes/clears.
replace_once(
    'admin-panel/customer-search.js',
    '''  function render(deviceId) {
    const panel = ensurePanel();''',
    '''  function setCustomerFocus(focused) {
    const tab = document.querySelector('.tab-content[data-tab-content="customers"]');
    if (!tab) return;
    Array.from(tab.children).forEach(el => {
      if (el.classList.contains('stats') || el.classList.contains('devices-section')) {
        el.style.display = focused ? 'none' : '';
      }
    });
  }

  function render(deviceId) {
    const panel = ensurePanel();''',
    'customer focus helper',
)

replace_once(
    'admin-panel/customer-search.js',
    '''      panel.style.display = 'none';
      panel.innerHTML = '';
      const input = document.getElementById('quickCustomerSearch');
      if (input) input.value = '';
    });''',
    '''      panel.style.display = 'none';
      panel.innerHTML = '';
      setCustomerFocus(false);
      const input = document.getElementById('quickCustomerSearch');
      if (input) input.value = '';
    });''',
    'restore customer list on close',
)

replace_once(
    'admin-panel/customer-search.js',
    '''        const panel = ensurePanel();
        if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
      }
    });''',
    '''        const panel = ensurePanel();
        if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
        setCustomerFocus(false);
      }
    });''',
    'restore customer list on clear',
)

# 5) Reuse the existing diagnostics engine inline instead of maintaining a second diagnosis implementation.
replace_once(
    'admin-panel/diagnostics.js',
    '''  function renderDiagnostics(data, publicDevice) {
    const h = data.health || {};''',
    '''  function renderDiagnostics(data, publicDevice, targetRoot) {
    const h = data.health || {};''',
    'diagnostics target root signature',
)

replace_once(
    'admin-panel/diagnostics.js',
    '''    const title = document.getElementById('diagnosticsTitle');
    if (title) title.textContent = h.customerName || 'לקוח ללא שם';''',
    '''    const title = document.getElementById('diagnosticsTitle');
    if (!targetRoot && title) title.textContent = h.customerName || 'לקוח ללא שם';''',
    'diagnostics title isolation',
)

replace_once(
    'admin-panel/diagnostics.js',
    '''    const root = document.getElementById('diagnosticsContent');
    root.innerHTML = header + `<div class="diag-section"><h3>מה דורש טיפול</h3>${faultsHtml}</div>` + dnsSectionHtml(data.deviceId, h, data.dnsProviderFilters);
    bindActions(root);
  }

  async function openDeviceDiagnostics(deviceId) {''',
    '''    const root = targetRoot || document.getElementById('diagnosticsContent');
    if (!root) return;
    root.innerHTML = header + `<div class="diag-section"><h3>מה דורש טיפול</h3>${faultsHtml}</div>` + dnsSectionHtml(data.deviceId, h, data.dnsProviderFilters);
    bindActions(root);
  }

  async function loadDeviceDiagnosticsInline(deviceId, root) {
    if (!root) return;
    root.innerHTML = '<div class="empty-state">בודק את המכשיר...</div>';
    try {
      const [diagRes, devicesRes] = await Promise.all([
        fetch(`/api/health/devices/${encodeURIComponent(deviceId)}/diagnostics`),
        fetch('/api/devices'),
      ]);
      if (diagRes.status === 401 || devicesRes.status === 401) { loginRequired(); return; }
      if (!diagRes.ok) throw new Error('לא ניתן לטעון את האבחון');
      const data = await diagRes.json();
      let publicDevice = null;
      if (devicesRes.ok) {
        const devices = await devicesRes.json();
        publicDevice = Array.isArray(devices) ? devices.find(d => d.deviceId === deviceId) || null : null;
      }
      renderDiagnostics(data, publicDevice, root);
    } catch (e) {
      root.innerHTML = `<div class="empty-state">${esc(e && e.message ? e.message : 'שגיאת תקשורת')}</div>`;
    }
  }

  async function openDeviceDiagnostics(deviceId) {''',
    'inline diagnostics loader',
)

replace_once(
    'admin-panel/diagnostics.js',
    '''  document.getElementById('diagnosticsBackBtn')?.addEventListener('click', closeDiagnostics);
  window.openDeviceDiagnostics = openDeviceDiagnostics;''',
    '''  document.getElementById('diagnosticsBackBtn')?.addEventListener('click', closeDiagnostics);
  window.openDeviceDiagnostics = openDeviceDiagnostics;
  window.loadDeviceDiagnosticsInline = loadDeviceDiagnosticsInline;''',
    'export inline diagnostics',
)

# 6) Extend the existing functional audit with workspace invariants.
replace_once(
    'backend/test-admin-panel-functional-audit.js',
    '''const index = read('backend/index.js');
const protectionRoutes = read('backend/protectionAdminRoutes.js');
const customerSearch = read('admin-panel/customer-search.js');''',
    '''const index = read('backend/index.js');
const panelHtml = read('admin-panel/index.html');
const protectionRoutes = read('backend/protectionAdminRoutes.js');
const customerSearch = read('admin-panel/customer-search.js');''',
    'audit panel html',
)

replace_once(
    'backend/test-admin-panel-functional-audit.js',
    '''includes(customerSearch, 'data-wa-channels-only', 'channels-only WhatsApp preset');

excludes(healthUi, 'על גרסה ישנה', 'unimplemented version diagnostic');''',
    '''includes(customerSearch, 'data-wa-channels-only', 'channels-only WhatsApp preset');
includes(customerSearch, 'data-inline-diagnostics-content', 'inline customer diagnostics');
includes(customerSearch, 'setCustomerFocus(true)', 'focused customer workspace');
includes(diagnosticsUi, 'loadDeviceDiagnosticsInline', 'reusable inline diagnostics loader');
includes(panelHtml, 'data-tab-content="customers"', 'customers workspace');
includes(panelHtml, 'חיפוש לקוח — שם, מספר לקוח או מזהה מכשיר', 'customer-only search label');
excludes(panelHtml, 'data-tab="health"', 'separate health navigation');

const customersTabAt = panelHtml.indexOf('data-tab-content="customers"');
const quickSearchAt = panelHtml.indexOf('id="quickCustomerSearch"');
assert(customersTabAt >= 0 && quickSearchAt > customersTabAt, 'customer search must live inside the customers tab');

excludes(healthUi, 'על גרסה ישנה', 'unimplemented version diagnostic');''',
    'audit customer workspace',
)
