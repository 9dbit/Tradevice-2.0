# V5.1 realized growth observer

Read-only history feed from the isolated clone, same account/server/symbol/magic
identity as the current demo batch. No account number or identity tuple is exported.
Only completed, filled, broker-flat cycle summaries contribute net USD P&L at their
original end_time. The series includes losses and all costs already in realized_pl_usd.
It is not an account-equity curve or a percentage return. Reset never deletes history.

Scans at most 200 batch directories, 2,000 rows, bounded JSON reads; excludes original
V4/V5 paths and any identity mismatch. Missing/corrupt data marks partial/unavailable;
duplicate cycle IDs do not double count. Captured history is rebuilt from persistent
PC summaries after each API restart; API holds one bounded, volatile projection.
Multiple API replicas would require shared storage before scaling.

Transport: existing DPAPI observer key, distinct tradevice-growth-v1 HMAC domain,
HTTPS with redirects refused, signed timestamp, 256 KB admission bound, replay
prevention and five-second rate limit. No public GET. Existing master admin auth
protects the browser projection. Polls once per minute; browser marks stale after
three minutes while preserving original historical timestamps.

Chart filters: Hour (1h), Day (24h), Week (7d), Month (30d), Year (365d), Duration
(custom inclusive endpoints interpreted as Asia/Jakarta / UTC+07). Each period
starts its cumulative net at zero; periods without recorded cycles show no figure.
Coverage before the earliest matching batch or capped/corrupt scans is explicitly
labelled limited. Source-authored USD results are not rebased to account equity.

Rollout: copy-api and copy-web must deploy the growth endpoint and chart together.
The script is prepared at:
D:\GoldTrapCore\GoldTrapCore_v0.2_v51_research_20261013\read_only\growth_observer_20261015\history.py
After deployment, validate one signed publish and create a separate current-user,
limited, logon task named TRADEVICE-V51-Growth-ReadOnly invoking:
D:\GoldTrapCore\.venv\Scripts\python.exe -u <absolute-history.py-path>
Use IgnoreNew and no execution time limit. No engine, observer or terminal viewer
restart is required. Never launch an engine batch as part of rollout.

Local validation: 131 web tests, 168 API tests, 4 reader tests and 7 browser tests pass;
production build passes. Real read-only capture on 15 October 2026 WIB returned
17 completed broker-flat cycles, net 57.17 USD, AVAILABLE. This is historical evidence,
not an out-of-sample profitability claim. Ingestion/dashboard feed verification must
follow deployment; prepared files and local tests do not prove the new feed is live.
