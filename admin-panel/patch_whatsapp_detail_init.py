from pathlib import Path
p=Path('admin-panel/customer-search.js')
s=p.read_text()
old="""  const originalRenderDeviceDetail = window.renderDeviceDetail;\n  if (typeof originalRenderDeviceDetail !== 'function') return;\n"""
new="""  let detailHookInstalled = false;\n\n  function installDetailHook() {\n    if (detailHookInstalled) return true;\n    const originalRenderDeviceDetail = window.renderDeviceDetail;\n    if (typeof originalRenderDeviceDetail !== 'function') return false;\n    detailHookInstalled = true;\n"""
if old not in s: raise SystemExit('target header not found')
s=s.replace(old,new,1)
old_tail="""  window.renderDeviceDetail = function (deviceId) {\n    originalRenderDeviceDetail(deviceId);\n    injectWhatsAppGuard(deviceId);\n  };\n})();\n"""
new_tail="""    window.renderDeviceDetail = function (deviceId) {\n      originalRenderDeviceDetail(deviceId);\n      injectWhatsAppGuard(deviceId);\n    };\n    return true;\n  }\n\n  if (!installDetailHook()) {\n    const installTimer = setInterval(() => {\n      if (installDetailHook()) clearInterval(installTimer);\n    }, 50);\n    setTimeout(() => clearInterval(installTimer), 10000);\n    window.addEventListener('load', installDetailHook, { once: true });\n  }\n})();\n"""
if old_tail not in s: raise SystemExit('target tail not found')
s=s.replace(old_tail,new_tail,1)
p.write_text(s)
