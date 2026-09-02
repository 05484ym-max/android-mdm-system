# Filtered Browser Client Progress

Branch: `filtered-browser-client`
Owner: GPT (Android Client)
Status: PHASE_0A_IMPLEMENTED_PENDING_BUILD_AND_DEVICE_VERIFICATION

## DONE
- Created isolated Android project under `/client/**`.
- Added Kotlin/AppCompat/WebView foundation for the filtered browser.
- Implemented local exact-host policy with HTTPS-only fail-closed behavior.
- Release builds currently have an empty local allowlist; debug builds allow only `example.com` for PoC verification.
- Blocked dangerous/non-browser schemes: `intent:`, `file:`, `data:`, `javascript:`, `content:`, `blob:`.
- Disabled file/content access and mixed content.
- Disabled WebView debugging.
- Disabled popups/multiple windows and external download handling.
- Third-party cookies are disabled.
- SSL errors are cancelled, never bypassed.
- Added defensive navigation enforcement in:
  - `shouldOverrideUrlLoading`
  - `onPageStarted`
  - `shouldInterceptRequest`
- Added fail-closed Service Worker interception/network blocking.
- Added per-feature Service Worker capability checks; if hardening cannot be guaranteed, JavaScript is disabled rather than allowing an unsafe fallback.
- Added fail-closed handling for main-frame network/HTTP errors, HTTP auth, and client-certificate prompts.
- Safe Browsing initialization is now gated by WebView feature support.
- Added unit tests for URL policy normalization and dangerous schemes.
- Added AppCompat application theme to prevent startup-theme crashes.

## TESTED
Static implementation review completed for:
- exact HTTPS allow
- subdomain blocked by default
- HTTP blocked
- dangerous schemes blocked
- malformed/missing host blocked
- URL userinfo blocked
- hostname case/trailing-dot normalization
- SSL errors cancel
- downloads/popups blocked

A real Gradle build and physical-device WebView bypass matrix are still required before Phase 0A can be marked VERIFIED. There is currently no client CI workflow and ownership rules prohibit changing `.github/**` from this branch without an explicit integration decision.

## SERVER IMPACT
Claude may continue Server Phase 1 independently.

Claude must read this file and `docs/client-api-requirements.md` explicitly from branch:
`filtered-browser-client`

Do not assume these files exist on `filtered-browser-server` until integration.

The client contract remains:
- decisions: ALLOW | BLOCK | REVIEW
- server/dependency error must never become ALLOW
- offline allows only valid already-approved signed local policy
- allowSubdomains=false by default

## SECURITY POC NOTES
WebView does not provide one callback that guarantees pre-request inspection of every redirect hop. The PoC therefore uses multiple enforcement points and still requires physical tests for redirects, JS navigation, meta refresh, forms, iframe behavior, Service Workers and blob URLs before production acceptance.

## NEXT
1. Perform a Gradle compile/test using an Android build environment.
2. Run the physical-device bypass matrix.
3. Only after Phase 0A passes, implement encrypted local policy cache (SQLCipher) and real Browser Policy API integration.
