# Stop-limit activation during dynamic TP updates

## Incident evidence

Batch `v51_dashboard_da54e8b896424f1faf293636bfcbe1c3`, cycle `53fbfb71`, stopped at 22:32:50 WIB. A SELL L1 filled at 4154.069. A pending L2 activation changed the broker order from SELL STOP LIMIT to SELL LIMIT while dynamic TP synchronization still held an older snapshot. The request used activation price 4154.177 and stoplimit 4155.177 against an already activated limit, producing definitive rejection 10013. The journal proved no effect; terminal cleanup removed the pending ladder and retained a verified broker TP on the remaining position.

Broker history then showed the exact owned 0.01 position closed by DEAL_REASON_TP at 4151.970, net +2.10 including zero fees/commission/swap. The original terminal snapshot remained SAFETY_STOP, zero provisional realized P/L, not broker-flat. DashboardSession omitted the manifest error from its safe blocker projection.

## Changes

- Refresh pending type, price, stoplimit, expiry and ownership before constructing a TP-only modification. Preserve immutable entry, volume, ticket and existing SL.
- Recheck topology before order_check and before dispatch. An exact activation or proved fill defers to the next engine step, where basket targets are recomputed.
- A 10013 response is deferred only after durable no-effect reconciliation and proof of the exact activation/fill. Other rejects stay fatal; uncertain receipts are never automatically retried. No recreation of absent orders.
- Read a fresh position snapshot before basket TP protection after pending synchronization.
- Project bounded error codes from both runtime reporters. Unreconciled P/L is null; the UI says awaiting reconciliation instead of presenting $0.00 as final.
- Add an exact, one-shot repair for this stopped batch: manifest/fingerprint/identity, resolved ledger, protected TP prices, owned fully closed volumes, two flat-book/history reads and stable journal hashes. Add recovery audit, clear only the matching stopped active_run pointer, and publish STOPPED with COMPLETE_BROKER_TP_RECONCILED. No continuation or order submission.

The order-type transition is documented by MetaQuotes: https://www.mql5.com/en/book/automation/experts/experts_modify_order .

## Installation and validation

Five patches in `patches/20261015_pending_transition` reconstruct the tested candidate exactly. Baseline fingerprint `24fb1e12c9c8c4f453c03973ab43c8d0c7e6e23f63bd613a916dcf34998afb9f`; installed fingerprint `3c68014df4fb76ce4e7712fca7e1507c8f0ca79f936035e9a2251049574502b6`.

Applied only to the isolated V5.1 clone under bridge/runner locks and broker-flat checks. All 133 pre-existing log files remained byte-identical. Bridge restarted in standby: READY, all nine checks true, zero unsettled commands; the old batch stays STOPPED with 1/10 completed and +2.10. V4/V5 originals and production were not modified.

- 59 focused engine/settings/settlement/reporting tests passed.
- 64 bridge and strict reconciliation tests passed.
- 160 web unit tests and production build passed.
- Three production-browser checks passed: recovery guards, stopped-batch reset isolation, and rejected-update → reconciled +2.10 presentation. No command requests were sent by these fixtures.
- Broader legacy adapter/pending suite: baseline and candidate both 71 passed / 24 failed, with the same failing test identifiers. These legacy failures remain outstanding; this is not a full legacy-regression clearance.

All trade tests used synthetic MT5 fixtures. No new cycle or broker order was initiated during this repair. Broker-real execution after this patch has not been exercised by this task.
