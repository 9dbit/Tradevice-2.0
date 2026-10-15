# News blackout details and notifications

Trading Cycle now explains news blockers using the validated calendar: event names, currencies, release times in WIB and the combined no-trade window. Countdown labels distinguish upcoming blackout, release and post-release cooldown. Overlapping windows retain all event names and use the latest end. Calendar expiry removes actionable countdowns. Calendar clearance still waits for engine preflight confirmation.

The header notification bell opens a keyboard-operable dialog with current news status, the next 24 hours of high-impact events within verified coverage, and the source confirmation time. Its orange indicator denotes blackout or calendar unavailability, not an unread-message count.

No engine, calendar fetch policy, broker command, runtime configuration or database changes. Existing freshness validation and the all-currency 60-minute-before/after policy remain authoritative. Central daily calendar ingestion is not part of this change.

Validation: 144 web unit tests passed; production build passed; 2 focused Playwright tests passed (news dialog/countdowns and compact navigation/layout, including 320/390/1440px). Mobile screenshot visually inspected. Fixtures are synthetic UI checks, not trading performance evidence. The older layout test expected nine checks; updated to ten to include the already-shipped engine-readiness check.
