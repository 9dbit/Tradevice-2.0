/** Runtime-only configuration: never include server secrets in public responses. */
export function publicConfig(env) {
  const url = env.SUPABASE_URL || '';
  const ref = env.SUPABASE_PROJECT_REF || '';
  const key = env.SUPABASE_PUBLISHABLE_KEY || '';
  const configured = /^[a-z]{20}$/.test(ref)
    && url === `https://${ref}.supabase.co`
    && /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  return {
    configured,
    supabaseUrl: configured ? url : null,
    publishableKey: configured ? key : null,
    signupEnabled: configured && env.MEMBER_SIGNUP_ENABLED === 'true',
    environment: 'staging', executionMode: 'paper', liveExecution: false,
  };
}

/** An environment value is not permitted to redirect member tokens anywhere else. */
export function apiOrigin(env) {
  const allowed = new Set([
    'https://copy-api-staging-4c33.up.railway.app',
    'http://copy-api.railway.internal:8080',
  ]);
  if (env.NODE_ENV !== 'production') allowed.add('http://127.0.0.1:8000');
  const origin = env.COPY_API_ORIGIN || '';
  return allowed.has(origin) ? origin : null;
}

export function memberPath(parts) {
  if (!Array.isArray(parts) || parts.some(p => typeof p !== 'string')) return null;
  if (parts.length === 1 && ['me', 'accounts', 'strategies', 'referrals'].includes(parts[0])) return parts[0];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (parts[0] === 'accounts' && uuid.test(parts[1] || '') &&
      (parts.length === 2 || (parts.length === 3 && ['orders', 'risk'].includes(parts[2])))) return parts.join('/');
  return null;
}

export function memberQuery(search) {
  const input = new URLSearchParams(search);
  for (const name of input.keys()) if (name !== 'offset') return null;
  if (input.getAll('offset').length > 1) return null;
  const offset = input.get('offset');
  if (offset !== null && (!/^\d{1,5}$/.test(offset) || Number(offset) > 10000)) return null;
  return offset === null ? '' : `?offset=${Number(offset)}`;
}
