# Interrupted batch notice and stable skill selection

Audit: batch c787757a647e43a7be9b6bd6af1fdb4e stopped 15 October 2026 09:48:56 WIB after three broker-flat cycles (+3.50, +3.50, +3.49 USD; total +10.49). Cycle 97d4dd1b has DEAL_REASON_TP (5), but realized 3.49 was below the 3.50 target. Existing engine classified it BROKER_CLOSED_OTHER, completed terminal cleanup, then STOPPED_AFTER_TERMINAL_CLEANUP. No engine target or historical outcome changed. No auto-resume.

UI now notifies terminal interrupted batches with completed/requested count, outcome-derived reason, last-cycle net, Close and Reset. Dismissal is session-scoped per batch/status. Reset only clears composer state and requires broker-flat history; Start remains a separate preflight-guarded action. Successful full completion does not trigger the interrupted-batch notice.

Skill slider now reflects durable selectedSkillId, rather than heartbeat age. Engine acknowledgment/freshness remains separately disclosed. Stale catalog disables mutations; network errors cannot implicitly select or deselect a skill.

Validation: 139 web unit tests, production build, and three focused browser tests passed. Browser checks cover interrupted-batch Close/Reset without POST, successful batch reset preservation, and selected skill staying ON after heartbeat expiry. Mobile modal visually inspected at 390px.
