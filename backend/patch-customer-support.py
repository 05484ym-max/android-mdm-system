from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'marker not found in {path}: {old[:120]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'marker not unique in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# ---------- backend/db.js ----------
DB = 'backend/db.js'
schema_marker = "-- Automatic browser-domain classification cache. Decisions are server-side\n"
support_schema = r'''-- Customer support tickets. A ticket belongs to exactly one enrolled device,
-- so the device-facing endpoints can only ever read/write their own rows.
CREATE TABLE IF NOT EXISTS support_tickets (
  id          UUID PRIMARY KEY,
  device_id   TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  subject     TEXT NOT NULL,
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'OPEN'
              CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
  admin_reply TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS support_tickets_device_idx
  ON support_tickets (device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_open_idx
  ON support_tickets (created_at DESC) WHERE status <> 'RESOLVED';

'''
replace_once(DB, schema_marker, support_schema + schema_marker)

functions_marker = "// ---------- filtered browser automatic domain classification ----------\n"
support_functions = r'''// ---------- customer support tickets ----------

function mapSupportTicketRow(row) {
  return {
    id: row.id,
    deviceId: row.device_id,
    customerName: row.customer_name || null,
    customerNumber: row.customer_number || null,
    subject: row.subject,
    message: row.message,
    status: row.status,
    adminReply: row.admin_reply || null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
  };
}

async function createSupportTicket(deviceId, id, subject, message) {
  const { rows } = await pool.query(
    `INSERT INTO support_tickets (id, device_id, subject, message)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [id, deviceId, subject, message],
  );
  return mapSupportTicketRow(rows[0]);
}

async function listSupportTicketsForDevice(deviceId) {
  const { rows } = await pool.query(
    `SELECT * FROM support_tickets
      WHERE device_id = $1
      ORDER BY created_at DESC
      LIMIT 100`,
    [deviceId],
  );
  return rows.map(mapSupportTicketRow);
}

async function listSupportTicketsForAdmin() {
  const { rows } = await pool.query(
    `SELECT t.*, d.customer_name, d.customer_number
       FROM support_tickets t
       JOIN devices d ON d.device_id = t.device_id
      ORDER BY CASE t.status
                 WHEN 'OPEN' THEN 0
                 WHEN 'IN_PROGRESS' THEN 1
                 ELSE 2
               END,
               t.updated_at DESC`,
  );
  return rows.map(mapSupportTicketRow);
}

async function updateSupportTicket(id, status, adminReply) {
  const { rows } = await pool.query(
    `UPDATE support_tickets
        SET status = $2,
            admin_reply = $3,
            updated_at = now(),
            resolved_at = CASE
              WHEN $2 = 'RESOLVED' AND status <> 'RESOLVED' THEN now()
              WHEN $2 <> 'RESOLVED' THEN NULL
              ELSE resolved_at
            END
      WHERE id = $1
      RETURNING *`,
    [id, status, adminReply || null],
  );
  return rows[0] ? mapSupportTicketRow(rows[0]) : null;
}


'''
replace_once(DB, functions_marker, support_functions + functions_marker)
replace_once(
    DB,
    "  listPublishedCustomerUpdatesForDevice,\n",
    "  listPublishedCustomerUpdatesForDevice,\n  createSupportTicket,\n  listSupportTicketsForDevice,\n  listSupportTicketsForAdmin,\n  updateSupportTicket,\n",
)

# ---------- backend/index.js ----------
IDX = 'backend/index.js'
replace_once(
    IDX,
    "const UPDATE_LIST_LIMIT_FOR_DEVICE = 50;\n",
    "const UPDATE_LIST_LIMIT_FOR_DEVICE = 50;\nconst SUPPORT_SUBJECT_MAX_LENGTH = 120;\nconst SUPPORT_MESSAGE_MAX_LENGTH = 5000;\nconst SUPPORT_REPLY_MAX_LENGTH = 5000;\n",
)

