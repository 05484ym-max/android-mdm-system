from pathlib import Path

# Patch apkStorage.js: add a metadata-aware media download helper.
p = Path('backend/apkStorage.js')
s = p.read_text(encoding='utf-8')
needle = """async function downloadApk(config, assetId, requestHeaders = {}) {\n  const response = await fetch(\n    `${config.apiBase}/repos/${config.repository}/releases/assets/${encodeURIComponent(assetId)}`,\n    {\n      headers: {\n        ...headers(config, 'application/octet-stream'),\n        ...requestHeaders,\n      },\n      redirect: 'follow',\n    }\n  );\n  if (!response.ok) {\n    throw new Error(`GitHub APK download failed: HTTP ${response.status}`);\n  }\n  return response;\n}\n"""
if needle not in s:
    raise SystemExit('downloadApk marker not found')
insert = needle + """
async function downloadMedia(config, assetId, requestHeaders = {}) {
  // GitHub's binary release-asset endpoint may return application/octet-stream
  // even when the uploaded asset metadata correctly says image/jpeg, image/png,
  // etc. Validate the trusted GitHub asset metadata first, then stream the
  // binary body without relying on the transport Content-Type.
  const base = `${config.apiBase}/repos/${config.repository}/releases/assets/${encodeURIComponent(assetId)}`;
  const metadata = await githubJson(config, base);
  const contentType = String(metadata && metadata.content_type || '').toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'].includes(contentType)) {
    throw new Error('GitHub media asset metadata has an invalid content type');
  }
  const response = await fetch(base, {
    headers: {
      ...headers(config, 'application/octet-stream'),
      ...requestHeaders,
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`GitHub media download failed: HTTP ${response.status}`);
  }
  return { response, contentType };
}
"""
s = s.replace(needle, insert, 1)
needle2 = """  uploadMedia,\n  deleteApk,\n  downloadApk,\n};\n"""
replace2 = """  uploadMedia,\n  deleteApk,\n  downloadApk,\n  downloadMedia,\n};\n"""
if needle2 not in s:
    raise SystemExit('exports marker not found')
s = s.replace(needle2, replace2, 1)
p.write_text(s, encoding='utf-8')

# Patch backend/index.js media route to trust validated metadata content type.
p = Path('backend/index.js')
s = p.read_text(encoding='utf-8')
old = """  const storageConfig = apkStorage.loadStorageConfig();\n  const range = req.get('range');\n  const upstream = await apkStorage.downloadApk(\n    storageConfig,\n    req.params.assetId,\n    range ? { Range: range } : {},\n  );\n  const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();\n  if (!['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'].includes(contentType)) {\n    throw new Error('GitHub media asset returned an invalid content type');\n  }\n  if (upstream.status === 206) res.status(206);\n  res.setHeader('Content-Type', contentType);\n  for (const header of ['content-length', 'content-range', 'accept-ranges']) {\n    const value = upstream.headers.get(header);\n    if (value) res.setHeader(header, value);\n  }\n  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');\n  if (!upstream.body) throw new Error('GitHub media download returned an empty body');\n  Readable.fromWeb(upstream.body).pipe(res);\n"""
new = """  const storageConfig = apkStorage.loadStorageConfig();\n  const range = req.get('range');\n  const downloaded = await apkStorage.downloadMedia(\n    storageConfig,\n    req.params.assetId,\n    range ? { Range: range } : {},\n  );\n  const upstream = downloaded.response;\n  const contentType = downloaded.contentType;\n  if (upstream.status === 206) res.status(206);\n  res.setHeader('Content-Type', contentType);\n  for (const header of ['content-length', 'content-range', 'accept-ranges']) {\n    const value = upstream.headers.get(header);\n    if (value) res.setHeader(header, value);\n  }\n  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');\n  if (!upstream.body) throw new Error('GitHub media download returned an empty body');\n  Readable.fromWeb(upstream.body).pipe(res);\n"""
if old not in s:
    raise SystemExit('media route marker not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('patched news media download to validate GitHub asset metadata')
