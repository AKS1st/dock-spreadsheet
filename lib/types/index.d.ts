import type { IncomingMessage, ServerResponse } from 'node:http';
export declare const name = "dock-spreadsheet";
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
    webRuntime: {
        trustedHosts: readonly string[];
    };
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
