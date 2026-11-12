import type { IncomingMessage, ServerResponse } from 'node:http';
export declare const name = "dock-spreadsheet";
/**
 * Services required before mounting.
 *
 * The declared-authority list these routes fence with used to be injected here
 * as `webRuntime`. DSH renamed that service to `webStartup` in 0.2.1, so the
 * list is resolved lazily through `declaredTrustedHosts` instead: a renamed
 * service can no longer park this plugin, and older hosts still mount.
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
     * Used for the optional `webStartup` / `webRuntime` / `connection` services:
     * a host that provides none of them keeps the loopback-only fence instead of
     * failing to mount.
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
