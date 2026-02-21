export declare const STORAGE_BACKENDS: readonly ["file", "postgres"];
export type StorageBackend = (typeof STORAGE_BACKENDS)[number];
export declare function resolveStorageBackend(env?: NodeJS.ProcessEnv): StorageBackend;
//# sourceMappingURL=config.d.ts.map