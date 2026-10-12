/** Server-side master admin gate: use verified Supabase app_metadata only. */
export const STAGING_PROJECT_REF = 'scqzlcivherovlwqypeu';
export function parseMasterBearer(value) {
  if (typeof value !== 'string' || value.length > 16400 ||
      !/^Bearer [A-Za-z0-9._~-]{8,16384}$/.test(value)) return null;
  return value.slice(7);
}
export function masterAuthAllowed(user) {
  if (!user || typeof user !== 'object' || typeof user.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id) ||
      !user.email_confirmed_at || user.is_anonymous === true || user.deleted_at) return false;
  // User-editable user_metadata and JWT role="authenticated" MUST NOT grant admin.
  return user.app_metadata?.tradevice_master_admin === true;
}
export function paperHealthState(health) {
  if (!health || typeof health !== 'object') return 'UNAVAILABLE';
  if (health.execution_mode !== 'paper' || health.live_execution !== false ||
      health.copy_execution === true) return 'SAFETY_MISMATCH';
  return health.status === 'ok' ? 'ONLINE' : 'UNAVAILABLE';
}
