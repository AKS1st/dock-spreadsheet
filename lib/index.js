import { open } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
//#region src/index.ts
const name = "dock-spreadsheet";
/**
* Services required before mounting.
*
* The declared-authority list these routes fence with used to be injected here
* as `webRuntime`. DSH renamed that service to `webStartup` in 0.2.1, so the
* list is resolved lazily through `declaredTrustedHosts` instead: a renamed
* service can no longer park this plugin, and older hosts still mount.
*/
const inject = ["webServer"];
const MAX_FILE_BYTES = 20971520;
const MAX_REQUEST_BYTES = 8192;
const EXTENSIONS = /* @__PURE__ */ new Set([
	".xlsx",
	".xls",
	".ods",
	".csv",
	".tsv"
]);
var ReadError = class extends Error {
	status;
	code;
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
};
/**
* Authorities this deployment declared besides loopback.
*
* DSH publishes them as `trustedHosts` on `webStartup` (0.2.1+); `webRuntime`
* is the same service under its 0.1.x / 0.2.0 name, and a host that exposes
* only the connection RPC carries the list on `connection`. Probe all three
* lazily: a host with none of them keeps the loopback-only fence, and no
* rename can park this plugin on a missing service again.
*/
function declaredTrustedHosts(ctx) {
	if (typeof ctx.get !== "function") return [];
	for (const name of [
		"webStartup",
		"webRuntime",
		"connection"
	]) {
		const declared = ctx.get(name)?.trustedHosts;
		if (!Array.isArray(declared)) continue;
		return declared.filter((entry) => typeof entry === "string");
	}
	return [];
}
function trusted(req, trustedHosts) {
	const host = req.headers.host;
	if (!host || req.headers["sec-fetch-site"] === "cross-site") return false;
	let target;
	try {
		target = new URL(`http://${host}`);
	} catch {
		return false;
	}
	const octets = target.hostname.split(".");
	const loopback = target.hostname === "localhost" || target.hostname === "[::1]" || octets.length === 4 && octets[0] === "127" && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
	const allowed = trustedHosts.some((entry) => {
		try {
			const configured = new URL(`http://${entry}`);
			return configured.host === target.host || !configured.port && configured.hostname === target.hostname;
		} catch {
			return false;
		}
	});
	if (!loopback && !allowed) return false;
	if (typeof req.headers.origin === "string") try {
		if (new URL(req.headers.origin).host !== target.host) return false;
	} catch {
		return false;
	}
	return true;
}
function fail(res, status, code, message) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify({
		ok: false,
		error: {
			code,
			message
		}
	}));
}
async function requestPath(req) {
	let body = "";
	for await (const chunk of req) {
		body += Buffer.from(chunk).toString("utf8");
		if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new ReadError(413, "too-large", "request too large");
	}
	let path;
	try {
		path = JSON.parse(body).path;
	} catch {
		throw new ReadError(400, "bad-request", "invalid JSON request");
	}
	if (typeof path !== "string" || !isAbsolute(path) || !EXTENSIONS.has(extname(path).toLowerCase())) throw new ReadError(400, "bad-request", "absolute spreadsheet path required");
	return resolve(path);
}
async function readSpreadsheet(path) {
	const file = await open(path, "r");
	try {
		const info = await file.stat();
		if (!info.isFile()) throw new ReadError(400, "bad-request", "not a regular file");
		if (info.size > 20971520) throw new ReadError(413, "too-large", "spreadsheet exceeds 20 MiB limit");
		const bytes = await file.readFile();
		if (bytes.length > 20971520) throw new ReadError(413, "too-large", "spreadsheet exceeds 20 MiB limit");
		return bytes;
	} finally {
		await file.close();
	}
}
/** Cheap metadata for the client's "file changed" check. */
async function statSpreadsheet(path) {
	const file = await open(path, "r");
	try {
		const info = await file.stat();
		if (!info.isFile()) throw new ReadError(400, "bad-request", "not a regular file");
		return {
			mtimeMs: info.mtimeMs,
			size: info.size
		};
	} finally {
		await file.close();
	}
}
function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/dock-spreadsheet",
		handler: async (req, res) => {
			if (!trusted(req, declaredTrustedHosts(ctx))) return fail(res, 403, "forbidden", "forbidden");
			const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
			if (req.method !== "POST" || pathname !== "/dock-spreadsheet/read" && pathname !== "/dock-spreadsheet/stat") return fail(res, 404, "not-found", "unknown route");
			try {
				const path = await requestPath(req);
				if (pathname === "/dock-spreadsheet/stat") {
					const value = await statSpreadsheet(path);
					res.writeHead(200, {
						"content-type": "application/json; charset=utf-8",
						"cache-control": "no-store"
					});
					res.end(JSON.stringify({
						ok: true,
						value
					}));
					return;
				}
				const bytes = await readSpreadsheet(path);
				res.writeHead(200, {
					"content-type": "application/octet-stream",
					"content-length": bytes.length,
					"cache-control": "no-store",
					"x-content-type-options": "nosniff"
				});
				res.end(bytes);
			} catch (cause) {
				if (cause instanceof ReadError) fail(res, cause.status, cause.code, cause.message);
				else fail(res, 400, "fs-error", cause instanceof Error ? cause.message : "read failed");
			}
		}
	}), "dock-spreadsheet: read route");
}
//#endregion
export { MAX_FILE_BYTES, ReadError, apply, inject, name, readSpreadsheet, statSpreadsheet };
