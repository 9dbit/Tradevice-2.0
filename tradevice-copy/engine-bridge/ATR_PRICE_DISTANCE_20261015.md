# ATR TP correction: price distance, not fixed basket profit

This supersedes the numeric-USD ATR behavior in `EXECUTION_SETTINGS_20261015.md`. Scope: the isolated V5.1 clone and staging web/API. No cycle, skill selection, or broker order is authorized by this installation.

For XAUUSDm point size 0.001, ATR 2.10 gives 2,100 points at 1× and 4,200 points at 2×. Price movement is $2.10 / $4.20. This is not a fixed basket profit of $2.10 / $4.20. Profit depends on total lots and costs. With the verified contract sensitivity of $100 per price unit per lot, a 4.20 move corresponds to gross $4.20 at 0.01 lot and $42 at 0.10 lot.

- Read ATR14 from validated completed M1 bars before each cycle and freeze the unrounded price distance. Do not round ATR to USD cents. Round the final broker TP outward to a real tick.
- BUY TP = volume-weighted actual entry + distance; SELL TP = volume-weighted actual entry − distance. Actual fills update weighted entry/TP; frozen ATR distance stays unchanged. This weighted entry is the price break-even basis; fees/swap affect realized net results.
- All prearmed pending TPs and later common TP synchronization use the same distance policy. Fragmentation/news supervision compares the executable bid/ask against the distance price, not the former fixed USD value.
- Historical ATR completion requires owned entry/exit volume closure, TP deal reason, and TP price evidence. Manual close or a positive dollar result alone is insufficient. Late recovery fill cleanup and broker-flat proof remain mandatory. Fixed/custom USD classifications are unchanged; the separate $3.49 fixed-target issue is not claimed resolved.
- Fixed $3.50 and custom USD retain their meanings. Hard loss −$250 and existing L6–L10 distance/risk/ownership safeguards remain.
- New protocol `V51_ATR_PRICE_DISTANCE_20261015` prevents a new command from executing with the old numeric-USD interpretation. Previous heartbeat protocol remains readable during rollout but cannot authorize a new Start. No old command is rewritten or replayed.
- UI distinguishes points, price movement, actual TP price and gross profit estimate. Stale diagnostics do not retain a fresh target claim.

The baseline config digest is unchanged for old journals. Explicit immutable per-cycle proof contains target basis, ATR, price distance and points. The legacy config USD field is unused for ATR execution; fixed USD modes still use it.

## Validation and installation

64 engine/candidate/settlement tests plus 7 subtests; 58 bridge/reconciliation tests; 174 API tests; 157 web unit tests; production build; 8 browser tests. Tests include 0.01–0.10 lot math, BUY/SELL, multiple fills, subcent ATR, frozen distance, no early fixed-dollar exit, TP between polls, manual exit, partial volume, late fill cleanup, and UI unit labels. No broker order test was performed.

The optional old batch terminal suite was not run: it imports separate legacy modules not in this workspace. Automatic approval review rejected exporting a private legacy source module. No alternate export was attempted; existing synthetic fixtures cover the changed terminal paths. No claim is made that the prior 49 legacy failures/errors are resolved.

Patch package `patches/20261015_atr_price_distance` requires baseline fingerprint `722c23673123128a2afe098aba2d29e905af595478246bba804684beea240ae6`. Its six files reconstruct the tested candidate byte-for-byte. Use the guarded installer only after API SUCCESS, no unsettled command, idle bridge, matching baseline and two broker-flat reads. Preserve all backups and journals. A protocol mismatch or genuine news blackout remains blocked.
