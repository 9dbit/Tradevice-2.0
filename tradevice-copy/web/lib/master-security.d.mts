export declare const STAGING_PROJECT_REF: string;
export declare function parseMasterBearer(value: unknown): string | null;
export declare function masterAuthAllowed(user: unknown): boolean;
export declare function paperHealthState(health: unknown): 'UNAVAILABLE'|'SAFETY_MISMATCH'|'ONLINE';