routes_marker = "/** One round trip per device: report status, take policy, collect commands. */\n"
support_routes = r'''// ---------- customer support tickets ----------

app.post('/api/devices/:deviceId/support-tickets', requireDevice, wrap(async (req, res) => {
  const subject = typeof req.body.subject === 'string' ? req.body.subject.trim() : '';
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (!subject || subject.length > SUPPORT_SUBJECT_MAX_LENGTH) {
    return res.status(400).json({ error: `subject must be 1-${SUPPORT_SUBJECT_MAX_LENGTH} characters` });
  }
  if (!message || message.length > SUPPORT_MESSAGE_MAX_LENGTH) {
    return res.status(400).json({ error: `message must be 1-${SUPPORT_MESSAGE_MAX_LENGTH} characters` });
  }
  const ticket = await db.createSupportTicket(
    req.params.deviceId,
    crypto.randomUUID(),
    subject,
    message,
  );
  res.status(201).json(ticket);
}));

app.get('/api/devices/:deviceId/support-tickets', requireDevice, wrap(async (req, res) => {
  res.json(await db.listSupportTicketsForDevice(req.params.deviceId));
}));

app.get('/api/support-tickets', requireAdmin, wrap(async (_req, res) => {
  res.json(await db.listSupportTicketsForAdmin());
}));

app.patch('/api/support-tickets/:ticketId', requireAdmin, wrap(async (req, res) => {
  if (!UUID_REGEX.test(req.params.ticketId)) {
    return res.status(400).json({ error: 'invalid ticket id' });
  }
  const status = typeof req.body.status === 'string' ? req.body.status.toUpperCase() : '';
  if (!['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(status)) {
    return res.status(400).json({ error: 'invalid support status' });
  }
  const adminReply = typeof req.body.adminReply === 'string' ? req.body.adminReply.trim() : '';
  if (adminReply.length > SUPPORT_REPLY_MAX_LENGTH) {
    return res.status(400).json({ error: `adminReply must be at most ${SUPPORT_REPLY_MAX_LENGTH} characters` });
  }
  const ticket = await db.updateSupportTicket(req.params.ticketId, status, adminReply);
  if (!ticket) return res.status(404).json({ error: 'support ticket not found' });
  res.json(ticket);
}));

'''
replace_once(IDX, routes_marker, support_routes + routes_marker)

# ---------- Android ApiClient ----------
API = 'dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt'
replace_once(
    API,
    "class ApiException(message: String) : Exception(message)\n",
    r'''data class SupportTicket(
    val id: String,
    val subject: String,
    val message: String,
    val status: String,
    val adminReply: String?,
    val createdAt: String,
    val updatedAt: String,
)

class ApiException(message: String) : Exception(message)
''',
)
replace_once(
    API,
    "    private fun segment(value: String): String =\n",
    r'''    fun createSupportTicket(deviceId: String, subject: String, message: String): SupportTicket {
        val body = request(
            "POST",
            "/api/devices/${segment(deviceId)}/support-tickets",
            JSONObject().put("subject", subject).put("message", message),
        )
        return parseSupportTicket(JSONObject(body))
    }

    fun fetchSupportTickets(deviceId: String): List<SupportTicket> {
        val body = request("GET", "/api/devices/${segment(deviceId)}/support-tickets", null)
        val array = JSONArray(body)
        return (0 until array.length()).map { parseSupportTicket(array.getJSONObject(it)) }
    }

    private fun parseSupportTicket(item: JSONObject): SupportTicket = SupportTicket(
        id = item.getString("id"),
        subject = item.getString("subject"),
        message = item.getString("message"),
        status = item.optString("status", "OPEN"),
        adminReply = if (item.isNull("adminReply")) null else item.optString("adminReply", null),
        createdAt = item.getString("createdAt"),
        updatedAt = item.getString("updatedAt"),
    )

    private fun segment(value: String): String =
''',
)

