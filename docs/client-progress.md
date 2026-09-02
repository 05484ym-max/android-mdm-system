# Filtered Browser Client Progress

Branch: `filtered-browser-client`
Owner: GPT (Android Client)
Status: IN_PROGRESS

## DONE
- Created the dedicated client branch from `main`.
- Locked client ownership to `/client/**`.
- Defined Phase 0A as a WebView security proof-of-concept before deeper backend integration.

## TESTED
- Branch exists and is isolated from `main`.
- No backend/admin/worker files were changed.

## SERVER IMPACT
- Claude may proceed independently on the minimal Browser Policy API contract and persistence foundation.
- The client will initially use a mock/local policy source until the server contract is IMPLEMENTED.
- Unknown or server-error outcomes must never become ALLOW.

## NEXT
Build the Android WebView Security PoC under `/client/**` and verify fail-closed handling for:
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

After implementation, update this file with exact results and any [CLIENT→SERVER] requirements.
