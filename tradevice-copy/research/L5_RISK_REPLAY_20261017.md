# Tradevice V5.1: L5 forensic, ATR/ADX historical replay and guarded exposure

Date: 17 October 2026. Scope: isolated demo research, NOT live trading.

## Pinned broker/journal evidence

Historical batch: v51_dashboard_7f8c70b59072425bb2243404f7a79989,
cycle: 18c3ac11 (16 Oct 2026, 09:15–09:24 UTC).
Four preceding wins totaled +$14.01. L5 lost −$251.66, net five-cycle
result −$237.65. It was a five-layer BUY basket, maximum 1.87 lots,
and ended as COMPLETE_RISK_EXIT with broker-flat confirmation.

The five entry volumes were 0.10, 0.17, 0.29, 0.49, 0.82 at 4190.747,
4189.655, 4188.655, 4187.655 and 4186.655 respectively. The final
0.82-lot fill occurred at 09:24:56.581 UTC; cycle completion was recorded
near 09:24:56.817 UTC, around 0.24 seconds later. This was a dangerous
late exposure escalation. Broker record reports zero fee, swap and
commission on related deals.

At +$3.50 normal TP and −$250 hard-loss, approximately 71.4 ordinary
winners are needed to recover one full hard-loss basket. High raw win rate
is insufficient to establish positive expectancy.

## Historical replay

Read-only source: research/replay_l5_atr_adx.py
Policy source SHA256:
050a974e7047246d321114058a77d1d0ea57147383cff944627f0ecc8e1fb392

Broker bars, 12–16 October UTC: 6,770 M1 and 1,356 M5.
Completed-bar, no-lookahead ATR14 P20–P60 (1,440 prior observations)
and Wilder ADX14 M1+M5 with three stable bars strictly below 20.

All 46 journaled, completed cycles: 43 wins (+$117.90), 3 losses
(−$625.54), net −$507.64, 93.48% observed win rate and
−$11.04 per-cycle expectancy.

| Historical selection | n | Winners | Losses | Historical subset P/L |
|---|---:|---:|---:|---:|
| Unfiltered | 46 | 43 | 3 | −$507.64 |
| ATR only | 15 | 13 | 2 | −$457.11 |
| ADX only | 2 | 2 | 0 | +$7.00 |
| ATR + ADX | 0 | 0 | 0 | $0 (no trades) |

The L5 loss would have FAILED ADX: ATR M1 1.211 (allowed
1.20099–1.66164), ADX max last 3 M1 35.563, M5 24.650.
Other losses: 15 Oct −$122.89/0.19 lots/5 layers and
16 Oct −$250.99/0.48 lots/7 layers. Both failed ADX.

A separate 5-minute sample yielded 968 valid checks: 46 pass,
922 block, plus 469 unavailable/stale checks. Following 15-minute price
range mean 6.47 on pass versus 7.30 on block. Price range is a volatility
PROXY, NOT a simulated strategy P/L.

Retrospective selection DOES NOT simulate counterfactual fills, slippage,
tick bid/ask, news, commissions, dynamic exits or risk exits. Samples
are small, mixed across configurations, with no out-of-sample evidence.
No profitability claim follows, especially for ADX-only n=2.

## Temporary exposure control

Risk research profile, for the isolated demo clone only:
- Maximum gross booked exposure: 0.40 lots, counting pending BUY and SELL
  plus positions without hedging net credit. Base lot 0.01 is the only
  admitted size for PREARM_BOTH 5+5 levels (0.38 gross at arming).
- Recheck the full broker order+position book before every new entry.
  Deny larger fixed or adaptive entry before broker submission.
  CLOSE, CANCEL, TP sync and recovery remain independent.
- Frozen monitored cycle loss trigger: min($30, 3% of equity at arming).
  This is NOT a guaranteed fill price or realized-loss upper bound; market
  slippage, gaps, broker outages can exceed it. No broker-native stop added.

## Deployment record

Guard installed only on the pinned isolated Windows demo research clone,
not original engines or Railway production. The installer required
pinned fingerprint, confirmed 0/0 positions/orders, demo account identity,
no active-run lease and no pending control receipts.

Results: 17 mocked tests passed, source fingerprint updated to
c1b95a37e5a161ad886b8b7d1413d4009fc8a51121912ddfa0b03aa1a1e908b8,
203 historical journal files verified unchanged; tasks restarted;
no new cycle or order was placed. Backup:
D:\GoldTrapCore\research_20261017\backups\1792218234920700500.

## Automatic Cycle gate: NOT READY

Automatic remains disarmed. Next steps before any demo activation:
Linux CI and staging API/web change validation, authenticated limit
projection and rejection messaging, controlled demo fill/exit tests including
late pending fills, disconnection, gaps, emergency-close and restarts,
plus chronological out-of-sample validation for positive net expectancy.

Prior 0/46 combined replay admissions do not demonstrate a profitable
trading model. Do not enable live trading or unconditional automatic cycles.
