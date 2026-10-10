/** Validate untrusted API payloads and reject stale session responses. */
export function canApplySessionResult(expected, current) {
  return Number.isSafeInteger(expected) && expected === current;
}
export function readItems(body) {
  if (!body || !Array.isArray(body.items) || body.items.some(x => !x || typeof x !== 'object' || typeof x.id !== 'string')) {
    throw new Error('Invalid member data response');
  }
  return body.items;
}
export function authErrorMessage(error) {
  if (error?.code === 'email_not_confirmed') return 'Confirm your email before signing in.';
  if (error?.status === 429) return 'Too many attempts. Please wait before trying again.';
  if (error?.name === 'AuthRetryableFetchError') return 'Authentication is temporarily unavailable. Please retry.';
  return 'Unable to sign in. Check your email, password, and account invitation.';
}
