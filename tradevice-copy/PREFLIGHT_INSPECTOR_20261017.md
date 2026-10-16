# Preflight inspector and margin evidence — staging

## Audited cause

On 17 October around 03:00 WIB the signed runtime reported AUTO_WAITING, margin=true, free margin USD 19,766.35, required free margin about USD 6,285.59, reserve USD 265 and zero shortfall. Active settings were 0.10 lot / 400 points. ADX, not margin, blocked admission. Requirements change with broker prices; these values are an observation, not a fixed funding rule.

The dashboard composer initialized to 0.01 lot / fixed USD 3.50, then treated that mismatch as “Not checked” even while controls were locked to the running activation. The runtime also temporarily set preflight evidence to null during recomputation. These are separate display/evidence continuity problems.

## Changes

- Hydrate the locked active configuration from validated engine evidence. Idle operator edits remain untouched; mismatched settings still require their own final engine preflight.
- Preserve a complete preflight observation through partial refreshes with its ORIGINAL timestamp. The eight-second expiry and all entry guards remain unchanged. Nullable absent settings fields compare canonically.
- All 12 checklist items open a keyboard/touch-accessible popup with meaning, status, timestamp, selected versus checked configuration, blockers and requirements. Margin includes required/available free margin, minimum equity, reserve and shortfall. ATR/ADX include measured values and limits.
- Read-only Command center records the operator question and an allowlisted server-read snapshot, never trusting client-provided runtime evidence. Engine assessment is explicitly separate from AI analysis.
- Durable per-admin/per-factor history in private `master_diagnostics.inspections`, RLS enabled and forced, no anon/member access, no DELETE grant. History has pagination; closing/reopening/reloading preserves saved questions, statuses and answers. Pending checks continue after closing the dialog.
- Requests are idempotent by UUID, one in-flight AI check per admin, max six new checks/minute. Interrupted work becomes FAILED after two minutes; no endless Checking. No automatic provider resend.
- OpenAI Responses API uses strict structured output, store=false, bounded evidence and six prior turns, no tools and no broker/command access. Status is NORMAL, EXPECTED_BLOCK, ANOMALY or INCONCLUSIVE; stale/mismatched evidence cannot become verified readiness.
- Missing configuration produces persisted AI_NOT_CONFIGURED with the engine snapshot/assessment. No simulated answer is labeled as an OpenAI response.

## Deployment and configuration

Database migration `master_preflight_diagnostics` applied to staging `scqzlcivherovlwqypeu`. Catalog verified forced RLS, actor policy, no anon/authenticated reads, operator INSERT and no DELETE. A direct SET ROLE integration probe was unavailable to the connector role; no membership or permissions were changed to bypass that restriction.

Deploy copy-api and copy-web from the same commit. master-worker unchanged. Set `OPENAI_API_KEY` and `PREFLIGHT_AI_MODEL` on copy-api using secure Railway variables to enable actual AI checks. Neither variable existed in the audited service. No API key was fabricated, exposed, or committed. A real provider call has NOT been verified without these variables.

The two-line engine runtime publication fix is included as a reviewed source patch, with mocked-MT5 regression coverage. It is NOT installed on TRADEVICEPC during an armed automatic activation. Applying it requires an idle, broker-flat maintenance window and the existing engine fingerprint/update procedure. Web evidence retention mitigates partial UI gaps independently.

No START, PAUSE, STOP, EMERGENCY_CLOSE, skill selection, reconciliation override, or broker order was issued during this task.

## Verification

- Web: 191 unit tests; production build.
- API: 208 tests. The calendar endpoint fixture previously used fixed October 14 coverage with a real advancing clock; freeze only that test clock to its fixture date. Assertions and runtime calendar guards unchanged.
- Runtime: 5 tests and 3 subtests with mocked MT5, including a read during preflight computation that must retain the prior complete object and timestamp.
- Browser: active setting hydration, historical requirements, popup close/reopen/reload while an AI check progresses, all 12 factors at 320px, missing-AI status, no trading POSTs. Responses are synthetic browser fixtures, not trading or live-AI evidence.
- Security advisor: no diagnostic-table warning. Existing project notice: leaked-password protection disabled (unrelated to this change).

Tests/build do not establish trading safety or profitability.