# ---------- Android CustomerActivity ----------
ACT = 'dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt'
replace_once(
    ACT,
    "    private lateinit var newsNavItem: NavItem\n",
    "    private lateinit var newsNavItem: NavItem\n    private lateinit var supportNavItem: NavItem\n",
)
replace_once(
    ACT,
    '        newsNavItem = navButton("📰", "חדשות ועדכונים") { showNews() }\n        adminNavItem = navButton("🔒", "כניסת מנהל") { showAdminLogin() }\n',
    '        newsNavItem = navButton("📰", "חדשות ועדכונים") { showNews() }\n        supportNavItem = navButton("💬", "תמיכה") { showSupport() }\n        adminNavItem = navButton("🔒", "כניסת מנהל") { showAdminLogin() }\n',
)
replace_once(
    ACT,
    '''        row.addView(\n            newsNavItem.container,\n            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)\n        )\n        row.addView(\n            adminNavItem.container,\n''',
    '''        row.addView(\n            newsNavItem.container,\n            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)\n        )\n        row.addView(\n            supportNavItem.container,\n            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)\n        )\n        row.addView(\n            adminNavItem.container,\n''',
)
replace_once(
    ACT,
    "        for (item in listOf(personalNavItem, storeNavItem, newsNavItem, adminNavItem)) {\n",
    "        for (item in listOf(personalNavItem, storeNavItem, newsNavItem, supportNavItem, adminNavItem)) {\n",
)
show_store_marker = "    /** Shows the actual app grid directly in this tab - no separate page to\n"
support_activity = r'''    private fun showSupport() {
        isPersonalAreaActive = false
        isNewsActive = false
        headerLabelView.text = "תמיכה"
        setActiveNav(supportNavItem)
        contentArea.removeAllViews()

        contentArea.addView(TextView(this).apply {
            text = "צריכים עזרה? שלחו פנייה והיא תגיע ישירות לצוות התמיכה."
            textSize = 14f
            setTextColor(Color.parseColor(MUTED))
            gravity = Gravity.RIGHT
            setPadding(dp(4), dp(8), dp(4), dp(14))
        })

        val form = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = flatRounded(CARD, dp(18).toFloat())
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        val subject = EditText(this).apply {
            hint = "נושא הפנייה"
            textSize = 14f
            setTextColor(Color.parseColor(TEXT))
            setHintTextColor(Color.parseColor(MUTED))
            setSingleLine(true)
            gravity = Gravity.RIGHT
            background = flatRounded(BG, dp(12).toFloat())
            setPadding(dp(14), dp(11), dp(14), dp(11))
        }
        val message = EditText(this).apply {
            hint = "כתבו כאן במה אפשר לעזור..."
            textSize = 14f
            setTextColor(Color.parseColor(TEXT))
            setHintTextColor(Color.parseColor(MUTED))
            gravity = Gravity.TOP or Gravity.RIGHT
            minLines = 5
            maxLines = 10
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            background = flatRounded(BG, dp(12).toFloat())
            setPadding(dp(14), dp(11), dp(14), dp(11))
        }
        val send = Button(this).apply {
            text = "שליחת פנייה"
            textSize = 14f
            typeface = heavyFont
            setTextColor(Color.WHITE)
            background = flatRounded(ACCENT, dp(12).toFloat())
            isAllCaps = false
        }
        form.addView(subject, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(10) })
        form.addView(message, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(12) })
        form.addView(send, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)))
        contentArea.addView(form, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(18) })

        val historyTitle = TextView(this).apply {
            text = "הפניות שלי"
            textSize = 17f
            typeface = heavyFont
            setTextColor(Color.parseColor(TEXT))
            gravity = Gravity.RIGHT
            setPadding(dp(4), dp(6), dp(4), dp(10))
        }
        val history = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        contentArea.addView(historyTitle)
        contentArea.addView(history)

        fun loadTickets() {
            history.removeAllViews()
            history.addView(TextView(this).apply {
                text = "טוען פניות..."
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.CENTER
                setPadding(0, dp(24), 0, dp(24))
            })
            val deviceId = Config.deviceId(this)
            val serverUrl = Config.serverUrl(this)
            val token = Config.deviceToken(this)
            Thread {
                try {
                    val tickets = ApiClient(serverUrl, token).fetchSupportTickets(deviceId)
                    runOnUiThread { renderSupportTickets(history, tickets) }
                } catch (_: Exception) {
                    runOnUiThread {
                        history.removeAllViews()
                        history.addView(TextView(this).apply {
                            text = "לא ניתן לטעון כרגע את הפניות. נסו שוב מאוחר יותר."
                            setTextColor(Color.parseColor(MUTED))
                            gravity = Gravity.CENTER
                            setPadding(0, dp(24), 0, dp(24))
                        })
                    }
                }
            }.start()
        }

        send.setOnClickListener {
            val subjectText = subject.text.toString().trim()
            val messageText = message.text.toString().trim()
            if (subjectText.isEmpty() || messageText.isEmpty()) {
                Toast.makeText(this, "יש למלא נושא ותוכן", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (subjectText.length > 120 || messageText.length > 5000) {
                Toast.makeText(this, "הפנייה ארוכה מדי", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            send.isEnabled = false
            send.text = "שולח..."
            val deviceId = Config.deviceId(this)
            val serverUrl = Config.serverUrl(this)
            val token = Config.deviceToken(this)
            Thread {
                try {
                    ApiClient(serverUrl, token).createSupportTicket(deviceId, subjectText, messageText)
                    runOnUiThread {
                        subject.text.clear()
                        message.text.clear()
                        send.isEnabled = true
                        send.text = "שליחת פנייה"
                        Toast.makeText(this, "הפנייה נשלחה בהצלחה", Toast.LENGTH_LONG).show()
                        loadTickets()
                    }
                } catch (e: Exception) {
                    runOnUiThread {
                        send.isEnabled = true
                        send.text = "שליחת פנייה"
                        Toast.makeText(this, "שליחת הפנייה נכשלה: ${e.message}", Toast.LENGTH_LONG).show()
                    }
                }
            }.start()
        }

        loadTickets()
    }

    private fun renderSupportTickets(container: LinearLayout, tickets: List<SupportTicket>) {
        container.removeAllViews()
        if (tickets.isEmpty()) {
            container.addView(TextView(this).apply {
                text = "עדיין לא נשלחו פניות"
                textSize = 14f
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.CENTER
                setPadding(0, dp(28), 0, dp(28))
            })
            return
        }
        tickets.forEach { ticket ->
            val statusText = when (ticket.status) {
                "IN_PROGRESS" -> "בטיפול"
                "RESOLVED" -> "טופל"
                else -> "חדש"
            }
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = flatRounded(CARD, dp(16).toFloat())
                setPadding(dp(16), dp(14), dp(16), dp(14))
            }
            card.addView(TextView(this).apply {
                text = ticket.subject
                textSize = 15f
                typeface = heavyFont
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.RIGHT
            })
            card.addView(TextView(this).apply {
                text = statusText
                textSize = 12f
                typeface = mediumFont
                setTextColor(Color.parseColor(if (ticket.status == "RESOLVED") OK else ACCENT))
                gravity = Gravity.RIGHT
                setPadding(0, dp(4), 0, dp(8))
            })
            card.addView(TextView(this).apply {
                text = ticket.message
                textSize = 14f
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.RIGHT
            })
            if (!ticket.adminReply.isNullOrBlank()) {
                card.addView(TextView(this).apply {
                    text = "תשובת התמיכה:\n${ticket.adminReply}"
                    textSize = 14f
                    typeface = mediumFont
                    setTextColor(Color.parseColor(ACCENT))
                    gravity = Gravity.RIGHT
                    background = flatRounded(ACCENT_TINT, dp(10).toFloat())
                    setPadding(dp(12), dp(10), dp(12), dp(10))
                }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })
            }
            card.addView(TextView(this).apply {
                text = try { SimpleDateFormat("dd/MM/yyyy HH:mm", Locale("he", "IL")).format(java.util.Date.from(Instant.parse(ticket.createdAt))) } catch (_: Exception) { ticket.createdAt }
                textSize = 11f
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.RIGHT
                setPadding(0, dp(10), 0, 0)
            })
            container.addView(card, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(10) })
        }
    }

'''
replace_once(ACT, show_store_marker, support_activity + show_store_marker)

