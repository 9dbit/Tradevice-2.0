# Skill catalog refresh recovery — 16 October 2026

The dashboard retained native browser GET errors such as Safari's `Load failed`
after successful catalog refreshes: its success branch cleared only error strings
containing `UNAVAILABLE`. This allowed a current engine-loaded label and an old
transport error to appear together. The inspected staging deployment was
`7e8cf98`; Railway HTTP logs showed eight consecutive skill GET responses with
HTTP 200 at 03:58:45–04:00:31 UTC. Those logs do not establish the cause of the
earlier browser transport failure.

Catalog read errors now have separate state from selection/upload errors. A valid
GET clears only the read error. Failed reads retain the last selection, disable
selection changes until refreshed, show a specific refresh message and offer a
read-only retry. Automatic polling remains every 15 seconds. Reads are serialized
and aborted on session cleanup or when a mutation starts, preventing obsolete
responses from overwriting mutation feedback. Catalog revision, scope, selected
identity and active count are checked before accepting evidence. The loaded label
also requires the engine acknowledgement revision to match the catalog.

Regression coverage includes a simulated Safari transport failure followed by
automatic recovery without POSTs, rejection of inconsistent catalog evidence,
preservation of a genuine selection-conflict error after GET recovery, and the
existing selected-switch behavior during stale engine telemetry. All browser API
traffic is synthetic. No engine, strategy, broker command or safety guard changes.

Validation: 165 unit tests, production build and three targeted browser tests
passed. Real device connectivity is not simulated by these checks; the initial
transport failure's network cause remains unconfirmed.
