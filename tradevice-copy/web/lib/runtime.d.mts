export interface PublicConfig {
  configured: boolean; supabaseUrl: string | null; publishableKey: string | null;
  signupEnabled: boolean; environment: string; executionMode: string; liveExecution: boolean;
}
export function publicConfig(env: Record<string, string | undefined>): PublicConfig;
export function apiOrigin(env: Record<string, string | undefined>): string | null;
export function memberPath(parts: string[]): string | null;
export function memberQuery(search: string): string | null;
