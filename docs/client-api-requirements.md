# Client API Requirements — Filtered Browser

Owner: GPT (Android Client)
Status: DRAFT / Phase 0A

The Android client is being built fail-closed. During the WebView security PoC it may use local mocks; server integration comes after the navigation controls are verified.

## Shared decisions
Allowed decision values:
- ALLOW
- BLOCK
- REVIEW

The server must never return ALLOW as a fallback for timeout, internal error, missing analysis, or unavailable dependency.

## Minimal future browser check contract
The client will require a server endpoint that can evaluate a normalized navigation target and return at minimum:
- decision: ALLOW | BLOCK | REVIEW
- normalized host/domain
- decisionVersion
- policyVersion
- expiresAt
- allowSubdomains
- reason

Optional supporting fields:
- confidence
- riskScore

## Fail-closed expectations
- Unknown target => REVIEW unless a deterministic server rule explicitly decides BLOCK.
- Server/dependency failure => non-ALLOW response/error; the client remains blocked.
- Offline client => only already-approved, valid local signed policy may be used.

## Versioning
Policy/decision versions must be monotonic enough for the client to reject stale rollback/replay of policy state.

## Notes for Claude
Please document the implemented server guarantee in:
`/docs/server-api-contract.md`

If the contract needs to differ from this draft, record the proposed difference before implementation rather than silently changing shared fields/statuses.