# ---------- admin panel ----------
HTML = 'admin-panel/index.html'
replace_once(
    HTML,
    '<link rel="stylesheet" href="news.css">\n',
    '<link rel="stylesheet" href="news.css">\n<link rel="stylesheet" href="support.css">\n',
)
replace_once(
    HTML,
    '<div class="tab-content" data-tab-content="news">\n',
    r'''<div class="tab-content" data-tab-content="support">
  <div class="enroll-card">
    <h2>תמיכה ופניות לקוחות</h2>
    <div class="support-toolbar">
      <select id="supportStatusFilter" class="login-input support-filter">
        <option value="all">כל הפניות</option>
        <option value="OPEN">חדשות</option>
        <option value="IN_PROGRESS">בטיפול</option>
        <option value="RESOLVED">טופלו</option>
      </select>
      <button class="alerts-refresh-btn" id="supportRefreshBtn">⟳ רענן</button>
    </div>
    <div id="supportSummary" class="support-summary"></div>
    <div id="supportList"><div class="empty-state">טוען...</div></div>
  </div>
</div>

<div class="tab-content" data-tab-content="news">
''',
)
replace_once(
    HTML,
    '''  <button class="nav-btn" data-tab="news">\n    <span class="nav-icon">📰</span>\n    <span class="nav-label">חדשות ועדכונים</span>\n  </button>\n''',
    '''  <button class="nav-btn" data-tab="support">\n    <span class="nav-icon">💬</span>\n    <span class="nav-label">תמיכה</span>\n  </button>\n  <button class="nav-btn" data-tab="news">\n    <span class="nav-icon">📰</span>\n    <span class="nav-label">חדשות ועדכונים</span>\n  </button>\n''',
)
replace_once(
    HTML,
    '<script src="news.js"></script>\n',
    '<script src="news.js"></script>\n<script src="support.js"></script>\n',
)

