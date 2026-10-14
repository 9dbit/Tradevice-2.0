# Completed batch reset and realized growth

- The executed count remains 10/10 when all ten cycles finished. A stopped reservation
  without fills is not counted as executed. The current running slot is still reported.
- Completed/stopped batch button becomes Reset. This is a local composer reset only:
  restores requested count, clears the local presentation, preserves journals and history.
  No command/API mutation runs on Reset. Start retains fresh, server-side preflight gates.
- Compact solid green ChatGpt 6 Astra display label; no Verified/Connected claim.
- Growth section sits above Overview. Hour/Day/Week/Month/Year/custom Duration in WIB;
  cumulative net USD from matching-identity completed broker-flat V5.1 summaries.
- Empty, stale, partial and missing history are distinguished. No mock performance,
  invented equity baseline, or expected future return is displayed.
- Signed staging ingestion and a separate read-only Windows history publisher, once/minute.
  It neither imports MT5 nor changes/restarts any engine or original strategy files.

Validation: 131 web tests, 168 API tests, 4 journal-reader tests and 7 browser tests pass;
production Next build passes. Final focused browser checks rerun after axis/layout edits.
A real one-shot PC capture found 17 completed cycles with net 57.17 USD. This release
still requires copy-api/copy-web deployment and growth publisher activation; no claim
of deployed chart synchronization is made before those checks.

Only the staging source revisions are prepared. Follow growth-observer/README.md for
post-deploy activation. The existing terminal journal viewer remains running unchanged.
