from pathlib import Path

index = Path('backend/index.js')
text = index.read_text(encoding='utf-8')
old = """  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {\n    return { mediaType: 'VIDEO', mimeType: 'video/mp4' };\n  }\n"""
new = """  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {\n    const brands = buffer.toString('ascii', 8, Math.min(buffer.length, 64)).toLowerCase();\n    const heicBrands = ['heic', 'heix', 'hevc', 'hevx'];\n    const heifBrands = ['mif1', 'msf1', 'heim', 'heis'];\n    if (heicBrands.some(brand => brands.includes(brand))) {\n      return { mediaType: 'IMAGE', mimeType: 'image/heic' };\n    }\n    if (heifBrands.some(brand => brands.includes(brand))) {\n      return { mediaType: 'IMAGE', mimeType: 'image/heif' };\n    }\n    return { mediaType: 'VIDEO', mimeType: 'video/mp4' };\n  }\n"""
if old not in text:
    raise SystemExit('expected ftyp media detection block not found')
text = text.replace(old, new, 1)
text = text.replace(
    "unsupported media file; use PNG/JPEG/WebP or MP4/WebM",
    "unsupported media file; use PNG/JPEG/WebP/HEIC/HEIF or MP4/WebM",
    1,
)
index.write_text(text, encoding='utf-8')

storage = Path('backend/apkStorage.js')
st = storage.read_text(encoding='utf-8')
old_map = """    'image/webp': 'webp',\n    'video/mp4': 'mp4',\n"""
new_map = """    'image/webp': 'webp',\n    'image/heic': 'heic',\n    'image/heif': 'heif',\n    'video/mp4': 'mp4',\n"""
if old_map not in st:
    raise SystemExit('expected mediaExtension map block not found')
st = st.replace(old_map, new_map, 1)
storage.write_text(st, encoding='utf-8')