Path('admin-panel/support.css').write_text(r'''.support-toolbar { display:flex; gap:10px; align-items:center; margin-bottom:12px; }
.support-filter { margin:0; max-width:220px; }
.support-summary { color:var(--text-dim); font-size:0.82rem; margin-bottom:12px; }
.support-ticket { background:var(--card-bg); border:1px solid var(--card-border); border-radius:16px; padding:14px; margin-bottom:12px; }
.support-ticket.open { border-inline-start:4px solid #B3432C; }
.support-ticket.in-progress { border-inline-start:4px solid #A5661D; }
.support-ticket.resolved { border-inline-start:4px solid var(--ok); }
.support-ticket-head { display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; }
.support-ticket-title { font-weight:800; }
.support-ticket-meta { color:var(--text-dim); font-size:0.76rem; margin-top:4px; }
.support-ticket-message { white-space:pre-wrap; margin:10px 0; line-height:1.5; }
.support-ticket-controls { display:grid; grid-template-columns:160px 1fr; gap:8px; align-items:start; }
.support-ticket-controls textarea { min-height:84px; resize:vertical; }
.support-ticket-actions { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
@media (max-width:720px) {
  body { padding-bottom:calc(220px + env(safe-area-inset-bottom)); }
  .support-ticket-controls { grid-template-columns:1fr; }
  .support-toolbar { align-items:stretch; flex-direction:column; }
  .support-filter { max-width:none; }
}
''', encoding='utf-8')

