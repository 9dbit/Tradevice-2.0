import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMasterBearer, masterAuthAllowed, paperHealthState, STAGING_PROJECT_REF, MASTER_STAGING_WEB_ORIGIN, masterCommandOriginAllowed } from '../lib/master-security.mjs';

const admin = {
  id: '11111111-1111-4111-8111-111111111111',
  email_confirmed_at: '2026-10-12T00:00:00Z',
  is_anonymous: false,
  app_metadata: { tradevice_master_admin: true },
};

test('master access uses explicit server-owned app metadata only', () => {
  assert.equal(masterAuthAllowed(admin), true);
  assert.equal(masterAuthAllowed({ ...admin, app_metadata: {} }), false);
  assert.equal(masterAuthAllowed({ ...admin, app_metadata: { tradevice_master_admin: 'true' } }), false);
  assert.equal(masterAuthAllowed({ ...admin, app_metadata: { role: 'authenticated' } }), false);
  assert.equal(masterAuthAllowed({ ...admin, app_metadata: {}, user_metadata: { tradevice_master_admin: true } }), false);
  assert.equal(masterAuthAllowed({ ...admin, email_confirmed_at: null }), false);
  assert.equal(masterAuthAllowed({ ...admin, is_anonymous: true }), false);
  assert.equal(masterAuthAllowed({ ...admin, deleted_at: '2026-10-12' }), false);
  assert.equal(masterAuthAllowed({ ...admin, id: 'not-a-uuid' }), false);
  assert.equal(masterAuthAllowed(null), false);
});
test('invalid authorization never reaches GoTrue', () => {
  assert.equal(parseMasterBearer(null), null);
  assert.equal(parseMasterBearer(''), null);
  assert.equal(parseMasterBearer('Bearer nope'), null);
  assert.equal(parseMasterBearer('Basic YWJj'), null);
  assert.equal(parseMasterBearer('Bearer ' + 'a'.repeat(16390)), null);
  assert.equal(parseMasterBearer('Bearer sample-jwt-123.456.789'), 'sample-jwt-123.456.789');
});
test('paper API health cannot override a safety mismatch', () => {
  assert.equal(paperHealthState({ status: 'ok', execution_mode: 'paper', live_execution: false, copy_execution: false }), 'ONLINE');
  assert.equal(paperHealthState({ status: 'ok', execution_mode: 'live', live_execution: true }), 'SAFETY_MISMATCH');
  assert.equal(paperHealthState({ status: 'ok', execution_mode: 'paper', live_execution: false, copy_execution: true }), 'SAFETY_MISMATCH');
  assert.equal(paperHealthState(null), 'UNAVAILABLE');
  assert.equal(STAGING_PROJECT_REF, 'scqzlcivherovlwqypeu');
});

test('staging Master command accepts exact browser origin even behind Railway proxy',()=>{
 assert.equal(MASTER_STAGING_WEB_ORIGIN,'https://copy-web-staging.up.railway.app');
 assert.equal(masterCommandOriginAllowed(MASTER_STAGING_WEB_ORIGIN),true);
 // A server-to-server request without Origin remains subject to bearer and admin checks.
 assert.equal(masterCommandOriginAllowed(null),true);
});

test('Master command origin allowlist rejects cross-site, lookalikes and spoofed origins',()=>{
 for (const origin of [
   'null', '', 'https://evil.example',
   'https://copy-web-staging.up.railway.app.evil.test',
   'http://copy-web-staging.up.railway.app',
   'https://copy-web-staging.up.railway.app:1234',
   'https://copy-web-staging.up.railway.app/some-path',
   'https://copy-web-staging.up.railway.app@evil.test',
   'https://copy-web-staging.up.railway.app ',
   'https://copy-api-staging-4c33.up.railway.app'
 ]) assert.equal(masterCommandOriginAllowed(origin),false,origin);
 assert.equal(masterCommandOriginAllowed(undefined),false);
});
