import type { IncomingMessage, ServerResponse } from 'node:http';
export declare const name = "dock-spreadsheet";
/**
 * Services required before mounting.
 *
 * `webRuntime` used to be listed here and supplied `trustedHosts`; DSH 0.2
 * replaced that service with the `connection` service, which is read lazily
 * through {@link declaredTrustedHosts} so a host without it still mounts
 * (loopback-only fence, the pre-0.2 behaviour).
 */
export declare const inject: string[];
export declare const MAX_FILE_BYTES: number;
interface Context {
    webServer: {
        register(options: {
            kind: 'prefix';
            path: string;
            handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
        }): () => void;
    };
    /**
     * Read a service without declaring a hard dependency on it.
     *
     * Used for the optional `connection` service: a host that does not provide
     * it keeps the loopback-only fence instead of failing to mount.
     */
    get?(name: string): unknown;
    effect(fn: () => void | (() => void), label?: string): void;
}
export declare class ReadError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string);
}
export declare function readSpreadsheet(path: string): Promise<Buffer>;
export declare function apply(ctx: Context): void;
export {};