Path('admin-panel/support.js').write_text(r'''(function () {
  const listEl = document.getElementById('supportList');
  const summaryEl = document.getElementById('supportSummary');
  const filterEl = document.getElementById('supportStatusFilter');
  const refreshBtn = document.getElementById('supportRefreshBtn');
  if (!listEl || !summaryEl || !filterEl || !refreshBtn) return;

  let tickets = [];
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = iso => iso ? new Date(iso).toLocaleString('he-IL') : '—';
  const statusLabel = status => status === 'RESOLVED' ? 'טופל' : status === 'IN_PROGRESS' ? 'בטיפול' : 'חדש';

  function render() {
    const filter = filterEl.value;
    const shown = filter === 'all' ? tickets : tickets.filter(t => t.status === filter);
    const open = tickets.filter(t => t.status === 'OPEN').length;
    const progress = tickets.filter(t => t.status === 'IN_PROGRESS').length;
    summaryEl.textContent = `חדשות: ${open} · בטיפול: ${progress} · סה״כ: ${tickets.length}`;
    if (!shown.length) {
      listEl.innerHTML = '<div class="empty-state">אין פניות בסטטוס הזה</div>';
      return;
    }
    listEl.innerHTML = shown.map(t => {
      const cls = t.status === 'RESOLVED' ? 'resolved' : t.status === 'IN_PROGRESS' ? 'in-progress' : 'open';
      const customer = t.customerName || 'לקוח ללא שם';
      const phone = t.customerNumber ? ` · ${esc(t.customerNumber)}` : '';
      return `<div class="support-ticket ${cls}" data-ticket="${esc(t.id)}">
        <div class="support-ticket-head">
          <div>
            <div class="support-ticket-title">${esc(t.subject)}</div>
            <div class="support-ticket-meta">${esc(customer)}${phone} · מכשיר ${esc(t.deviceId)} · ${esc(fmt(t.createdAt))}</div>
          </div>
          <strong>${statusLabel(t.status)}</strong>
        </div>
        <div class="support-ticket-message">${esc(t.message)}</div>
        <div class="support-ticket-controls">
          <select class="login-input" data-support-status>
            <option value="OPEN"${t.status === 'OPEN' ? ' selected' : ''}>חדש</option>
            <option value="IN_PROGRESS"${t.status === 'IN_PROGRESS' ? ' selected' : ''}>בטיפול</option>
            <option value="RESOLVED"${t.status === 'RESOLVED' ? ' selected' : ''}>טופל</option>
          </select>
          <textarea class="login-input" data-support-reply maxlength="5000" placeholder="תשובה ללקוח...">${esc(t.adminReply || '')}</textarea>
        </div>
        <div class="support-ticket-actions">
          <button class="add-app-btn" data-support-save>שמור ועדכן לקוח</button>
          <button class="toggle-btn" data-support-customer="${esc(t.deviceId)}">פתח לקוח</button>
        </div>
      </div>`;
    }).join('');

    listEl.querySelectorAll('[data-support-save]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('[data-ticket]');
        const id = card.getAttribute('data-ticket');
        const status = card.querySelector('[data-support-status]').value;
        const adminReply = card.querySelector('[data-support-reply]').value.trim();
        btn.disabled = true;
        const res = await fetch(`/api/support-tickets/${encodeURIComponent(id)}`, {
          method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({status, adminReply}),
        });
        btn.disabled = false;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          alert(body.error || 'שמירת הפנייה נכשלה');
          return;
        }
        await load();
      });
    });

    listEl.querySelectorAll('[data-support-customer]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof window.openDeviceDetail === 'function') window.openDeviceDetail(btn.getAttribute('data-support-customer'));
      });
    });
  }

  async function load() {
    listEl.innerHTML = '<div class="empty-state">טוען פניות...</div>';
    try {
      const res = await fetch('/api/support-tickets');
      if (res.status === 401) {
        document.getElementById('loginScreen').style.display = 'flex';
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      tickets = await res.json();
      render();
    } catch (_) {
      listEl.innerHTML = '<div class="empty-state">שגיאה בטעינת פניות התמיכה</div>';
    }
  }

  filterEl.addEventListener('change', render);
  refreshBtn.addEventListener('click', load);
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === 'support') btn.addEventListener('click', load);
  });
})();
''', encoding='utf-8')

# ---------- backend integration test ----------
Path('backend/test-support-tickets.js').write_text(r'''const assert = require('assert');
const crypto = require('crypto');
const db = require('./db');

(async () => {
  await db.init();
  const deviceId = String(Math.floor(1000000000 + Math.random() * 9000000000));
  const id = crypto.randomUUID();
  await db.createDevice(deviceId, crypto.createHash('sha256').update('support-test-token').digest('hex'));
  try {
    await db.setCustomerInfo(deviceId, 'Support Test', '0500000000');
    const created = await db.createSupportTicket(deviceId, id, 'בעיה בבדיקה', 'תוכן פנייה');
    assert.equal(created.status, 'OPEN');
    assert.equal(created.deviceId, deviceId);

    const own = await db.listSupportTicketsForDevice(deviceId);
    assert(own.some(t => t.id === id));

    const admin = await db.listSupportTicketsForAdmin();
    const adminTicket = admin.find(t => t.id === id);
    assert(adminTicket);
    assert.equal(adminTicket.customerName, 'Support Test');

    const updated = await db.updateSupportTicket(id, 'RESOLVED', 'טופל בהצלחה');
    assert.equal(updated.status, 'RESOLVED');
    assert.equal(updated.adminReply, 'טופל בהצלחה');
    assert(updated.resolvedAt);

    await db.updateSupportTicket(id, 'IN_PROGRESS', 'בודקים');
    const reopened = (await db.listSupportTicketsForDevice(deviceId)).find(t => t.id === id);
    assert.equal(reopened.status, 'IN_PROGRESS');
    assert.equal(reopened.resolvedAt, null);

    console.log('support ticket integration: PASS');
  } finally {
    await db.deleteDevice(deviceId);
    process.exit(0);
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
''', encoding='utf-8')

# Remove temporary patch helper/workflow from the resulting feature diff.
Path('backend/patch-customer-support.py').unlink(missing_ok=True)
Path('.github/workflows/patch-customer-support.yml').unlink(missing_ok=True)
print('customer support patch applied')
