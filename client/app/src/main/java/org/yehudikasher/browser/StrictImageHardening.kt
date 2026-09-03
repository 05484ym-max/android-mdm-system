package org.yehudikasher.browser

import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

object StrictImageHardening {

    // Runs before page JavaScript. blob: is not surfaced to
    // shouldInterceptRequest by Android WebView, so HAREDI_STRICT must stop
    // pages from manufacturing blob URLs that could later be assigned to
    // images without passing through the native moderation proxy.
    private val script = """
        (() => {
          const blockedScheme = value => {
            const s = String(value || '').trim().toLowerCase();
            return s.startsWith('blob:') || s.startsWith('data:');
          };

          if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            URL.createObjectURL = function() {
              throw new DOMException('Blocked by managed image policy', 'SecurityError');
            };
          }

          if (typeof HTMLImageElement !== 'undefined') {
            const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
            if (desc && desc.set && desc.get) {
              Object.defineProperty(HTMLImageElement.prototype, 'src', {
                configurable: desc.configurable,
                enumerable: desc.enumerable,
                get: desc.get,
                set: function(value) {
                  if (blockedScheme(value)) {
                    return desc.set.call(this, '');
                  }
                  return desc.set.call(this, value);
                }
              });
            }
          }

          const nativeSetAttribute = Element.prototype.setAttribute;
          Element.prototype.setAttribute = function(name, value) {
            if (this instanceof HTMLImageElement &&
                String(name).toLowerCase() === 'src' &&
                blockedScheme(value)) {
              return nativeSetAttribute.call(this, name, '');
            }
            return nativeSetAttribute.call(this, name, value);
          };
        })();
    """.trimIndent()

    /**
     * Returns true only when document-start enforcement was installed.
     * Caller must disable JavaScript when false; silently leaving JS enabled
     * would re-open blob: image bypasses on an old WebView implementation.
     */
    fun install(view: WebView): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            return false
        }
        return try {
            WebViewCompat.addDocumentStartJavaScript(
                view,
                script,
                setOf("*"),
            )
            true
        } catch (_: Throwable) {
            false
        }
    }
}
