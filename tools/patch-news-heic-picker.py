from pathlib import Path

p = Path('admin-panel/index.html')
s = p.read_text(encoding='utf-8')
old_accept = 'accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"'
new_accept = 'accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/webm"'
old_help = 'תמונה עד 10MB · סרטון עד 50MB · PNG/JPG/WebP/MP4/WebM'
new_help = 'תמונה עד 10MB · סרטון עד 50MB · PNG/JPG/WebP/HEIC/HEIF/MP4/WebM'
if old_accept not in s:
    raise SystemExit('news media accept marker not found')
if old_help not in s:
    raise SystemExit('news media help marker not found')
s = s.replace(old_accept, new_accept, 1)
s = s.replace(old_help, new_help, 1)
p.write_text(s, encoding='utf-8')
