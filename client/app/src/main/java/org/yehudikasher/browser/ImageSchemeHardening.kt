package org.yehudikasher.browser

import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

object ImageSchemeHardening {

    private val forbiddenSchemes = setOf("data", "blob")

    fun isForbiddenImageUrl(raw: String?): Boolean {
        val value = raw?.trim()?.lowercase().orEmpty()
        return forbiddenSchemes.any { value.startsWith("$it:") }
    }

    fun install(view: WebView): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            return false
        }

        val script = """
            (() => {
              'use strict';
              const blocked = (value) => {
                if (typeof value !== 'string') return false;
                const v = value.trim().toLowerCase();
                return v.startsWith('data:') || v.startsWith('blob:');
              };

              const originalCreateObjectURL = URL.createObjectURL?.bind(URL);
              if (originalCreateObjectURL) {
                Object.defineProperty(URL, 'createObjectURL', {
                  configurable: false,
                  writable: false,
                  value: function() {
                    throw new DOMException('Blocked by managed image policy', 'SecurityError');
                  }
                });
              }

              const imageProto = HTMLImageElement.prototype;
              const srcDescriptor = Object.getOwnPropertyDescriptor(imageProto, 'src');
              if (srcDescriptor?.set && srcDescriptor?.get) {
                Object.defineProperty(imageProto, 'src', {
                  configurable: false,
                  enumerable: srcDescriptor.enumerable,
                  get: srcDescriptor.get,
                  set: function(value) {
                    if (blocked(String(value))) {
                      return srcDescriptor.set.call(this, '');
                    }
                    return srcDescriptor.set.call(this, value);
                  }
                });
              }

              const originalSetAttribute = Element.prototype.setAttribute;
              Object.defineProperty(Element.prototype, 'setAttribute', {
                configurable: false,
                writable: false,
                value: function(name, value) {
                  const n = String(name).toLowerCase();
                  if (
                    (this instanceof HTMLImageElement) &&
                    (n === 'src' || n === 'srcset') &&
                    blocked(String(value))
                  ) {
                    return originalSetAttribute.call(this, name, '');
                  }
                  return originalSetAttribute.call(this, name, value);
                }
              });

              const styleProto = CSSStyleDeclaration.prototype;
              const originalSetProperty = styleProto.setProperty;
              Object.defineProperty(styleProto, 'setProperty', {
                configurable: false,
                writable: false,
                value: function(name, value, priority) {
                  const v = String(value || '').toLowerCase();
                  if (
                    (String(name).toLowerCase().includes('background') ||
                     String(name).toLowerCase().includes('image')) &&
                    (v.includes('url(data:') || v.includes('url(blob:'))
                  ) {
                    return;
                  }
                  return originalSetProperty.call(this, name, value, priority);
                }
              });
            })();
        """.trimIndent()

        WebViewCompat.addDocumentStartJavaScript(
            view,
            script,
            setOf("*"),
        )
        return true
    }
}
