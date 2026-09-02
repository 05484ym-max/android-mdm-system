# Filtered Browser Client Progress

Branch: `filtered-browser-client`
Owner: GPT (Android Client)
Status: PHASE 0A CODE COMPLETE — Android build + physical-device bypass verification still required

## DONE
- Standalone Android filtered-browser client exists under `/client/**`.
- Consolidated the PoC to one active implementation/package: `org.yehudikasher.browser`.
- Removed the superseded duplicate `org.mdmopen.filteredbrowser` implementation and duplicate tests.
- Fail-closed local navigation policy:
  - HTTPS only.
  - Unknown hosts blocked by default.
  - Explicit exact-host and optional subdomain rules.
  - Boundary-aware subdomain matching.
  - Dangerous schemes blocked: `intent:`, `file:`, `data:`, `javascript:`, `content:`, `blob:`.
  - User-info URL confusion rejected.
  - Backslash URL confusion rejected.
  - IPv4/IPv6 literal navigation rejected.
  - Non-default HTTPS ports rejected (only implicit/default or 443 accepted).
  - Malformed, overlong, single-label and wildcard host input rejected.
  - IDN host normalization uses `IDN.toASCII(..., USE_STD3_ASCII_RULES)`.
- WebView hardening:
  - WebView debugging disabled.
  - Cleartext disabled in manifest.
  - File/content access disabled.
  - File-URL cross-access disabled.
  - Mixed content disabled.
  - Multiple windows/popups disabled.
  - JavaScript automatic window opening disabled.
  - Third-party cookies disabled.
  - Runtime WebView permission requests denied.
  - Geolocation denied.
  - File chooser cancelled.
  - Downloads blocked.
  - SSL errors cancelled.
  - HTTP auth cancelled.
  - Client certificate requests cancelled.
  - Main-frame HTTP/network failures fail closed.
- Service Worker hardening:
  - Requires the relevant AndroidX WebKit Service Worker controls when Service Workers are available.
  - Network loads blocked.
  - File/content access blocked.
  - Service Worker requests intercepted with an empty blocked response.
  - If required Service Worker hardening cannot be installed, JavaScript is disabled and the browser reports a hardening failure.
- Safe Browsing startup is requested when supported.
- No backend/admin/worker files were changed.

## TESTED
### Pure Kotlin policy execution
Compiled and executed the active `UrlPolicy.kt` with `kotlinc` in GPT's runtime.

Result:
- **PASS 21/21 policy checks**

Covered:
- exact HTTPS allow
- unknown host block
- subdomain block by default
- allowed subdomain with real label boundary
- malicious suffix/boundary bypass rejection
- HTTP block
- `intent:`
- `file:`
- `data:`
- `javascript:`
- `blob:`
- `content:`
- user-info rejection
- IPv4 rejection
- IPv6 rejection
- backslash confusion rejection
- non-default HTTPS port rejection
- explicit HTTPS 443 allow
- trailing-dot/case normalization
- invalid local rule normalization
- overlong URL rejection

### Static WebView review
Verified the active implementation contains hooks/hardening for:
- top-level navigation
- page-initiated navigation / JavaScript navigation
- HTTP redirects via `shouldOverrideUrlLoading`
- request interception
- popup/window creation
- cross-origin resource/iframe request interception
- Service Worker interception
- blocked schemes
- downloads
- external-intent schemes
- TLS/auth/certificate failures
- WebView permission/file chooser escape paths

## IMPORTANT — NOT YET VERIFIED
A full Android Gradle build has **not** been executed from GPT's current runtime because it has no Android SDK/Gradle environment, and the ownership rules prohibit changing `.github/workflows/**` to add a client CI job.

Therefore Phase 0A is **not VERIFIED** yet.

Android's own WebView documentation also makes two device-level checks mandatory before security sign-off:
- `shouldOverrideUrlLoading` is not called for POST navigations.
- `shouldInterceptRequest` is only called for the initial URL of a redirect chain, not every redirect hop.

Those behaviors are why source review alone cannot prove the required fail-closed behavior for form submissions and every redirect hop.

## SERVER IMPACT
- No wire-contract change is required.
- Claude's current `filtered-browser-server` contract remains compatible.
- Claude has completed server Phase 1.1 hardening and Phase 2 admin workflow; no Android field/status changes are required.
- Client remains on local policy mocks until Phase 0A device verification succeeds.
- Unknown/error/server failure must never become `ALLOW`.

## NEXT
1. Run in an Android-capable environment:
   - `:app:testDebugUnitTest`
   - `:app:assembleDebug`
2. Install the PoC on a physical Android device.
3. Verify and record PASS/FAIL for:
   - top-level navigation
   - HTTP redirect to allowed host
   - HTTP redirect to blocked host
   - JavaScript navigation
   - GET form navigation
   - POST form navigation
   - meta refresh
   - `window.open`
   - popups
   - cross-origin iframes
   - Service Workers
   - `blob:`
   - `intent://`
   - `file://`
   - `data:`
   - `javascript:`
   - downloads
   - external intents
4. If any navigation can contact or render a non-ALLOW target before interception, Phase 0A fails and the browser architecture must be tightened before local policy cache/API integration.
5. Only after build + physical-device bypass tests pass: mark `[DESIGN_IMPLEMENTED]` when a Claude `[DESIGN_READY]` spec exists, then proceed to signed policy / SQLCipher / real API integration.

## COORDINATION
- Claude should not start Redis, Analyzer Worker, AI, Safe Browsing service integration, RDAP/domain-age automation, FCM emergency revoke, or policy signing yet.
- No `docs/design-spec.md` or `/design/**` artifact with `[DESIGN_READY]` was present on `filtered-browser-server` at this check, so no final Android visual-design implementation is pending from GPT yet.
