# Read-only PowerShell journal viewer

This viewer renders a bounded, structured subset of the isolated V5.1 engine journal.
The background engine has no live PowerShell console to capture. This is a dedicated
PowerShell journal window, not arbitrary desktop/console mirroring or a remote shell.

Installed folder on TRADEVICEPC:
`D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013\read_only\terminal_mirror_20261015`

`Start-Viewer.ps1` runs the dedicated Python viewer and publishes every three seconds.
`viewer.py --once` reads and prints a single snapshot without loading a secret or publishing.
The viewer never imports MT5, sends orders, changes engine configuration, edits journals,
or touches engine run locks. Its own OS lock prevents duplicate viewers.

Only known event names, original event time, cycle namespace and sequence are sent.
Receipt rows without an explicit cycle ID inherit their journal's single unambiguous
cycle namespace. Account numbers, credentials, paths, raw command lines and broker
payloads are excluded. File reads are bounded and incomplete appended records ignored.

Transport uses the existing DPAPI-protected observer key with a separate HMAC domain.
The staging-only API enforces signed time, capture freshness, replay prevention, strict
field allowlists, 32 KB body / 40 row limits and a one-second admission rate limit.
There is no public read endpoint. Existing authenticated master telemetry carries the
volatile mirror buffer; it expires after 12 seconds. A fresh reader heartbeat does not
make an old journal event new, confer trading readiness, or enable Start.
The single copy-api process owns the volatile buffer; multiple replicas would require
shared authenticated storage before scaling. Restart displays Unavailable until reingested.

Rollout: deploy the staged copy-api and copy-web revision together. Then run the viewer
in a separate PowerShell session using Start-Viewer.ps1. No trading bridge restart is
required, including while a basket is active. Verify a 202 acknowledgement, matching
batch/event times, and browser Live state. Until then the UI displays Unavailable.
Stopping this viewer only removes terminal telemetry; it does not stop a basket.
