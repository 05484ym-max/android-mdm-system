#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/dpc-app/app/src/main/java/org/mdmopen/dpc"

sync="$SRC/SyncScheduler.kt"
dns="$SRC/DnsFailSafeScheduler.kt"
update="$SRC/UpdateCheckScheduler.kt"
wa="$SRC/WhatsAppGuardWatchdog.kt"
service="$SRC/WhatsAppGuardService.kt"
policy="$SRC/PolicySync.kt"

# Network work must remain constrained. A push that arrives while another push
# sync is already running must queue exactly one serialized follow-up instead of
# being dropped by KEEP; APPEND_OR_REPLACE preserves WorkManager serialization
# while guaranteeing the newer server state is observed.
grep -q 'NetworkType.CONNECTED' "$sync"
grep -q 'ExistingWorkPolicy.APPEND_OR_REPLACE' "$sync"
grep -q 'KEY_SCHEDULED_INTERVAL' "$sync"

# DNS immediate job and updater must never share a JobScheduler ID.
grep -q 'private const val IMMEDIATE_JOB_ID = 1004' "$dns"
grep -q 'private const val JOB_ID = 1003' "$update"

# DNS watchdog is absent when filtering is not requested.
grep -q '!Config.dnsFilteringRequested(context)' "$dns"

# WhatsApp backstop is hourly; event-tree renders are coalesced to 80ms.
grep -q 'private const val PERIOD_MS = 60 \* 60 \* 1000L' "$wa"
grep -q 'private const val MIN_RENDER_INTERVAL_MS = 80L' "$service"
grep -q 'private const val COALESCE_DELAY_MS = 80L' "$service"

# Normal policy sync must not trigger a second updater HTTP check; the updater
# has its own persisted 6-7 hour job and explicit retry-update path.
if grep -q 'AutoUpdater.check' "$policy"; then
  echo 'PolicySync must not invoke AutoUpdater.check on every sync' >&2
  exit 1
fi

echo 'Battery scheduling audit: OK'
