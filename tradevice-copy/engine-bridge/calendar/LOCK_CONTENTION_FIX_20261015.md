# Local calendar lock contention fix

Staging runtime snapshot confirmed READY but news=false, error FETCH_ALREADY_LOCKED, and nextFetchAt six hours later. An independent read of the authenticated, unexpired cache evaluated CLEAR. The calendar reader treated transient local contention as a provider refresh interval and held UNKNOWN for six hours.

Collector now reuses signed unexpired cache when another reader owns fetch.lock. Without valid cache it stays UNKNOWN and retries the local read in five seconds. It never steals the lock, renews evidence timestamps, or sends a request while another reader owns it. Normal durable six-hour network cooldown and Retry-After remain enforced. High-impact blackout remains 60 minutes before/after, all currencies.

Eight regression tests passed locally and on TRADEVICEPC: signed-cache reuse, absent/expired/tampered cache, blackout preservation, rate-limit cooldown, and four daily network fetches. Installed only in V5.1 clone with previous hash verification and backup. Demo bridge restarted with no active run or ambiguous receipt. Staging read-back confirms READY, all nine checks true, blockers empty, news error null. No commands or orders issued.

Reviewed fingerprint after patch: 57abe0d56c91316cb9b34327e31aadfdf3b3b648321633784bc34ae741becba2.
Backup: read_only/calendar_lock_fix_20261015/before_install.
