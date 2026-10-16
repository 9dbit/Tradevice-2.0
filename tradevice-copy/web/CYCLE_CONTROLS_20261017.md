# Cycle controls layout correction

Close all uses the same primary action slot as Start / Reset. The independent standby slider has been removed. Fresh broker-flat evidence in an idle, stopped or Automatic-waiting state hides Close all even when old batch history has unfinished rows. Active execution, uncertain recovery and stale last-active evidence retain emergency access. Fresh observed account exposure overrides a contradictory flat preflight. These display rules do not authorize orders or clear reconciliation.

Automatic waiting shows a disabled Waiting for entry action; Pause and Stop remain available under their existing rules. Selecting Automatic does not arm it. The full-width Cycle mode selector preserves the complete option label, and its explanatory paragraph has an 18 px gap before the control row.

Cycle result layout uses an intrinsic-width output instead of a fixed 72 px cell. Browser geometry checks cover 10/10, 100/100 and 1000/1000 at 320, 390 and 430 px. Larger counts are layout probes only; custom execution remains capped at 10 by the existing protocol.

Validation: 188 unit tests and production build passed. Five focused browser scenarios cover three mobile widths, active slider confirmation, and Close all -> broker-flat -> Reset -> gated Start. All browser API calls are synthetic; no trading commands are sent to staging. This does not certify native iPhone rendering or trading performance.

Deploy scope: copy-web only, staging. No API, broker, engine source, strategy, task restart or guard changes.
