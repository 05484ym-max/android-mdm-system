# Filtered Browser Client Progress

Branch: `filtered-browser-client`
Owner: GPT (Android Client)
Status: PHASE 0A IMPLEMENTED — build verification pending CI/Android toolchain

## DONE
- Created standalone Android client project under `/client/**`.
- Added fail-closed local navigation policy.
- HTTPS-only client enforcement.
- Blocks unknown hosts by default.
- Blocks dangerous schemes and malformed navigation targets.
- Rejects user-info URL confusion and IP-literal navigation.
- Exact-host policy with explicit optional subdomain support and boundary-aware matching.
- Added secure WebView client.
- Added SSL-error cancellation, HTTP-auth cancellation, client-cert cancellation.
- Disabled WebView debugging.
- Disabled cleartext traffic in manifest.
- Disabled file/content access.
- Disabled mixed content.
- Disabled popups/multiple windows.
- Denies runtime WebView permission requests and geolocation.
- Cancels file chooser.
- Blocks downloads.
- Service Worker requests are intercepted and returned empty.
- Added unit-test coverage for the pure navigation policy.
- No backend/admin/worker files were changed.

## TESTED
Static source review completed for:
- exact HTTPS allow
- unknown host block
- subdomain false/true boundary behavior
- HTTP block
- intent/file/data/javascript/blob block
- user-info confusion block
- IP-literal block
- malformed URL block
- trailing-dot normalization

IMPORTANT:
A full Android Gradle build has not yet been executed from GPT's environment because the available runtime has no Android SDK/Gradle wrapper for this new standalone client, and ownership rules currently prohibit changing `.github/workflows/**`.
Do not treat Phase 0A as build-verified until CI or a local Android toolchain runs `:app:testDebugUnitTest` and `:app:assembleDebug`.

## SERVER IMPACT
- No new API dependency is required for Phase 0A.
- Continue to use `/docs/client-api-requirements.md` as the client contract draft.
- The client is intentionally using local policy only until WebView behavior is device-tested and server Phase 1.1 hardening is complete.
- Unknown/server-error states must never become ALLOW.

## NEXT
1. Run Android build + unit tests in an Android-capable environment.
2. Install the PoC on a physical Android device and verify:
   - top-level navigation
   - HTTP redirects
   - JavaScript navigation
   - form submissions
   - meta refresh
   - window.open/popups
   - cross-origin iframes
   - Service Workers
   - blob:
   - intent://
   - file://
   - data:
   - javascript:
   - downloads
   - external intents
3. Record real-device pass/fail results here.
4. Only after that, move to signed local policy cache / SQLCipher / real API integration.
