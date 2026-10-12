export declare const STAGING_PROJECT_REF: string;
export declare const MASTER_STAGING_WEB_ORIGIN: string;
export declare function masterCommandOriginAllowed(origin: string | null | undefined): boolean;
export declare function parseMasterBearer(value: unknown): string | null;
export declare function masterAuthAllowed(user: unknown): boolean;
export declare function paperHealthState(health: unknown): 'UNAVAILABLE'|'SAFETY_MISMATCH'|'ONLINE';
