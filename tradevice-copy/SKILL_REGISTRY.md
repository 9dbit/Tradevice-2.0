# Staging skill registry

The master dashboard stores immutable skill packages and one nullable selection.
It does **not** load uploaded code into the broker runner, start a cycle, authorize
orders, stop an active basket, or claim that a selected package is running.

## Operator flow

1. Open Trading Skills in the authenticated master Dashboard.
2. Upload a JSON manifest (download the template) or a ZIP with one SKILL.md.
3. New packages are OFF. Turn ON the desired package; the previous selection is
   replaced atomically. Turn OFF the selected package to leave no selection.
4. A successful selection is configuration only, pending engine approval.

Runtime information is separate: fresh signed V5.1 engine diagnostics report the
engine family, cycle, state and risk limits. Diagnostics currently contain no
package digest; therefore the panel explicitly says it cannot verify that the
selected package is loaded. Missing/stale diagnostics never imply an active skill.

## Package contract

JSON schema discriminator: `tradevice.trading.skill.v1`.
Required fields: `name` (80 characters), `version` (32), `description` (500).
Optional: `strategy` (80), `documentation` (65,536). Unknown fields are rejected.
A ZIP requires exactly one SKILL.md and optionally one manifest.json. Without a
manifest, it is catalogued as a document with version `unversioned`. Add a manifest
with a distinct version to upload a subsequent revision of the same named skill.
Allowed archive files: md, json, py, txt, yaml, yml, csv, UTF-8 text only.
Files are inspected in memory and never extracted or executed.

Limits: 512 KiB upload, 64 ZIP entries, 512 KiB per entry, 2 MiB expanded total,
100x compression ratio, 50 catalog entries, 10 committed mutations per minute.
Traversal, symlinks, encrypted archives, duplicate paths, binary contents and
invalid manifests fail closed. Same archive SHA-256 returns the existing record;
same name/version with different contents returns a conflict.

## Authorization and storage

`/api/master/skills` verifies the Supabase user against Auth and requires verified
`app_metadata.tradevice_master_admin`. Client actor IDs are rejected. Browser POST
Origin is pinned to the staging web origin. Bodies are stream-bounded after auth.
The internal API requires the existing server-only shared secret, staging project
identity, and the pinned operator database connection. Neither route accepts
trading authority. Frontend and database errors never disclose credentials.

Private `master_skills` schema is not a PostgREST API. RLS enabled on all tables;
no public/anon/authenticated schema access. The operator may append packages and
audit records, read the catalog, and update only selection state. No delete grant.
The singleton primary key plus true-only CHECK permits exactly one selection row.
`SELECT FOR UPDATE` serializes mutations. `expectedRevision` compare-and-swap
rejects stale browser changes before any update; transaction rollback preserves
previous state on failure. GET uses the same lock for a consistent catalog view.
No historical cycle tables, production data or original engines are modified.

## Activation boundary

Loading a package into a runner remains a separate, unimplemented integration:
review/allowlist the engine adapter, verify package hash, reconcile previous cycle
broker-flat, enforce news/freshness/risk preflight, obtain bounded demo execution
authorization and require a signed engine acknowledgement of the selected digest.
Until then, configuration selection cannot change trading execution. Supervision
of existing exposure must never depend on catalog availability or its OFF state.

## Validation, 2026-10-14

- API unit/security suite: 130 passing (29 skill tests).
- Web unit/route suite: 112 passing (6 skill-route tests).
- TypeScript and production build pass.
- Interactive component QA with synthetic fixtures: upload remains OFF, ON replaces
  previous selection, revision conflict preserves state, OFF clears selection;
  no horizontal overflow at 360/390/768/1440 px and no JavaScript errors.
- Staging database: RLS/private access, singleton/foreign-key constraints, ON/OFF
  and operator privilege metadata verified; state-changing probes rolled back.
- SQL connector cannot impersonate the dedicated operator role; runtime connectivity
  must be verified via the deployed authenticated API, not inferred from SQL owner access.
- Supabase security advisor: no new table/RLS findings; existing Auth leaked-password
  protection warning is unrelated to this schema. Remediation reference:
  https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

No test fixture is evidence of trading performance. No orders are submitted by
this feature or its tests.
