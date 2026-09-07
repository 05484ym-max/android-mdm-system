from pathlib import Path

p = Path('backend/index.js')
s = p.read_text(encoding='utf-8')
anchor = '''// ---------- authentication ----------\n\n/** Guards the admin endpoints. Open when no credentials are configured. */\nfunction requireAdmin(req, res, next) {\n'''
insert = '''// ---------- authentication ----------\n\nconst SAFE_ADMIN_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);\n\n/**\n * Browser admin mutations authenticate with an HttpOnly session cookie, so a\n * cross-site page must never be able to replay that cookie into a state-changing\n * admin request. SameSite=Strict remains enabled on the cookie; this exact-origin\n * check is a second independent CSRF barrier and also rejects same-site sibling\n * origins. Non-browser maintenance clients that send neither Origin nor Fetch\n * Metadata remain compatible, while an explicit cross-site browser request is\n * always rejected.\n */\nfunction isSameOriginAdminMutation(req) {\n  if (SAFE_ADMIN_METHODS.has(req.method)) return true;\n\n  const origin = req.get('origin');\n  const fetchSite = (req.get('sec-fetch-site') || '').toLowerCase();\n  if (!origin) return fetchSite !== 'cross-site';\n\n  try {\n    const expectedOrigin = new URL(`${req.protocol}://${req.get('host')}`).origin;\n    return new URL(origin).origin === expectedOrigin;\n  } catch {\n    return false;\n  }\n}\n\n/** Guards the admin endpoints. Open when no credentials are configured. */\nfunction requireAdmin(req, res, next) {\n'''
if anchor not in s:
    raise SystemExit('authentication anchor not found')
s = s.replace(anchor, insert, 1)
old = '''  try {\n    jwt.verify(token, JWT_SECRET);\n    next();\n  } catch {\n    res.status(401).json({ error: 'invalid session' });\n  }\n}\n'''
new = '''  try {\n    jwt.verify(token, JWT_SECRET);\n    if (!isSameOriginAdminMutation(req)) {\n      return res.status(403).json({ error: 'cross-site admin request rejected' });\n    }\n    next();\n  } catch {\n    res.status(401).json({ error: 'invalid session' });\n  }\n}\n'''
if old not in s:
    raise SystemExit('requireAdmin verification block not found')
s = s.replace(old, new, 1)
old_logout = '''app.post('/api/logout', (req, res) => {\n  res.clearCookie('session');\n  res.json({ status: 'ok' });\n});\n'''
new_logout = '''app.post('/api/logout', (req, res) => {\n  if (!isSameOriginAdminMutation(req)) {\n    return res.status(403).json({ error: 'cross-site admin request rejected' });\n  }\n  res.clearCookie('session');\n  res.json({ status: 'ok' });\n});\n'''
if old_logout not in s:
    raise SystemExit('logout route not found')
s = s.replace(old_logout, new_logout, 1)
p.write_text(s, encoding='utf-8')
